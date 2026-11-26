# Alarmin — Master Plan

Ukrainian air-raid alert widget for Garmin watches (Forerunner 55 first), backed by a small Dockerized TypeScript proxy.

> Not a life-safety system. Official sources (the «Повітряна тривога» app, sirens) always take priority. This must be stated in the app's About screen and in the README.

---

## 1. Decisions

| #   | Topic           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Data sources    | Main source: **siren.pp.ua**. Fallback: **tryvoha.online**. Both need no key. alerts.in.ua isn't issuing tokens.                                                                                                                                                                                                                                                                                                                                                                  |
| D2  | Region level    | **Oblast** for v1: 28 regions (24 oblasts, Kyiv city, Kharkiv city, Zaporizhzhia city, Crimea; no source has Sevastopol). Table: `packages/shared/src/regions.ts`. The API is built around region IDs so **raions** can come later without breaking the watch.                                                                                                                                                                                                                    |
| D3  | Colour mapping  | 🟥 **Red** = Red air-raid alert on the oblast itself **or on every one of its raions** (upstream declares oblast-wide alerts raion by raion). 🟨 **Yellow** = oblast-level _Yellow_ (warning of possible threat) **or** any raion/hromada (or separately announcing city) inside the oblast under alert (_partial_). Long-running frontline alerts count too, so some frontline oblasts are permanently yellow (accepted). 🟩 **Green** = none. Grey `?` = data stale or unknown. |
| D4  | Audience        | Personal / sideloaded first. Designed so it can go on the Connect IQ Store later.                                                                                                                                                                                                                                                                                                                                                                                                 |
| D5  | Monorepo        | **pnpm workspaces** for the TypeScript side, plus a plain Monkey C project in `apps/watch`. The shared region table generates the Monkey C constants.                                                                                                                                                                                                                                                                                                                             |
| D6  | On state change | The background task **asks to open the app on every change** (`Background.requestApplicationWake`). **Tested on a real FR55 (§7):** native black-and-white dialog with the message and Accept/Decline, **one vibration** when it appears. This is the app's only alert channel. Data model and settings are ready for **configurable alarms** later (per transition, per level).                                                                                                  |
| D7  | Proxy auth      | **Static app key** in a header (`X-Alarmin-Key`), plus per-IP rate limiting. Can be swapped for per-device tokens before a Store release.                                                                                                                                                                                                                                                                                                                                         |

### Defaults I chose (change any you disagree with)

| #   | Topic                           | Default                                                                                                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                                                               |
| --- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D8  | Region names on the watch       | **Latin transliteration** (`Kyivska`, `Kyiv city`, `Lvivska`…)                                                                                                                                       | The FR55's language list (from the SDK `compiler.json`) has no Ukrainian, so the system fonts very likely lack Cyrillic. A custom Cyrillic bitmap font is a later option (costs memory). **2026-11-26 spike (`spikes/cyrillic/`):** the simulator renders Ukrainian, including Є Ї І Ґ, with the FR55's own fonts (the worldwide set also serves Russian). Revisit once the device confirms (§8). |
| D9  | Alert types that set the colour | **AIR** only. `ARTILLERY` and `URBAN_FIGHTS` show as a small secondary marker.                                                                                                                       | Matches "air raid" in the brief. Other types affect few oblasts and would otherwise keep them red permanently.                                                                                                                                                                                                                                                                                    |
| D10 | Timestamps                      | The proxy sends Unix epoch seconds. The watch formats local time.                                                                                                                                    | Smallest payload, no timezone logic on the watch.                                                                                                                                                                                                                                                                                                                                                 |
| D11 | Proxy stack                     | Node 26 LTS (via fnm, `.node-version`), TypeScript 7, **Fastify**, **zod** (upstream validation), **pino**, `node:test`, **Biome** (lint + format)                                                   | Small, fast, well typed. Fastify's built-in schema serialization keeps payloads tiny.                                                                                                                                                                                                                                                                                                             |
| D12 | TLS / hosting                   | **One self-contained container** (plain HTTP on :8080, multi-arch amd64 + **arm64**, fits small boards). TLS, domain and reverse proxy are the deployer's choice and **out of scope** for this repo. | Deploy anywhere. Garmin Connect Mobile still requires **HTTPS with a valid certificate** in front of it; self-signed or plain HTTP won't work from a real watch.                                                                                                                                                                                                                                  |

---

## 2. Data sources

Checked live on 2026-11-24.

