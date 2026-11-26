/** Alert level as sent to the watch. Numeric so it costs one byte on the wire. */
export const Level = {
  Green: 0,
  Yellow: 1,
  Red: 2,
} as const;
export type Level = (typeof Level)[keyof typeof Level];

/** Upstream source the proxy is serving (`s` in the watch API). Credit it on the watch (plan §2). */
export const Source = {
  Siren: 0,
  Tryvoha: 1,
} as const;
export type Source = (typeof Source)[keyof typeof Source];

/** Bit flags explaining a level (`f` in the watch API). */
export const Flag = {
  /** The region itself has a Yellow (warning of possible threat) air-raid level. */
  OwnYellow: 1 << 0,
  /** Some sub-region (raion, hromada, or a separately announcing city) is under air-raid alert. */
  Partial: 1 << 1,
  /** Artillery shelling alert active (does not affect the colour). */
  Artillery: 1 << 2,
  /** Urban fights alert active (does not affect the colour). */
  UrbanFights: 1 << 3,
} as const;
export type Flag = (typeof Flag)[keyof typeof Flag];
