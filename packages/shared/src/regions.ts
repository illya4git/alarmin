/**
 * Top-level regions a user can pick on the watch.
 *
 * - `id` is the canonical region ID: the ukrainealarm.com / siren.pp.ua `regionId`.
 * - `idx` is the region's position in the `/v1/all` status string and on the map.
 *   APPEND ONLY: never reorder or reuse an index; deployed watches decode by position.
 * - `tryvohaSlug` maps to tryvoha.online (`null` where Tryvoha has no such region).
 * - `parentId` marks cities that announce alerts separately but lie inside an oblast;
 *   an alert in such a city makes the parent oblast at least yellow (partial).
 *
 * Source: siren.pp.ua /api/v3/regions and tryvoha.online /api/v1/regions, 2026-11-24.
 * Sevastopol is absent from both sources.
 */

export type RegionKind = 'oblast' | 'city' | 'autonomy';

export interface Region {
  idx: number;
  id: number;
  kind: RegionKind;
  /** Short Latin label shown on the watch (FR55 fonts have no Cyrillic). */
  nameLatin: string;
  /** Official Ukrainian name as returned by Siren. */
  nameUk: string;
  tryvohaSlug: string | null;
  parentId: number | null;
}

// biome-ignore format: one row per region reads better than wrapped objects
export const REGIONS = [
  { idx: 0, id: 4, kind: 'oblast', nameLatin: 'Vinnytska', nameUk: 'Вінницька область', tryvohaSlug: 'vinnicka-oblast', parentId: null },
  { idx: 1, id: 8, kind: 'oblast', nameLatin: 'Volynska', nameUk: 'Волинська область', tryvohaSlug: 'volinska-oblast', parentId: null },
  { idx: 2, id: 9, kind: 'oblast', nameLatin: 'Dnipropetrovska', nameUk: 'Дніпропетровська область', tryvohaSlug: 'dnipropetrovska', parentId: null },
  { idx: 3, id: 28, kind: 'oblast', nameLatin: 'Donetska', nameUk: 'Донецька область', tryvohaSlug: 'donecka-oblast', parentId: null },
  { idx: 4, id: 10, kind: 'oblast', nameLatin: 'Zhytomyrska', nameUk: 'Житомирська область', tryvohaSlug: 'zitomirska-oblast', parentId: null },
  { idx: 5, id: 11, kind: 'oblast', nameLatin: 'Zakarpatska', nameUk: 'Закарпатська область', tryvohaSlug: 'zakarpatska-oblast', parentId: null },
  { idx: 6, id: 12, kind: 'oblast', nameLatin: 'Zaporizka', nameUk: 'Запорізька область', tryvohaSlug: 'zaporizka-oblast', parentId: null },
  { idx: 7, id: 13, kind: 'oblast', nameLatin: 'Ivano-Frankivska', nameUk: 'Івано-Франківська область', tryvohaSlug: 'ivano-frankivska-oblast', parentId: null },
  { idx: 8, id: 14, kind: 'oblast', nameLatin: 'Kyivska', nameUk: 'Київська область', tryvohaSlug: 'kyivska', parentId: null },
  { idx: 9, id: 15, kind: 'oblast', nameLatin: 'Kirovohradska', nameUk: 'Кіровоградська область', tryvohaSlug: 'kirovogradska-oblast', parentId: null },
  { idx: 10, id: 16, kind: 'oblast', nameLatin: 'Luhanska', nameUk: 'Луганська область', tryvohaSlug: 'luganska-oblast', parentId: null },
  { idx: 11, id: 27, kind: 'oblast', nameLatin: 'Lvivska', nameUk: 'Львівська область', tryvohaSlug: 'lvivska', parentId: null },
  { idx: 12, id: 17, kind: 'oblast', nameLatin: 'Mykolaivska', nameUk: 'Миколаївська область', tryvohaSlug: 'mikolayivska-oblast', parentId: null },
  { idx: 13, id: 18, kind: 'oblast', nameLatin: 'Odeska', nameUk: 'Одеська область', tryvohaSlug: 'odeska', parentId: null },
  { idx: 14, id: 19, kind: 'oblast', nameLatin: 'Poltavska', nameUk: 'Полтавська область', tryvohaSlug: 'poltavska-oblast', parentId: null },
  { idx: 15, id: 5, kind: 'oblast', nameLatin: 'Rivnenska', nameUk: 'Рівненська область', tryvohaSlug: 'rivnenska-oblast', parentId: null },
  { idx: 16, id: 20, kind: 'oblast', nameLatin: 'Sumska', nameUk: 'Сумська область', tryvohaSlug: 'sumska-oblast', parentId: null },
  { idx: 17, id: 21, kind: 'oblast', nameLatin: 'Ternopilska', nameUk: 'Тернопільська область', tryvohaSlug: 'ternopilska-oblast', parentId: null },
  { idx: 18, id: 22, kind: 'oblast', nameLatin: 'Kharkivska', nameUk: 'Харківська область', tryvohaSlug: 'xarkivska-oblast', parentId: null },
  { idx: 19, id: 23, kind: 'oblast', nameLatin: 'Khersonska', nameUk: 'Херсонська область', tryvohaSlug: 'xersonska-oblast', parentId: null },
  { idx: 20, id: 3, kind: 'oblast', nameLatin: 'Khmelnytska', nameUk: 'Хмельницька область', tryvohaSlug: 'xmelnycka-oblast', parentId: null },
  { idx: 21, id: 24, kind: 'oblast', nameLatin: 'Cherkaska', nameUk: 'Черкаська область', tryvohaSlug: 'cerkaska-oblast', parentId: null },
  { idx: 22, id: 26, kind: 'oblast', nameLatin: 'Chernivetska', nameUk: 'Чернівецька область', tryvohaSlug: 'cernivecka-oblast', parentId: null },
  { idx: 23, id: 25, kind: 'oblast', nameLatin: 'Chernihivska', nameUk: 'Чернігівська область', tryvohaSlug: 'cernigivska-oblast', parentId: null },
  { idx: 24, id: 31, kind: 'city', nameLatin: 'Kyiv city', nameUk: 'м. Київ', tryvohaSlug: 'kyiv', parentId: null },
  { idx: 25, id: 1293, kind: 'city', nameLatin: 'Kharkiv city', nameUk: 'м. Харків та Харківська територіальна громада', tryvohaSlug: 'm-xarkiv-ta-xarkivska-teritorialna-gromada', parentId: 22 },
  { idx: 26, id: 564, kind: 'city', nameLatin: 'Zaporizhzhia city', nameUk: 'м. Запоріжжя та Запорізька територіальна громада', tryvohaSlug: 'm-zaporizzia-ta-zaporizka-teritorialna-gromada', parentId: 12 },
  { idx: 27, id: 9999, kind: 'autonomy', nameLatin: 'Crimea', nameUk: 'Автономна Республіка Крим', tryvohaSlug: null, parentId: null },
] as const satisfies readonly Region[];

/** Region shown before the user picks one. */
export const DEFAULT_REGION_ID = 31;

export const REGION_BY_ID: ReadonlyMap<number, Region> = new Map(REGIONS.map((r) => [r.id, r]));
export const REGION_BY_TRYVOHA_SLUG: ReadonlyMap<string, Region> = new Map(
  REGIONS.flatMap((r) => (r.tryvohaSlug ? [[r.tryvohaSlug, r] as const] : [])),
);