| Source                                                 | Key                      | Coverage                                                                  | Levels                                                       | Limits / terms                                                                                                                        | Role                                                                            |
| ------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **siren.pp.ua** `/api/v3/alerts`, `/api/v3/regions`    | none                     | oblast → raion → hromada (`State`/`District`/`Community`, ~1,600 regions) | `Red` / `Yellow`, types `AIR` / `ARTILLERY` / `URBAN_FIGHTS` | **No published terms or limits.** One third-party project reports 50 req/min/IP. Same format as the official ukrainealarm.com v3 API. | **Main**                                                                        |
| **tryvoha.online** `/api/v1/alerts`, `/api/v1/regions` | none                     | oblast/raion/hromada by slug                                              | `red` / `yellow` (their definition: yellow = drone threat)   | 120 req/min/IP; responses cached 30–60 s; **attribution to Tryvoha.online required**; commercial use allowed                          | **Fallback** + cross-check                                                      |
| ubilling.net.ua `/aerialalerts/`                       | none                     | oblasts only                                                              | on/off only                                                  | 2 req/s/host, ban warning                                                                                                             | Not used. Possible last-resort fallback.                                        |
| alerts.in.ua                                           | token (not being issued) | all levels, compact IoT endpoints                                         | R/Y/P/N                                                      | 8–12 req/min, proxy required                                                                                                          | Adapter later if tokens come back                                               |
| api.ukrainealarm.com (official)                        | key on application       | all levels                                                                | Red/Yellow                                                   | unknown (site blocks automated fetching)                                                                                              | **Apply for a key now.** Same format as Siren, so switching is a config change. |

### Siren `/api/v3/alerts` shape (only regions with active alerts are listed)

```json
[
  {
    "regionId": "99",
    "regionType": "District",
    "regionName": "Подільський район",
    "lastUpdate": "2026-11-24T15:19:48Z",
    "activeAlerts": [
      {
        "regionId": "99",
        "regionType": "District",
        "type": "AIR",
        "lastUpdate": "...",
        "activeAlertLevels": [{ "alertLevel": "Yellow", "reason": "", "createdAt": "..." }]
      }
    ]
  }
]
```

`/api/v3/regions` → `{ "states": [{ "regionId", "regionName", "regionType", "regionChildIds": [...] }] }` (~150 KB). It's used to map each child region to its oblast, which is how partial alerts are detected.

### Data caveats to handle in code

