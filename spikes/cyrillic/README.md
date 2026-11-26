# Spike: Ukrainian text on the FR55 (D8)

D8 chose Latin region names because the FR55's language list has no Ukrainian. But its worldwide font set (`ww`) also serves Russian, so Cyrillic glyphs were likely present. The open question was the letters Russian doesn't use: Є є, І і, Ї ї, Ґ ґ, and the apostrophe.

Pages (UP / DOWN):

- **1–5:** one page per system font (XTINY … LARGE). Each shows sample text:
  - `Київ Львів Одеса`
  - `Харківська`
  - the Ukrainian-only letters
  - `м’ята сім'я`, for both apostrophes
  - a string from `strings.xml`, to test the resource-compiler path
  - a Latin reference line
- **6:** the width in pixels of each test character in XTINY / SMALL. A missing glyph measures 0, or the width of the font's fallback box. The CJK character `中` (4E2D) is a known-missing reference.

## Build

```powershell
node scripts/watch.ts sim fr55 spikes/cyrillic     # → spikes/cyrillic/bin/cyrillic-fr55.prg
```

For the device, copy `bin\cyrillic-fr55.prg` to `GARMIN\APPS\` over USB.

## Results

| Check                                         | Simulator (SDK 9.2.0, FR55 3.4.2) | FR55 |
| --------------------------------------------- | --------------------------------- | ---- |
| Basic Cyrillic (`Київ Львів Одеса`)           | ✅ renders (XTINY)                |      |
| Є є І і Ї ї Ґ ґ                               | ✅ renders (XTINY)                |      |
| Apostrophes ’ (2019) and ' (0027)             | ✅ renders (XTINY)                |      |
| String from `strings.xml`                     | ✅ renders                        |      |
| TINY / SMALL / MEDIUM / LARGE pages           |                                   |      |
| Width table: any 0 px among the Ukrainian set |                                   |      |
| Status-page fit: `Дніпропетровська` in SMALL  |                                   |      |

The simulator draws with copies of the device's own font files (`FNT_006B386900_CDPG_ROBOTO_*`, keyed by the FR55's part number). The device should therefore match, but only the watch can confirm it. FR55 units sold in Asia (part number 006-B4033) use different font sets.
