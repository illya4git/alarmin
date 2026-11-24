/**
 * Watch build helper.
 *
 *   node scripts/watch.ts secrets            # write apps/watch/source/generated/Secrets.mc from .env
 *   node scripts/watch.ts build [device]     # secrets + monkeyc → apps/watch/bin/alarmin-<device>.prg
 *   node scripts/watch.ts sim [device]       # build, start the simulator if needed, load the app
 *
 * .env keys used: APP_KEYS (first key goes into the watch), WATCH_PROXY_URL (default http://127.0.0.1:8080;
 * a WATCH_PROXY_URL environment variable overrides it),
 * WATCH_DEVELOPER_KEY (path to the Connect IQ developer key). Secrets.mc is git-ignored.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const watchDir = join(root, 'apps/watch');
const [command = 'build', device = 'fr55'] = process.argv.slice(2);

function readEnv(): Record<string, string> {
  const file = join(root, '.env');
  if (!existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m?.[1]) env[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
  }
  return env;
}

function sdkBin(): string {
  const cfgDir =
    platform() === 'win32'
      ? join(process.env.APPDATA ?? '', 'Garmin/ConnectIQ')
      : platform() === 'darwin'
        ? join(homedir(), 'Library/Application Support/Garmin/ConnectIQ')
        : join(homedir(), '.Garmin/ConnectIQ');
  const cfg = join(cfgDir, 'current-sdk.cfg');
  if (!existsSync(cfg)) throw new Error(`Connect IQ SDK not found (${cfg}); install it with the SDK Manager`);
  return join(readFileSync(cfg, 'utf8').trim(), 'bin');
}

/** Runs an SDK tool the way its .bat/shell wrapper does: java on monkeybrains.jar. */
function sdkJava(mainClass: string, args: string[], options: { detached?: boolean } = {}) {
  const jar = join(sdkBin(), 'monkeybrains.jar');
  const javaArgs = ['-Xms1g', '-Dfile.encoding=UTF-8', '-Dapple.awt.UIElement=true', '-cp', jar, mainClass, ...args];
  if (options.detached) {
    spawn('java', javaArgs, { detached: true, stdio: 'ignore' }).unref();
    return 0;
  }
  return spawnSync('java', javaArgs, { stdio: 'inherit' }).status ?? 1;
}

function writeSecrets(env: Record<string, string>): void {
  const appKey = env.APP_KEYS?.split(',')[0]?.trim();
  if (!appKey) throw new Error('APP_KEYS is missing in .env');
  // The process environment wins, e.g. to point a test build at a mock.
  const proxyUrl = (process.env.WATCH_PROXY_URL || env.WATCH_PROXY_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const out = join(watchDir, 'source/generated/Secrets.mc');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `// GENERATED from .env by scripts/watch.ts. Git-ignored; do not commit.
(:background, :glance)
module Secrets {
    const APP_KEY = ${JSON.stringify(appKey)};
    const PROXY_URL = ${JSON.stringify(proxyUrl)};
}
`,
    'utf8',
  );
  console.log(`wrote Secrets.mc (proxy ${proxyUrl})`);
}

function build(env: Record<string, string>): string {
  writeSecrets(env);
  const key = env.WATCH_DEVELOPER_KEY;
  if (!key || !existsSync(key)) throw new Error('Set WATCH_DEVELOPER_KEY in .env to your Connect IQ developer key');
  const out = join(watchDir, `bin/alarmin-${device}.prg`);
  mkdirSync(dirname(out), { recursive: true });
  const args = ['-d', device, '-f', join(watchDir, 'monkey.jungle'), '-o', out, '-y', key, '-w', '-l', '2'];
  const status = sdkJava('com.garmin.monkeybrains.Monkeybrains', args);
  if (status !== 0) process.exit(status);
  return out;
}

const env = readEnv();
if (command === 'secrets') {
  writeSecrets(env);
} else if (command === 'build') {
  build(env);
} else if (command === 'sim') {
  const prg = build(env);
  const running =
    platform() === 'win32'
      ? spawnSync('tasklist', ['/FI', 'IMAGENAME eq simulator.exe'], { encoding: 'utf8' }).stdout.includes(
          'simulator.exe',
        )
      : spawnSync('pgrep', ['-f', 'simulator'], { encoding: 'utf8' }).status === 0;
  if (!running) {
    spawn(join(sdkBin(), platform() === 'win32' ? 'simulator.exe' : 'simulator'), [], {
      detached: true,
      stdio: 'ignore',
    }).unref();
    await new Promise((r) => setTimeout(r, 6000));
  }
  const shell = join(sdkBin(), platform() === 'win32' ? 'shell.exe' : 'shell');
  sdkJava('com.garmin.monkeybrains.monkeydodeux.MonkeyDoDeux', ['-f', prg, '-d', device, '-s', shell], {
    detached: true,
  });
  console.log(`loaded ${prg} on ${device}`);
} else {
  console.error(`unknown command "${command}"`);
  process.exit(2);
}