- Both sources keep **stale permanent alerts** (Crimea, Sevastopol, Luhansk have been red since 2022). Keep them as-is (they're real) and mark them "since 2022" in the UI.
- Siren has no global "data as of" timestamp. Staleness is detected through transport errors, schema errors and the cross-check with Tryvoha (§3.3).
- Tryvoha uses slugs and Siren uses numeric IDs. The mapping lives in `packages/shared`.
- Tryvoha's attribution ("Data: Tryvoha.online") must appear in the watch About screen and the README whenever it's used. Credit Siren as well.

---

## 3. Architecture

```
 ┌────────────── Watch (FR55, CIQ 3.4) ───────────────┐
 │ Glance (32 KB)   reads Storage → colour + name     │
 │ Widget (64 KB)   foreground poll every 10 s        │──┐
 │ Background(32 KB) temporal event every 5 min       │  │ HTTPS via phone
 │ Storage: region, state, changedAt, fetchedAt       │  │ (Garmin Connect Mobile)
 └────────────────────────────────────────────────────┘  │
                                                         ▼
                 (your TLS reverse proxy: not part of this repo)
 ┌──────── Proxy container (Node 26 + Fastify, :8080) ────────┐
 │ /v1/*  auth: X-Alarmin-Key, per-IP limit                   │
 │                                                            │
 │ Poller ──► Adapter[siren] ─┐                               │
 │        └─► Adapter[tryvoha]┴► Normalizer ► Snapshot (RAM)  │
 │ Region tree (daily refresh, on-disk cache)                 │
 └────────────────────────────────────────────────────────────┘
            ▲ every 5 s                ▲ every 60 s (every 15 s in fallback)
       siren.pp.ua               tryvoha.online
```

### 3.1 Proxy

**Poller (single loop, process-wide)**

- Siren `/api/v3/alerts` every **5 s** (12 req/min, well under the reported limit). Send `If-None-Match`/`If-Modified-Since` if Siren supports them (verify in Phase 0).
- Tryvoha `/api/v1/alerts` every **60 s** as a cross-check. Every **15 s** while in fallback (no point going faster, given their 30–60 s cache).
- Region tree: a bundled child → parent map (`packages/shared/src/siren-tree.json`, ~22 KB, regenerate with `pnpm --filter @alarmin/shared gen-tree`) is used from cold start; refreshed from Siren `/api/v3/regions` at startup and every 24 h (in memory; rejected if it shrinks by >10 %).

**Source selection (simple state machine)**

- `PRIMARY` → `FALLBACK` after 3 failed Siren fetches in a row (HTTP error, timeout > 4 s, or zod schema failure), or no successful fetch for 30 s.
- `FALLBACK` → `PRIMARY` after 3 successful Siren fetches in a row.
- Both down → keep serving the last snapshot with `stale=1` and `age`.
- Divergence (Siren and Tryvoha disagree on an oblast colour for more than 3 min) → log a warning and expose it in `/healthz`. No automatic switch; we'd be guessing which source is right. Regions Tryvoha doesn't cover (Crimea) are excluded from the check. While in fallback they keep their last known level and are reported stale (`x=1`), never as current green (on a cold start straight into fallback there is no last level: `l=0`, `x=1`).

**Normalizer** → one `Snapshot`:

```ts
type Level = 0 | 1 | 2; // green | yellow | red
interface RegionState {
  id: number; // ukrainealarm/Siren regionId (canonical ID)
  level: Level;
  flags: number; // bit0 oblast-yellow, bit1 partial, bit2 artillery, bit3 urban-fights
  since: number; // epoch s of the current level
}
interface Snapshot {
  at: number;
  source: 'siren' | 'tryvoha';
  stale: boolean;
  regions: Map<number, RegionState>;
}
```
Oblast rule (D3, `apps/proxy/src/normalize.ts`): alerts are first de-duplicated by `activeAlerts[].regionId` (hromada entries repeat their raion's alert). `red` if the oblast itself has an AIR alert at `Red` or every raion has its own Red AIR alert. Otherwise `yellow` if the oblast has AIR `Yellow`, any descendant has an AIR alert, or a city with `parentId` inside it does. Otherwise `green`. Unknown level strings count as Red. `since` is kept while the level holds and set to "now" on a transition; on cold start it's estimated from upstream `createdAt`.

**Watch-facing API**: tiny JSON with short keys, meant to be parsed in a few hundred bytes.

| Endpoint        | Response                                                                                                                                                                       | Use                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `GET /v1/s/:id` | `{"l":2,"f":1,"t":1732460000,"a":4,"x":0,"s":0}` (level, flags, since, data age in s, stale, source: 0 Siren, 1 Tryvoha). `:id` is a top-level region or a raion               | Glance/widget/background    |
| `GET /v1/all`   | `{"m":"0021001…","t":…,"a":4,"x":0}` (`m` is one digit per oblast in the fixed map order from `packages/shared`; Phase 7 adds `3` = unknown, e.g. Crimea in fallback, and `s`) | Map page (§3.5)             |
| `GET /v1/o/:id` | `{"m":"0212102","t":…,"a":4,"x":0,"s":0}` (one digit per raion of oblast `:id` in raion `idx` order, `3` = unknown; empty for regions without raions)                          | Zoomed map (Phase 8)        |
| `GET /v1/meta`  | `{"v":1,"src":"siren","min":"0.1.0"}`                                                                                                                                          | Version check / attribution |
| `GET /healthz`  | full JSON status, no auth: served source and mode, per-feed health, regions without coverage, divergences                                                                      | Monitoring                  |

Versioned under `/v1` so the watch and proxy can evolve independently. Responses are built from the in-memory snapshot with no upstream call per request, so watch traffic is effectively free.

### 3.2 Watch (FR55: API 3.4, 208×208 MIP, 8 colours)

App type: **widget with a glance**.

| Part                            | Memory | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(:glance)` GlanceView          | 32 KB  | Draws from `Storage`: colour block or ring, Latin region name, "since HH:MM", data age. On each start it also sends one throttled `makeWebRequest` (if the reply lands, it goes into `Storage` for the next draw; must be verified in Phase 0). The FR55 renders glances in "background UI update" mode: the system starts the app, draws once and caches the image, redraws at most every ~30 s while visible, and ignores `requestUpdate()`, so a glance can't poll continuously.                                    |
| WidgetView                      | 64 KB  | Large status; while open, `Timer` every **10 s** → `makeWebRequest /v1/s/:id`. DOWN → map page, DOWN again → main menu (§3.5).                                                                                                                                                                                                                                                                                                                                                                                         |
| `(:background)` ServiceDelegate | 32 KB  | `registerForTemporalEvent(5 min)`. Fetches `/v1/s/:id`, compares with the last stored level (same region only; not on stale data), writes `Storage` directly (CIQ ≥ 3.2), `Background.exit(true)`. On change → `requestApplicationWake(msg)`, then `exit()` (the dialog appears only after exit). `msg` is short, with the important word first, e.g. `"Kyivska: RED"`, `"Kyivska: yellow"`, `"Kyivska: all clear"`. The dialog wraps at ~14 characters per line in a large font, and the buttons take the lower half. |
| App `onBackgroundData`          | —      | `WatchUi.requestUpdate()` (the background already wrote `Storage`).                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Settings                        | —      | `properties.xml` + `settings.xml`: region list (also editable in the Garmin Connect app), proxy URL, alarm toggles `alRed` / `alYellow` / `alGreen` (D6).                                                                                                                                                                                                                                                                                                                                                              |

**Stored state** (`Storage`): `{ r: regionId, l: level, f: flags, t: since, ft: fetchedAt, err: lastErrorCode }`. The glance shows grey `?` when `now - ft > 15 min` or `x == 1`.

**Alarms later (D6 groundwork)**: properties `alRed`, `alYellow`, `alGreen` (bool, all default `true`; toggled in the menu's Alerts submenu and in the phone settings). The background reads them before calling `requestApplicationWake`. The dialog itself vibrates once. After Accept, the widget plays a level-specific `Attention.vibrate` pattern (e.g. long-long-long for red, one short for clear), which also makes the level recognisable without looking.

**Colour on an 8-colour MIP**: red `0xFF0000`, yellow `0xFFFF00`, green `0x00FF00`, all exact palette colours, no dithering. Text black on yellow/green, white on red.

### 3.3 Freshness end to end

1. Upstream → proxy: snapshot `at` and `stale` from the state machine.
2. Proxy → watch: `a` (age) and `x` (stale) in every response.
3. Watch: `fetchedAt` stored. Grey state if old. Without a phone connection, `makeWebRequest` fails and is shown as "no phone" in the widget.

### 3.4 Region IDs (raion-ready)

The canonical ID is the **ukrainealarm/Siren `regionId`**. `packages/shared/regions.ts` holds for each oblast: `id`, `sirenId`, `tryvohaSlug`, `nameUk`, `nameLatin`, `mapIndex`. Raions are added later as a generated file from `/api/v3/regions` (with Tryvoha slugs matched by name). The watch API already takes any `:id`, so raion support is UI-only work plus a two-step picker.

### 3.5 Target UI (widget pages)

The full widget has three pages. The glance stays as it is (§3.2).

| #   | Page                | Content                                                                                                                                                                                                                                                                                                                                                                             | Network                                  | Memory                                                                                                  |
| --- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 1   | **Status** (as now) | Region colour fills the screen; region name, headline (`AIR ALERT` / `THREAT` / `PARTIAL` / `CLEAR` / `NO DATA`), "since", shelling marker. Footer: freshness or error; a second line `via Tryvoha` while the proxy serves Tryvoha.                                                                                                                                                 | `/v1/s/:id` every **10 s** while visible | Small: nothing beyond `Status` is loaded                                                                |
| 2   | **Minimap**         | Whole of Ukraine on a black background, each oblast filled red / yellow / green from `/v1/all` with black borders. The selected region gets a thick white outline; the three cities are dots (a white ring when selected). Unknown or stale regions are drawn as white outlines only (`3`, e.g. Crimea in fallback). One footer line: `6 red  6 yellow`, `All clear`, or the error. | `/v1/all` every **15 s** while visible   | Map font (7 KB PNG atlas) loaded on show, released on hide. Measured: 32 KB in use, 35 KB peak of 60 KB |
| 3   | **Menu**            | Native `Menu2`: **Region** (sublabel = current; opens the picker), **Alerts** (toggles: prompt on red / yellow / all clear → `alRed`, `alYellow`, `alGreen`), **About** (disclaimer, data credits, source now in use).                                                                                                                                                              | none                                     | `Menu2` only                                                                                            |

**Navigation (FR55: no touch, 5 buttons).** DOWN / UP step through the pages: status → map → menu, and inside the menu DOWN / UP move through its items. UP from the first menu item (or BACK) returns to the map; the menu doesn't wrap. START is kept free on the status and map pages for a later page-specific action. BACK on the status or map page leaves the widget. Built with our own delegates (`switchToView` between status and map, `pushView` for the menu, `Menu2InputDelegate.onWrap` for UP at the top), not `ViewLoop`, so the menu can be the third step. Page dots can be drawn by hand later if they're missed.

**Done so far (2026-11-26):** the three-page navigation, the minimap (drawn from font glyphs since the FR55 took ~3 s per draw with polygons), page 3 with Region, Alerts and About, and digit `3` for unknown regions in `/v1/all`.

**Planned (Phase 8):**

- **Zoom (START on the map):** the map shows only your oblast, filled to the screen, with its raions coloured individually and your raion outlined. START or BACK returns to the country view. Raion shapes come from a per-oblast font resource, loaded only while zoomed. Colours come from a new `/v1/o/:oblastId`, one digit per raion in table order. Oblasts without raion data (Kyiv city, Crimea in fallback) show the oblast alone. The zoomed view polls like the country view. **Rule: zoom must cost nothing when it isn't used.** Raion shapes, positions and names live in resources loaded on zoom (not code constants, which sit in memory whenever the widget runs); the raion request is sent only while zoomed. What remains is the zoom view's code (~1 KB of the 64 KB widget memory); the glance and background are untouched. If the zoom spike shows a noticeable load delay, or any overhead on the other pages, drop zoom.

---

## 4. Repository layout

```
alarmin/
├─ package.json              # pnpm root: scripts (build, test, codegen, watch:build, watch:sim)
├─ pnpm-workspace.yaml       # apps/proxy, packages/*
├─ .editorconfig  .gitignore  .env.example
├─ apps/
│  ├─ proxy/
│  │  ├─ src/
│  │  │  ├─ upstream/{siren,tryvoha}.ts   # fetch + zod schema → raw alerts
│  │  │  ├─ normalize.ts                  # raw → per-region states (D3 rules, both sources)
│  │  │  ├─ feed.ts                       # one polled source: timer, health counters
│  │  │  ├─ sources.ts                    # source state machine, divergence, served snapshot
│  │  │  ├─ regionTree.ts                 # tree lookups (refreshed from Siren in main.ts)
│  │  │  ├─ server.ts                     # /v1/* and /healthz
│  │  │  └─ main.ts
│  │  ├─ test/fixtures/                   # recorded real upstream payloads
│  │  ├─ Dockerfile                       # multi-stage, non-root, node:22-alpine
│  │  └─ package.json  tsconfig.json
│  └─ watch/                              # plain Monkey C project (not a pnpm package)
│     ├─ manifest.xml  monkey.jungle
│     ├─ source/{AlarminApp,StatusGlance,MainView,MainMenu,RegionPicker,AboutView,BackgroundService,…}.mc
│     ├─ source/generated/Regions.mc      # ← codegen, committed
│     └─ resources/{strings,settings,properties,drawables}/
├─ packages/
│  └─ shared/
│     ├─ src/regions.ts                   # source of truth
│     └─ scripts/gen-monkeyc.ts           # → apps/watch/source/generated + resources/settings list
├─ docker-compose.yml                     # proxy container only (TLS is yours)
└─ docs/
   ├─ PLAN.md   api.md   sources.md
```

- Watch build: Connect IQ SDK + `monkeyc` with a developer key path from an env var (never committed). Root scripts wrap `monkeyc -d fr55 -f apps/watch/monkey.jungle`. VS Code Monkey C extension for the simulator.
- CI later: GitHub Actions for proxy lint/test/docker build. The watch build is possible with the SDK in CI but optional.

---

## 5. Phases

**Phase 0: Spikes (de-risk, ~1–2 days)**

- [x] Siren honours `ETag` / `If-None-Match` (304s), `Cache-Control: max-age=1`. Tryvoha has no validators, `max-age=30`, sends `X-RateLimit-Remaining`.
- [x] Analyse the 2-hour recording (`spikes/upstream-recorder/analyze.ts`): change frequency, 304 reliability, Siren vs Tryvoha lag and agreement. Results in §7 (2026-11-25).
- [x] Tryvoha slug ↔ Siren ID map for all 28 regions (`pnpm --filter @alarmin/shared verify-upstream` checks it against live data).
- [x] Wake prompt on a real FR55: works, native dialog, one vibration (§7). Spike: `spikes/wake-prompt/`.
- [x] Can the background read `Storage`? Yes, and write it too on CIQ ≥ 3.2 (FR55 is 3.4; SDK docs). The background service updates `Storage` directly; `Background.exit` only signals a redraw.
- [ ] Glance refresh: on a real FR55, does a `makeWebRequest` sent from glance `onStart` deliver its callback before the glance app is shut down? How often does the system re-render a visible glance? Can the glance pull the next background run forward (`registerForTemporalEvent(Moment)`)?
- [ ] Cyrillic on the FR55 (D8), spike `spikes/cyrillic/`: renders in the simulator (2026-11-26), device check pending.
- [x] Confirm `makeWebRequest` custom header + HTTPS through Garmin Connect Mobile on a real phone (ngrok 2026-11-25, own domain 2026-11-26).
- Deferred to Phase 9 (2026-11-26): the ukrainealarm.com key application and the message to the Siren maintainer.

**Phase 1: Monorepo scaffold**

- [x] git init, pnpm workspace, TS config, lint/format, `packages/shared` region table, Monkey C codegen (`pnpm codegen` → `apps/watch/source/generated/Regions.mc`, compiles for the FR55).

**Phase 2: Proxy MVP**

- [x] Siren adapter + zod schema, region tree, normalizer (unit-tested against fixtures), in-memory snapshot.
- [x] `/v1/s/:id`, `/v1/all`, `/v1/meta`, `/healthz`; `X-Alarmin-Key` check; per-IP rate limit (`@fastify/rate-limit`). Verified live against Siren: payloads 31–63 bytes.
- [x] Dockerfile + compose written (Caddy dropped 2026-11-25: TLS is out of scope). Compose moved to the repo root 2026-11-26.
- [x] Multi-stage, multi-arch image: amd64 tested (healthy, ~46 MiB RAM); arm64 cross-built and inspected.
- [x] Dockerfile works with the classic builder too (2026-11-26: a server without buildx failed on `$BUILDPLATFORM` and `RUN --mount`). Build on the target machine; cross-building now needs QEMU.
- [ ] Run the arm64 image under emulation or on a real ARM64 board.
- [x] Build and run the Docker image (Debian WSL2: healthy, 401 without a key).

**Phase 3: Watch MVP**

- [x] Region picker (on-device `Menu2` + phone settings list, both generated from `packages/shared`), `Storage` model.
- [x] Glance view (colour, name, since, stale state) with a throttled fetch on show.
- [x] Widget view + 10-s foreground polling, error states (no phone / HTTP error / stale).
- [x] Build tooling: `pnpm watch:build` / `pnpm watch:sim` (`scripts/watch.ts`); app key and proxy URL from `.env` into git-ignored `Secrets.mc`. Builds clean at type-check level 2.
- [x] Check in the simulator: widget polling, picker, error states (proxy stopped, phone disconnected).
- [x] On the FR55 via an HTTPS tunnel (ngrok): layout, readability, widget polling. Glance shortened to 3 rows, footer to 2 lines (§7).

**Phase 4: Background and change prompt**

- [x] 5-min temporal event, compare, `requestApplicationWake` on every change (D6), vibrate on open (`BackgroundService.mc`; checked in the simulator against a mock proxy that changes level on every request).
- [x] Alarm-settings keys stubbed in properties (`alRed`, `alYellow`, `alGreen`, all on).
- [ ] On the FR55: prompt after a real change, vibration pattern on Accept, battery impact over a day.

**Phase 5: Resilience**

- [x] Tryvoha adapter, source state machine, divergence logging, stale propagation (2026-11-26; `feed.ts`, `sources.ts`; verified live by pointing Siren at a dead port).
- [x] Attribution: `/v1/s` reports the source (`s`), the status footer says `via Tryvoha` in fallback, About screen and README credit both sources and carry the disclaimer (2026-11-26).

**Phase 6: Personal deployment**

- [x] Container running behind an HTTPS reverse proxy, FR55 build pointing at it (2026-11-26).
- [ ] Uptime check on `/healthz` (it returns 503 when stale; alert on that, and look at `mode` and `divergent`).
- [ ] A week of real-world use, including the Phase 4 on-device checks.

**Phase 7: Pages and map (target UI, §3.5)**

- [x] Page navigation status → map → menu with DOWN / UP; menu with Region and About.
- [x] Navigation on the FR55: UP / DOWN reach the widget and move between pages as in the simulator.
- [x] Alerts submenu: toggles for `alRed`, `alYellow`, `alGreen` (also in the phone settings).
- [x] `/v1/all`: digit `3` for regions the serving source doesn't cover, plus `s`.
- [x] Map shapes: `pnpm --filter @alarmin/shared gen-map` projects Natural Earth 1:10m admin-1 (v5.1.2, public domain), fits it to the round screen, simplifies each shape to ≤ 60 points and rasterizes every oblast into a bitmap-font glyph (`A`+k fill, `a`+k outline; 25 glyph pairs, 256×246 atlas, 7 KB PNG) plus `MapData.mc` with glyph positions and city dots.
- [x] Map page fills each oblast from `/v1/all`, highlights the selected one, polls every 15 s while visible. Simulator: 28.1 / 59.9 KB used, 34.4 KB peak (polygon version).
- [x] Glyph map on the FR55: appears almost instantly. Simulator: 31.9 / 59.9 KB used, 34.6 KB peak, no allocations per `onUpdate`.

**Phase 8: Raions and map detail**

- [x] Raion table (2026-11-26): `pnpm --filter @alarmin/shared gen-raions` writes `src/raions.ts` from Siren `/api/v3/regions`: 122 raions in 24 oblasts, `idx` append-only per oblast. Tryvoha uses Siren IDs for its districts and communities, which gives 118 raion slugs (it lacks the 4 Luhansk raions) and 28 community → raion entries. Latin names by the official KMU 2010 transliteration (`src/translit.ts`); the longest is `Bilhorod-Dnistrovskyi` (21 chars). `verify-upstream` checks raions too.
- [x] Proxy: raion states (2026-11-26), in the same state map as oblasts (Siren IDs don't overlap). Red = raion own Red, all its hromadas Red, or the oblast's own Red; yellow = raion own Yellow, the oblast's own Yellow, or any hromada (or Kharkiv / Zaporizhzhia city) under alert. `/v1/s/:id` accepts raion IDs; `/v1/o/:oblastId` returns one digit per raion. Uncovered raions in fallback are `unknown` like Crimea; `/healthz` adds `uncoveredRaions`. Divergence stays oblast-level.
- [x] Watch: two-step picker (2026-11-26). Region list → for an oblast, a second list: the oblast itself ("Whole oblast") or one of its raions. `regionId` holds either kind of ID, so the status page, glance and background poll `/v1/s/<raion>` unchanged. Raion names come from one jsonData resource per oblast (`raions/<id>.json`, loaded only by the picker; a single file for all raions ran out of memory on the menu page). The picked raion's `[id, oblastId, name]` is cached in Storage for the glance, background prompt and map highlight (its oblast); a raion picked on the phone is resolved when the widget opens. The phone list has the raions as "Oblast: Raion". Long names: the status page steps down to TINY / XTINY, the glance cuts with a dot (`Bilhorod-Dnistr.`). Simulator: glance 14.8 KB (was 14.6), raion list open 40.4 KB of 60.
- [ ] On the FR55: pick a raion on the watch and on the phone; needs the proxy with raion states deployed (the current one answers raion IDs with 404, shown as "Unknown region").
- [-] ~~Map: mixed oblasts striped~~. Dropped 2026-11-26: built and seen in the simulator (two stripe glyphs per oblast, `/v2/all` colour sets, +6 KB on the map page), but the look didn't work. Zoom covers where alerts are inside an oblast.
- [ ] Raion boundaries: find a source with post-2020 raions and a usable licence. Natural Earth has no Ukrainian admin-2; candidates are OCHA COD-AB (ADM2) and geoBoundaries. Match the shapes to Siren raion IDs.
- [ ] Zoom spike: one oblast (Kharkivska, 7 raions) as a font resource. Measure load time, memory and draw time on the FR55 before generating all 24. Go / no-go: no noticeable delay on START, no overhead on the other pages.
- [ ] Zoom on START (§3.5), with your raion highlighted.

**Phase 9: Later**

- [ ] Cyrillic custom font (if memory allows).
- [ ] More devices (`manifest.xml` products, layout per resolution).
- [ ] Store readiness: per-device tokens, privacy note, official ukrainealarm key, ToS review of all sources.
- [ ] Send the ukrainealarm.com API key application; message the Siren maintainer about acceptable polling rates (deferred 2026-11-26).
- [ ] Alarm refinements from the week of use: quiet hours, per-transition rules.
- [ ] START on the status page (e.g. force a refresh).

---

## 6. Risks

| Risk                                                                  | Impact                                        | Mitigation                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| siren.pp.ua is unofficial with no terms; it may disappear or block us | Main source lost                              | Tryvoha fallback; apply for the official ukrainealarm key (same format); polite 5 s polling; ask the maintainer                       |
| Tryvoha's 30–60 s cache                                               | Late alerts in fallback mode                  | Fallback only; show the source in `/healthz`; still well within the 5-min background interval                                         |
| Background minimum is 5 min                                           | Up to 5 min latency when the widget is closed | Platform limit. Documented in About. The foreground updates every 10 s.                                                               |
| Watch ↔ phone disconnected                                            | No updates                                    | Grey stale state with age shown; never show stale green as current                                                                    |
| FR55 memory (glance 32 KB / background 32 KB)                         | Crashes                                       | `(:glance)` / `(:background)` annotations, minimal JSON, no string-heavy code in those scopes; check with the simulator memory viewer |
| Upstream disagreement / errors                                        | Wrong colour                                  | Cross-check + logging; disclaimer; never claim "all clear" when stale                                                                 |
| Shared static app key gets extracted                                  | Proxy abuse                                   | Rate limiting, key rotation via app update; per-device tokens before Store                                                            |

---

## 7. Findings log

| Date       | Finding                                                                                                                                                                                                                                                                                                                                                                       | Effect on the plan                                                                                                                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-11-24 | `requestApplicationWake` on a real FR55: native full-screen black-and-white dialog (message on top, Accept / Decline list), **one vibration** on appearance. The simulator shows only a generic Windows dialog.                                                                                                                                                               | D6 confirmed as the only alert channel; phone-notification fallback dropped. Messages kept short (§3.2).                                                                                                                                                                                                                                   |
| 2026-11-24 | FR55 glances use "background UI update" mode: drawn once and cached, redrawn ≥30 s apart while visible, `requestUpdate()` ignored.                                                                                                                                                                                                                                            | Glance can't poll; fetch-on-start idea to verify (Phase 0).                                                                                                                                                                                                                                                                                |
| 2026-11-24 | Region lists: Kharkiv city (1293) and Zaporizhzhia city (564) announce alerts separately from their oblasts in both sources. Sevastopol is in neither; Crimea only in Siren. Siren also lists a test region (id 0).                                                                                                                                                           | 28 selectable regions; a city alert makes its parent oblast yellow (`parentId`).                                                                                                                                                                                                                                                           |
| 2026-11-24 | Siren supports ETag/304; its data changed several times a minute in testing. Tryvoha has no validators.                                                                                                                                                                                                                                                                       | Proxy sends `If-None-Match` to Siren; full fetch from Tryvoha.                                                                                                                                                                                                                                                                             |
| 2026-11-24 | FR55 device file: API 3.4, glance 32 KB, background 32 KB, widget 64 KB, 8-colour palette, no Ukrainian language.                                                                                                                                                                                                                                                             | Memory budgets, exact palette colours, Latin names (D8).                                                                                                                                                                                                                                                                                   |
| 2026-11-24 | Siren alert shapes: hromada entries repeat their raion's alert (with the raion's `regionId`); oblast-wide alerts appear as all raions red with no oblast entry; frontline hromadas carry alerts that have lasted months.                                                                                                                                                      | De-duplicate by declared region; red = oblast or all raions red; long-running alerts kept (frontline oblasts permanently yellow).                                                                                                                                                                                                          |
| 2026-11-25 | 2-hour recording (24 Nov, 20:12–22:12 UTC; Siren every 5 s, Tryvoha every 30 s). Siren: no failures, median 38 ms; new alerts visible a median 3 s (max 5 s) after their `createdAt`. Every body change was a real alert change.                                                                                                                                              | Siren is effectively real time; the 5 s poll is the dominant delay. Keep 5 s.                                                                                                                                                                                                                                                              |
| 2026-11-25 | Siren's ETag is a SHA-256 of the body and stable, but ~10 % of conditional requests (133 of 1,343) get a 200 with the identical body instead of a 304.                                                                                                                                                                                                                        | Harmless: recomputing gives the same states and keeps `since`. Optional: skip normalising when the ETag equals the last one.                                                                                                                                                                                                               |
| 2026-11-25 | Tryvoha: 2 timeouts in 240 polls; new alerts visible a median 31 s (max 47 s) after `started_at`; `updated_at` changes on every response, so bodies always differ.                                                                                                                                                                                                            | Fallback colour changes arrive ~0.5 min late; acceptable within the 5-min background interval. Never diff Tryvoha bodies as a whole.                                                                                                                                                                                                       |
| 2026-11-25 | Applying D3 to both sources: all 15 colour changes in the run matched 1:1 (none missing on either side), Tryvoha later by a median 27 s (max 44 s); no colour flapped back within 2 min. Agreement 99–100 % per region outside those lags, except Crimea (Siren red since 2022, absent from Tryvoha).                                                                         | Same normaliser rule works for both; 3-min divergence threshold has ample margin. Crimea → unknown in fallback (§3.1). Activity was low (15 changes / 2 h), so rerun during a large attack before relying on the flap result.                                                                                                              |
| 2026-11-25 | FR55 over an ngrok tunnel: works end to end. Free ngrok answers browser-like User-Agents (the phone's request) with an HTML warning page, which the watch reports as -400.                                                                                                                                                                                                    | Watch always sends `ngrok-skip-browser-warning`; harmless elsewhere.                                                                                                                                                                                                                                                                       |
| 2026-11-25 | FR55 UI review: glance needs short words (`RED`/`YELLOW`/`CLEAR`) with "since" on its own row; long footers clip on the round screen. In the simulator, Back from the widget ends the app (blue-triangle screen); it has no glance loop.                                                                                                                                      | 3-row glance; footer split into two short lines.                                                                                                                                                                                                                                                                                           |
| 2026-11-25 | Container: the old image (448 MB) carried pnpm and its package store. Multi-stage build: 281 MB on amd64 (the Node binary is most of it); arm64 71 MB compressed / 193 MB unpacked. All dependencies are pure JS. amd64 run: healthy in ~2 s, 45–48 MiB RAM while polling, ~0 % CPU, stable after 300 requests.                                                               | `node_modules` built once on the build platform and copied into any target, so arm64 builds need no emulation (superseded 2026-11-26: the Dockerfile drops `$BUILDPLATFORM` for classic-builder support, so build natively on the target). Compose caps at 128 MiB / 0.5 CPU. Running arm64 itself needs QEMU or a real board (open item). |
| 2026-11-26 | Deployed behind Caddy + Cloudflare. Cloudflare's Bot Fight Mode and Browser Integrity Check are off for the proxy host (the phone's requests aren't browser-like); a server without buildx needed the Dockerfile to work with the classic builder.                                                                                                                            | Deployment notes stay outside the repo (D12); Dockerfile kept classic-builder compatible.                                                                                                                                                                                                                                                  |
| 2026-11-26 | Tryvoha fallback: on the 20:25 UTC recordings of 24 Nov, Tryvoha and Siren give the same colour for all 27 regions Tryvoha covers (now a unit test). Live: Siren on a dead port → fallback after 3 failures (~15 s), Crimea served as `x=1`, `/v1/meta` `src=tryvoha`.                                                                                                        | Phase 5 proxy side done.                                                                                                                                                                                                                                                                                                                   |
| 2026-11-26 | Minimap in the simulator: Natural Earth 1:10m simplified to ≤ 60 points per oblast reads well at 208 px; concave shapes fill cleanly with `fillPolygon`. Memory on the map page 28.1 KB of 59.9 KB, peak 34.4 KB; no new allocations per `onUpdate` beyond the transient point arrays.                                                                                        | Map stays a generated jsonData resource loaded per visit; no need to pack further.                                                                                                                                                                                                                                                         |
| 2026-11-26 | Polygon minimap on the FR55: ~3 s before the page appears and ~3 s again when data arrives. Decoding and drawing 1,254 points (`fillPolygon` + `drawLine`) per draw is too slow on the device, though instant in the simulator.                                                                                                                                               | Shapes pre-rasterized at build time into a bitmap font; each oblast is one `drawText` tinted by `setColor` (~55 calls per draw). Looks identical; on the FR55 the map now appears almost instantly. Memory 31.9 KB in use (+3.8 KB for the font), peak 34.6 KB (unchanged).                                                                |
| 2026-11-26 | Raion states on the 24 Nov recordings: Siren and Tryvoha agree on 117 of the 118 raions Tryvoha has. The exception is Nikopolskyi: the same alert (started 19:54:35) is Red in Siren and yellow in Tryvoha; both make Dnipropetrovska partial, so the oblast comparison couldn't see it. Tryvoha's English names differ from KMU 2010 in 2 of 118 (`Iavorivskyi`, `Zviahel`). | Raion colours can differ by source where the oblast colour doesn't; the fallback can show a raion one level lower. Kept as a pinned test case; consider raion-level divergence logging if it recurs.                                                                                                                                       |
| 2026-11-26 | Raion picker in the simulator: loading all 122 raions as one jsonData resource (2.6 KB of JSON) ran out of memory with the menu stack open (36 KB in use); parsed JSON costs far more than its file size. | One resource per oblast (5–8 raions), loaded on demand. Keep resource data small per load. |
| 2026-11-26 | Cyrillic spike in the simulator: the FR55's worldwide font set (Roboto, also used for Russian) draws Ukrainian text, including Є є Ї ї І і Ґ ґ and both apostrophes, from source literals and from `strings.xml`.                                                                                                                                                             | D8's premise (no Cyrillic) is likely wrong. Confirm on the device; then decide between Ukrainian and Latin names (§8).                                                                                                                                                                                                                     |

## 8. Open items

- Whether to keep a third fallback (Ubilling, oblast on/off only) in Phase 5.
- App display name and icon.
- Region names in Ukrainian instead of Latin (D8), if the FR55 confirms the Cyrillic spike. Check memory in the glance and background and the fit of long names (`Дніпропетровська`).
- Licence for the repo (MIT suggested).
