/**
 * Siren region hierarchy (oblast → raion → hromada) as a child → parent map.
 * A bundled copy (siren-tree.json, regenerate with `pnpm --filter @alarmin/shared gen-tree`)
 * lets the proxy work from cold start; the proxy refreshes it from Siren at runtime.
 */
import bundled from './siren-tree.json' with { type: 'json' };

export interface SirenRegionNode {
  regionId: string;
  regionType?: string | undefined;
  regionName?: string | undefined;
  regionChildIds?: SirenRegionNode[] | null | undefined;
}

/** Siren's placeholder "Тестовий регіон". */
export const SIREN_TEST_REGION_ID = 0;

/** Builds a child → parent map from Siren `/api/v3/regions` `states`. Top-level regions have no entry. */
export function parentsFromSirenStates(states: readonly SirenRegionNode[]): Map<number, number> {
  const parent = new Map<number, number>();
  const walk = (nodes: readonly SirenRegionNode[], parentId: number | null) => {
    for (const node of nodes) {
      const id = Number(node.regionId);
      if (parentId === null && id === SIREN_TEST_REGION_ID) continue;
      if (parentId !== null) parent.set(id, parentId);
      walk(node.regionChildIds ?? [], id);
    }
  };
  walk(states, null);
  return parent;
}

export const BUNDLED_SIREN_TREE_DATE: string = bundled.generatedAt;

export const BUNDLED_SIREN_PARENTS: ReadonlyMap<number, number> = new Map(
  Object.entries(bundled.parent as Record<string, number>).map(([child, parent]) => [Number(child), parent]),
);
