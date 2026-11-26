import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CITY_RAION, RAION_BY_ID, RAIONS, RAIONS_BY_OBLAST, TRYVOHA_COMMUNITY_RAION } from '../src/raions.ts';
import { REGION_BY_ID } from '../src/regions.ts';
import { transliterate } from '../src/translit.ts';

test('raion IDs are unique and never collide with top-level region IDs', () => {
  assert.equal(RAION_BY_ID.size, RAIONS.length);
  for (const r of RAIONS) assert.ok(!REGION_BY_ID.has(r.id), `${r.nameLatin} id ${r.id}`);
});

test('raions belong to oblasts, with idx 0..n-1 per oblast (append-only digit order)', () => {
  for (const [oblastId, raions] of RAIONS_BY_OBLAST) {
    assert.equal(REGION_BY_ID.get(oblastId)?.kind, 'oblast', `oblast ${oblastId}`);
    assert.deepEqual(
      raions.map((r) => r.idx),
      raions.map((_, i) => i),
      `oblast ${oblastId}`,
    );
  }
});

test('every oblast has raions', () => {
  for (const r of REGION_BY_ID.values()) {
    if (r.kind === 'oblast') assert.ok(RAIONS_BY_OBLAST.get(r.id)?.length, r.nameLatin);
  }
});

test('Latin names are ASCII', () => {
  for (const r of RAIONS) assert.match(r.nameLatin, /^[A-Za-z' -]+$/, r.nameLatin);
});

test('cities lie in a raion of their parent oblast; Tryvoha communities map to known raions', () => {
  for (const [city, raion] of CITY_RAION) {
    assert.equal(RAION_BY_ID.get(raion)?.oblastId, REGION_BY_ID.get(city)?.parentId, `city ${city}`);
  }
  for (const [slug, raion] of TRYVOHA_COMMUNITY_RAION) assert.ok(RAION_BY_ID.has(raion), slug);
});

test('KMU 2010 transliteration', () => {
  const cases: [string, string][] = [
    ['Київ', 'Kyiv'],
    ['Харківський', 'Kharkivskyi'],
    ['Сєвєродонецький', 'Sievierodonetskyi'],
    ['Яворівський', 'Yavorivskyi'],
    ['Кам’янець-Подільський', 'Kamianets-Podilskyi'],
    ['Звягельський', 'Zviahelskyi'],
    ['Згурівка', 'Zghurivka'],
    ['Щастинський', 'Shchastynskyi'],
    ['Їжакевич', 'Yizhakevych'],
    ['Білгород-Дністровський', 'Bilhorod-Dnistrovskyi'],
  ];
  for (const [uk, lat] of cases) assert.equal(transliterate(uk), lat, uk);
});
