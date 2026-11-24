/**
 * Regenerates src/siren-tree.json (child → parent region IDs) from Siren.
 * Usage: pnpm --filter @alarmin/shared gen-tree [-- --from path/to/siren-regions.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { parentsFromSirenStates, type SirenRegionNode } from '../src/tree.ts';

const { values } = parseArgs({ options: { from: { type: 'string' } } });
const body = (
  values.from
    ? JSON.parse(readFileSync(values.from, 'utf8'))
    : await (await fetch('https://siren.pp.ua/api/v3/regions')).json()
) as { states: SirenRegionNode[] };

const parents = parentsFromSirenStates(body.states);
const sorted = Object.fromEntries([...parents].sort(([a], [b]) => a - b).map(([c, p]) => [String(c), p]));
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../src/siren-tree.json');
const data = {
  source: `https://siren.pp.ua/api/v3/regions${values.from ? ' (recorded copy)' : ''}`,
  generatedAt: new Date().toISOString(),
  parent: sorted,
};
writeFileSync(out, `${JSON.stringify(data, null, 1)}\n`, 'utf8');
console.log(`wrote ${out} (${parents.size} child regions)`);
