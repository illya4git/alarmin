import { BUNDLED_SIREN_PARENTS, BUNDLED_SIREN_TREE_DATE, parentsFromSirenStates } from '@alarmin/shared';
import { loadConfig } from './config.ts';
import { Feed, sirenFetcher, tryvohaCovers, tryvohaFetcher } from './feed.ts';
import { RegionTree } from './regionTree.ts';
import { buildServer } from './server.ts';
import { SourceSelector } from './sources.ts';
import { SirenClient } from './upstream/siren.ts';
import { TryvohaClient } from './upstream/tryvoha.ts';

const config = loadConfig();
const siren = new SirenClient({ baseUrl: config.SIREN_BASE_URL, timeoutMs: config.UPSTREAM_TIMEOUT_MS });
const tree = new RegionTree(BUNDLED_SIREN_PARENTS);

// The feeds need a logger and the server needs the selector; a holder breaks the cycle.
const holder: { selector?: SourceSelector } = {};
const app = await buildServer({
  status: {
    get snapshot() {
      return holder.selector?.snapshot ?? null;
    },
    get lastOkAt() {
      return holder.selector?.lastOkAt ?? 0;
    },
    get consecutiveFailures() {
      return holder.selector?.consecutiveFailures ?? 0;
    },
    get lastError() {
      return holder.selector?.lastError ?? null;
    },
    get source() {
      return holder.selector?.source ?? 'siren';
    },
    get mode() {
      return holder.selector?.mode;
    },
    get feeds() {
      return holder.selector?.feeds;
    },
    get divergent() {
      return holder.selector?.divergent;
    },
  },
  appKeys: config.APP_KEYS,
  staleAfterMs: config.STALE_AFTER_MS,
  rateLimitPerMin: config.RATE_LIMIT_PER_MIN,
  trustProxy: config.TRUST_PROXY,
  logger: { level: config.LOG_LEVEL },
});

const sirenFeed = new Feed({
  name: 'siren',
  fetch: sirenFetcher(siren, tree),
  tree,
  intervalMs: () => config.POLL_INTERVAL_MS,
  log: app.log,
});

let tryvohaFeed: Feed | null = null;
if (config.TRYVOHA_ENABLED) {
  const tryvoha = new TryvohaClient({ baseUrl: config.TRYVOHA_BASE_URL, timeoutMs: config.UPSTREAM_TIMEOUT_MS });
  tryvohaFeed = new Feed({
    name: 'tryvoha',
    fetch: tryvohaFetcher(tryvoha),
    tree,
    intervalMs: () =>
      holder.selector?.mode === 'fallback' ? config.TRYVOHA_FALLBACK_INTERVAL_MS : config.TRYVOHA_INTERVAL_MS,
    log: app.log,
    covers: tryvohaCovers,
  });
}

const selector = new SourceSelector({
  primary: sirenFeed,
  fallback: tryvohaFeed,
  log: app.log,
  divergenceAfterMs: config.DIVERGENCE_AFTER_MS,
  primaryFreshMs: config.STALE_AFTER_MS,
  // One missed cross-check poll is fine; two in a row means the comparison is out of date.
  fallbackFreshMs: 2 * config.TRYVOHA_INTERVAL_MS + config.UPSTREAM_TIMEOUT_MS,
});
holder.selector = selector;
for (const feed of [sirenFeed, tryvohaFeed]) {
  if (feed) feed.onTick = () => selector.evaluate();
}

async function refreshTree(): Promise<void> {
  try {
    const parents = parentsFromSirenStates(await siren.regions());
    // Guard against a truncated or broken response wiping the hierarchy.
    if (parents.size < tree.size * 0.9) throw new Error(`suspicious tree size ${parents.size} (have ${tree.size})`);
    tree.replace(parents);
    app.log.info({ regions: parents.size }, 'region tree refreshed');
  } catch (err) {
    app.log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'region tree refresh failed; keeping current',
    );
  }
}

app.log.info({ regions: tree.size, bundled: BUNDLED_SIREN_TREE_DATE }, 'using bundled region tree');
sirenFeed.start();
tryvohaFeed?.start();
app.log.info({ fallback: tryvohaFeed ? 'tryvoha' : null }, 'polling started');
void refreshTree();
const treeTimer = setInterval(() => void refreshTree(), config.TREE_REFRESH_MS);
treeTimer.unref();

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    sirenFeed.stop();
    tryvohaFeed?.stop();
    clearInterval(treeTimer);
    await app.close();
    process.exit(0);
  });
}
