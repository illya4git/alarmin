<#
.SYNOPSIS
  Records upstream air-raid alert feeds (siren.pp.ua, tryvoha.online) for later analysis and fixtures.

.DESCRIPTION
  - Fetches region trees once at start.
  - Polls Siren /api/v3/alerts every 5 s and Tryvoha /api/v1/alerts every 30 s.
  - Sends conditional requests (If-None-Match / If-Modified-Since) when the server returned validators.
    Every 10th request is sent unconditionally to check that 304s don't hide changes.
  - Saves a response body only when its SHA-256 changes; logs every poll to polls.jsonl.
  Runs standalone (Windows PowerShell 5.1+); no Node required.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File record.ps1 -DurationMinutes 120
#>
param(
    [int]$DurationMinutes = 120,
    [int]$SirenIntervalSec = 5,
    [int]$TryvohaIntervalSec = 30,
    [string]$OutRoot = (Join-Path $PSScriptRoot 'data')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http

$runId = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$outDir = Join-Path $OutRoot $runId
New-Item -ItemType Directory -Force $outDir | Out-Null
$pollLog = Join-Path $outDir 'polls.jsonl'
Set-Content -Path (Join-Path $OutRoot 'recorder.pid') -Value $PID -Encoding ascii

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
$client = New-Object System.Net.Http.HttpClient($handler)
$client.Timeout = [TimeSpan]::FromSeconds(10)
$client.DefaultRequestHeaders.UserAgent.ParseAdd('alarmin-recorder/0.1')
$sha = [System.Security.Cryptography.SHA256]::Create()

function Get-Hex([byte[]]$bytes) {
    -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') })
}

function Write-Poll($obj) {
    Add-Content -Path $pollLog -Value ($obj | ConvertTo-Json -Compress) -Encoding utf8
}

# Per-feed state: validators, last hash, request counter.
$feeds = @{
    siren   = @{ url = 'https://siren.pp.ua/api/v3/alerts';     interval = $SirenIntervalSec;   etag = $null; lastMod = $null; hash = $null; n = 0; next = [DateTime]::UtcNow }
    tryvoha = @{ url = 'https://tryvoha.online/api/v1/alerts';   interval = $TryvohaIntervalSec; etag = $null; lastMod = $null; hash = $null; n = 0; next = [DateTime]::UtcNow }
}
foreach ($name in $feeds.Keys) { New-Item -ItemType Directory -Force (Join-Path $outDir $name) | Out-Null }

function Get-Header($resp, [string]$name) {
    $vals = $null
    if ($resp.Headers.TryGetValues($name, [ref]$vals)) { return ($vals -join ', ') }
    if ($resp.Content -and $resp.Content.Headers.TryGetValues($name, [ref]$vals)) { return ($vals -join ', ') }
    return $null
}

function Invoke-Poll([string]$name) {
    $f = $feeds[$name]
    $f.n++
    $conditional = ($f.n % 10 -ne 0) -and ($f.etag -or $f.lastMod)
    $req = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Get, $f.url)
    if ($conditional) {
        if ($f.etag) { [void]$req.Headers.TryAddWithoutValidation('If-None-Match', $f.etag) }
        if ($f.lastMod) { [void]$req.Headers.TryAddWithoutValidation('If-Modified-Since', $f.lastMod) }
    }
    $t0 = [DateTime]::UtcNow
    $rec = [ordered]@{ ts = $t0.ToString('o'); feed = $name; n = $f.n; conditional = [bool]$conditional }
    try {
        $resp = $client.SendAsync($req).GetAwaiter().GetResult()
        $rec.ms = [int]([DateTime]::UtcNow - $t0).TotalMilliseconds
        $rec.status = [int]$resp.StatusCode
        $rec.etag = Get-Header $resp 'ETag'
        $rec.lastModified = Get-Header $resp 'Last-Modified'
        $rec.cacheControl = Get-Header $resp 'Cache-Control'
        $rec.age = Get-Header $resp 'Age'
        $rec.cfCache = Get-Header $resp 'CF-Cache-Status'
        $rec.rateRemaining = Get-Header $resp 'X-RateLimit-Remaining'
        if ($rec.etag) { $f.etag = $rec.etag }
        if ($rec.lastModified) { $f.lastMod = $rec.lastModified }

        if ($rec.status -eq 200) {
            $bytes = $resp.Content.ReadAsByteArrayAsync().GetAwaiter().GetResult()
            $hash = Get-Hex $bytes
            $rec.bytes = $bytes.Length
            $rec.hash = $hash.Substring(0, 16)
            $rec.changed = ($hash -ne $f.hash)
            if ($rec.changed) {
                $file = Join-Path (Join-Path $outDir $name) ($t0.ToString('yyyyMMdd-HHmmss-fff') + '.json')
                [System.IO.File]::WriteAllBytes($file, $bytes)
                $f.hash = $hash
            }
            # An unconditional check that finds a change the 304s had hidden.
            if (-not $conditional -and $rec.changed -and $f.n -gt 1 -and $f.lastWas304) { $rec.validatorMissedChange = $true }
            $f.lastWas304 = $false
        } elseif ($rec.status -eq 304) {
            $f.lastWas304 = $true
        } else {
            $rec.error = $resp.Content.ReadAsStringAsync().GetAwaiter().GetResult()
            if ($rec.error.Length -gt 300) { $rec.error = $rec.error.Substring(0, 300) }
        }
        $resp.Dispose()
    } catch {
        $rec.ms = [int]([DateTime]::UtcNow - $t0).TotalMilliseconds
        $rec.status = 0
        $rec.error = $_.Exception.GetBaseException().Message
    }
    Write-Poll $rec
}

# One-off snapshots of the region trees.
foreach ($r in @(
    @{ name = 'siren-regions.json';   url = 'https://siren.pp.ua/api/v3/regions' },
    @{ name = 'tryvoha-regions.json'; url = 'https://tryvoha.online/api/v1/regions' }
)) {
    try {
        $bytes = $client.GetByteArrayAsync($r.url).GetAwaiter().GetResult()
        [System.IO.File]::WriteAllBytes((Join-Path $outDir $r.name), $bytes)
    } catch {
        Write-Poll ([ordered]@{ ts = [DateTime]::UtcNow.ToString('o'); feed = $r.name; status = 0; error = $_.Exception.GetBaseException().Message })
    }
}

$end = [DateTime]::UtcNow.AddMinutes($DurationMinutes)
Write-Poll ([ordered]@{ ts = [DateTime]::UtcNow.ToString('o'); feed = 'recorder'; event = 'start'; pid = $PID; until = $end.ToString('o') })

while ([DateTime]::UtcNow -lt $end) {
    foreach ($name in @('siren', 'tryvoha')) {
        $f = $feeds[$name]
        if ([DateTime]::UtcNow -ge $f.next) {
            $f.next = [DateTime]::UtcNow.AddSeconds($f.interval)
            Invoke-Poll $name
        }
    }
    Start-Sleep -Milliseconds 250
}

Write-Poll ([ordered]@{ ts = [DateTime]::UtcNow.ToString('o'); feed = 'recorder'; event = 'stop' })
Remove-Item (Join-Path $OutRoot 'recorder.pid') -ErrorAction SilentlyContinue
$client.Dispose()
