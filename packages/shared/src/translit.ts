/**
 * Official Ukrainian → Latin transliteration (Cabinet of Ministers resolution No. 55, 2010):
 * Київ → Kyiv, Харківський → Kharkivskyi, Сєвєродонецький → Sievierodonetskyi.
 * Є Ї Й Ю Я are Ye Yi Y Yu Ya at the start of a word and ie i i iu ia elsewhere; Ь and the
 * apostrophe are dropped; "зг" is "zgh".
 */
const MAP: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'h',
  ґ: 'g',
  д: 'd',
  е: 'e',
  є: 'ie',
  ж: 'zh',
  з: 'z',
  и: 'y',
  і: 'i',
  ї: 'i',
  й: 'i',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ь: '',
  ю: 'iu',
  я: 'ia',
  "'": '',
  '’': '',
  ʼ: '',
};
const INITIAL: Record<string, string> = { є: 'ye', ї: 'yi', й: 'y', ю: 'yu', я: 'ya' };

export function transliterate(uk: string): string {
  let out = '';
  const chars = [...uk];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i] as string;
    const lower = ch.toLowerCase();
    const prev = chars[i - 1]?.toLowerCase();
    const wordStart = i === 0 || !/[\p{L}'’ʼ]/u.test(chars[i - 1] as string);
    let lat = (wordStart && INITIAL[lower]) || MAP[lower];
    if (lower === 'г' && prev === 'з') lat = 'gh';
    if (lat === undefined) {
      out += ch;
      continue;
    }
    out += ch !== lower && lat ? (lat[0] as string).toUpperCase() + lat.slice(1) : lat;
  }
  return out;
}
