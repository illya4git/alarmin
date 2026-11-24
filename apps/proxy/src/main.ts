import { BUNDLED_SIREN_PARENTS, BUNDLED_SIREN_TREE_DATE, parentsFromSirenStates } from '@alarmin/shared';
import { loadConfig } from './config.ts';
import { Poller } from './poller.ts';
import { RegionTree } from './regionTree.ts';
import { buildServer } from './server.ts';
import { SirenClient } from './upstream/siren.ts';

const config = loadConfig();
const siren = new SirenClient({ baseUrl: config.SIREN_BASE_URL, timeoutMs: config.UPSTREAM_TIMEOUT_MS });
const tree = new RegionTree(BUNDLED_SIREN_PARENTS);

// The poller needs a logger and the server needs the poller; a holder breaks the cycle.
const holder: { poller?: Poller } = {};
const app = await buildServer({
  status: {
    get snapshot() {
      return holder.poller?.snapshot ?? null;
    },
    get lastOkAt() {
      return holder.poller?.lastOkAt ?? 0;
    },
    get consecutiveFailures() {
      return holder.poller?.consecutiveFailures ?? 0;
    },
    get lastError() {
      return holder.poller?.lastError ?? null;
    },
    source: 'siren',
  },
  appKeys: config.APP_KEYS,
  staleAfterMs: config.STALE_AFTER_MS,
  rateLimitPerMin: config.RATE_LIMIT_PER_MIN,
  trustProxy: config.TRUST_PROXY,
  logger: { level: config.LOG_LEVEL },
});

const poller = new Poller({
  fetchAlerts: (etag) => siren.alerts(etag),
  tree,
  intervalMs: config.POLL_INTERVAL_MS,
  log: app.log,
});
holder.poller = poller;

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
poller.start();
void refreshTree();
const treeTimer = setInterval(() => void refreshTree(), config.TREE_REFRESH_MS);
treeTimer.unref();

await app.listen({ host: config.HOST, port: config.PORT });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    poller.stop();
    clearInterval(treeTimer);
    await app.close();
    process.exit(0);
  });
}
