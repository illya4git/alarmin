import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_REGION_ID, REGION_BY_ID, REGIONS } from '../src/regions.ts';

test('idx equals array position (append-only map order)', () => {
  for (const [i, r] of REGIONS.entries()) {
    assert.equal(r.idx, i, `${r.nameLatin} has idx ${r.idx}, expected ${i}`);
  }
});

test('ids, names and Tryvoha slugs are unique', () => {
  const unique = (values: readonly unknown[]) => new Set(values).size === values.length;
  assert.ok(unique(REGIONS.map((r) => r.id)), 'duplicate id');
  assert.ok(unique(REGIONS.map((r) => r.nameLatin)), 'duplicate nameLatin');
  assert.ok(unique(REGIONS.flatMap((r) => (r.tryvohaSlug ? [r.tryvohaSlug] : []))), 'duplicate slug');
});

test('parents exist and are oblasts', () => {
  for (const r of REGIONS) {
    if (r.parentId === null) continue;
    assert.equal(REGION_BY_ID.get(r.parentId)?.kind, 'oblast', `${r.nameLatin} parent`);
  }
});

test('Latin names are ASCII and fit the watch', () => {
  for (const r of REGIONS) {
    assert.match(r.nameLatin, /^[\x20-\x7e]+$/, r.nameLatin);
    assert.ok(r.nameLatin.length <= 18, `${r.nameLatin} is too long`);
  }
});

test('default region exists', () => {
  assert.ok(REGION_BY_ID.has(DEFAULT_REGION_ID));
});
