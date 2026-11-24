# Alarmin — Master Plan

Ukrainian air-raid alert widget for Garmin watches (Forerunner 55 first), backed by a small Dockerized TypeScript proxy.

> Not a life-safety system. Official sources (the «Повітряна тривога» app, sirens) always take priority. This must be stated in the app's About screen and in the README.

---

## 1. Decisions

| #   | Topic           | Decision                                                                                                                                                                                                                                                                                                                                                                         |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Data sources    | Main source: **siren.pp.ua**. Fallback: **tryvoha.online**. Both need no key. alerts.in.ua isn't issuing tokens.                                                                                                                                                                                                                                                                 |
| D2  | Region level    | **Oblast** for v1: 28 regions (24 oblasts, Kyiv city, Kharkiv city, Zaporizhzhia city, Crimea; no source has Sevastopol). Table: `packages/shared/src/regions.ts`. The API is built around region IDs so **raions** can come later without breaking the watch.                                                                                                                   |
| D3  | Colour mapping  | 🟥 **Red** = oblast-wide Red air-raid alert. 🟨 **Yellow** = oblast-level _Yellow_ (warning of possible threat) **or** any raion/hromada inside the oblast under alert (_partial_). 🟩 **Green** = none. Grey `?` = data stale or unknown.                                                                                                                                       |
| D4  | Audience        | Personal / sideloaded first. Designed so it can go on the Connect IQ Store later.                                                                                                                                                                                                                                                                                                |
| D5  | Monorepo        | **pnpm workspaces** for the TypeScript side, plus a plain Monkey C project in `apps/watch`. The shared region table generates the Monkey C constants.                                                                                                                                                                                                                            |
| D6  | On state change | The background task **asks to open the app on every change** (`Background.requestApplicationWake`). **Tested on a real FR55 (§7):** native black-and-white dialog with the message and Accept/Decline, **one vibration** when it appears. This is the app's only alert channel. Data model and settings are ready for **configurable alarms** later (per transition, per level). |
| D7  | Proxy auth      | **Static app key** in a header (`X-Alarmin-Key`), plus per-IP rate limiting. Can be swapped for per-device tokens before a Store release.                                                                                                                                                                                                                                        |

### Defaults I chose (change any you disagree with)

| #   | Topic                           | Default                                                                                                                                            | Why                                                                                                                                                                                      |
| --- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D8  | Region names on the watch       | **Latin transliteration** (`Kyivska`, `Kyiv city`, `Lvivska`…)                                                                                     | The FR55's language list (from the SDK `compiler.json`) has no Ukrainian, so the system fonts very likely lack Cyrillic. A custom Cyrillic bitmap font is a later option (costs memory). |
| D9  | Alert types that set the colour | **AIR** only. `ARTILLERY` and `URBAN_FIGHTS` show as a small secondary marker.                                                                     | Matches "air raid" in the brief. Other types affect few oblasts and would otherwise keep them red permanently.                                                                           |
| D10 | Timestamps                      | The proxy sends Unix epoch seconds. The watch formats local time.                                                                                  | Smallest payload, no timezone logic on the watch.                                                                                                                                        |
| D11 | Proxy stack                     | Node 26 LTS (via fnm, `.node-version`), TypeScript 7, **Fastify**, **zod** (upstream validation), **pino**, `node:test`, **Biome** (lint + format) | Small, fast, well typed. Fastify's built-in schema serialization keeps payloads tiny.                                                                                                    |
| D12 | TLS / hosting                   | Docker Compose + **Caddy** (automatic Let's Encrypt) on a small VPS                                                                                | Garmin Connect Mobile requires **HTTPS with a valid certificate**, so self-signed or plain HTTP won't work from a real watch.                                                            |

---

## 2. Data sources

Checked live on 2026-11-24.

| Source                                                 | Key                      | Coverage                                                                  | Levels                                                       | Limits / terms                                                                                                                        | Role                                                                            |
| ------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **siren.pp.ua** `/api/v3/alerts`, `/api/v3/regions`    | none                     | oblast → raion → hromada (`State`/`District`/`Community`, ~1,600 regions) | `Red` / `Yellow`, types `AIR` / `ARTILLERY` / `URBAN_FIGHTS` | **No published terms or limits.** One third-party project reports 50 req/min/IP. Same format as the official ukrainealarm.com v3 API. | **Main**                                                                        |
| **tryvoha.online** `/api/v1/alerts`, `/api/v1/regions` | none                     | oblast/raion/hromada by slug                                              | `red` / `yellow` (their definition: yellow = drone threat)   | 120 req/min/IP; responses cached 30–60 s; **attribution to Tryvoha.online required**; commercial use allowed                          | **Fallback** + cross-check                                                      |
| ubilling.net.ua `/aerialalerts/`                       | none                     | oblasts only                                                              | on/off only                                                  | 2 req/s/host, ban warning                                                                                                             | Not used. Possible last-resort fallback.                                        |
| alerts.in.ua                                           | token (not being issued) | all levels, compact IoT endpoints                                         | R/Y/P/N                                                      | 8–12 req/min, proxy required                                                                                                          | Adapter later if tokens come back                                               |
| api.ukrainealarm.com (official)                        | key on application       | all levels                                                                | Red/Yellow                                                   | unknown (site blocks automated fetching)                                                                                              | **Apply for a key now.** Same format as Siren, so switching is a config change. |

### Siren `/api/v3/alerts` shape (only regions with active alerts are listed)

```json
[
  {
    "regionId": "99",
    "regionType": "District",
    "regionName": "Подільський район",
    "lastUpdate": "2026-11-24T15:19:48Z",
    "activeAlerts": [
      {
        "regionId": "99",
        "regionType": "District",
        "type": "AIR",
        "lastUpdate": "...",
        "activeAlertLevels": [{ "alertLevel": "Yellow", "reason": "", "createdAt": "..." }]
      }
    ]
  }
]
```

`/api/v3/regions` → `{ "states": [{ "regionId", "regionName", "regionType", "regionChildIds": [...] }] }` (~150 KB). It's used to map each child region to its oblast, which is how partial alerts are detected.

### Data caveats to handle in code

- Both sources keep **stale permanent alerts** (Crimea, Sevastopol, Luhansk have been red since 2022). Keep them as-is (they're real) and mark them "since 2022" in the UI.
- Siren has no global "data as of" timestamp. Staleness is detected through transport errors, schema errors and the cross-check with Tryvoha (§3.3).
- Tryvoha uses slugs and Siren uses numeric IDs. The mapping lives in `packages/shared`.
- Tryvoha's attribution ("Data: Tryvoha.online") must appear in the watch About screen and the README whenever it's used. Credit Siren as well.

---

## 3. Architecture

```
 ┌────────────── Watch (FR55, CIQ 3.4) ───────────────┐
 │ Glance (32 KB)   reads Storage → colour + name     │
 │ Widget (64 KB)   foreground poll every 10 s        │──┐
 │ Background(32 KB) temporal event every 5 min       │  │ HTTPS via phone
 │ Storage: region, state, changedAt, fetchedAt       │  │ (Garmin Connect Mobile)
 └────────────────────────────────────────────────────┘  │
                                                         ▼
 ┌──────────── Proxy (Docker, Node 22 + Fastify) ─────────────┐
 │ Caddy (TLS) → /v1/*  auth: X-Alarmin-Key, per-IP limit     │
 │                                                            │
 │ Poller ──► Adapter[siren] ─┐                               │
 │        └─► Adapter[tryvoha]┴► Normalizer ► Snapshot (RAM)  │
 │ Region tree (daily refresh, on-disk cache)                 │
 └────────────────────────────────────────────────────────────┘
            ▲ every 5 s                ▲ every 60 s (every 15 s in fallback)
       siren.pp.ua               tryvoha.online
```

### 3.1 Proxy

**Poller (single loop, process-wide)**

- Siren `/api/v3/alerts` every **5 s** (12 req/min, well under the reported limit). Send `If-None-Match`/`If-Modified-Since` if Siren supports them (verify in Phase 0).
- Tryvoha `/api/v1/alerts` every **60 s** as a cross-check. Every **15 s** while in fallback (no point going faster, given their 30–60 s cache).
- Region tree from Siren `/api/v3/regions` at startup and every 24 h, saved to a volume. The bundled `packages/shared` table is the cold-start fallback.

**Source selection (simple state machine)**

- `PRIMARY` → `FALLBACK` after 3 failed Siren fetches in a row (HTTP error, timeout > 4 s, or zod schema failure), or no successful fetch for 30 s.
- `FALLBACK` → `PRIMARY` after 3 successful Siren fetches in a row.
- Both down → keep serving the last snapshot with `stale=1` and `age`.
- Divergence (Siren and Tryvoha disagree on an oblast colour for more than 3 min) → log a warning and expose it in `/healthz`. No automatic switch; we'd be guessing which source is right.

**Normalizer** → one `Snapshot`:

```ts
type Level = 0 | 1 | 2; // green | yellow | red
interface RegionState {
  id: number; // ukrainealarm/Siren regionId (canonical ID)
  level: Level;
  flags: number; // bit0 oblast-yellow, bit1 partial, bit2 artillery, bit3 urban-fights
  since: number; // epoch s of the current level
}
interface Snapshot {
  at: number;
  source: 'siren' | 'tryvoha';
  stale: boolean;
  regions: Map<number, RegionState>;
}
```
Oblast rule (D3): `red` if the oblast itself has an AIR alert at `Red`. Otherwise `yellow` if the oblast has AIR `Yellow` or any of its children has an AIR alert. Otherwise `green`. `since` is recorded when an oblast's level changes, so it covers transitions caused by children too.

**Watch-facing API**: tiny JSON with short keys, meant to be parsed in a few hundred bytes.

| Endpoint        | Response                                                                                                         | Use                         |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `GET /v1/s/:id` | `{"l":2,"f":1,"t":1732460000,"a":4,"x":0}` (level, flags, since, data age in s, stale)                           | Glance/widget/background    |
| `GET /v1/all`   | `{"m":"0021001…","t":…,"a":4,"x":0}` (`m` is one digit per oblast in the fixed map order from `packages/shared`) | Future map view             |
| `GET /v1/meta`  | `{"v":1,"src":"siren","min":"0.1.0"}`                                                                            | Version check / attribution |
| `GET /healthz`  | full JSON status (no auth, or a separate admin key)                                                              | Monitoring                  |

Versioned under `/v1` so the watch and proxy can evolve independently. Responses are built from the in-memory snapshot with no upstream call per request, so watch traffic is effectively free.

### 3.2 Watch (FR55: API 3.4, 208×208 MIP, 8 colours)

App type: **widget with a glance**.

| Part                            | Memory | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(:glance)` GlanceView          | 32 KB  | Draws from `Storage`: colour block or ring, Latin region name, "since HH:MM", data age. On each start it also sends one throttled `makeWebRequest` (if the reply lands, it goes into `Storage` for the next draw; must be verified in Phase 0). The FR55 renders glances in "background UI update" mode: the system starts the app, draws once and caches the image, redraws at most every ~30 s while visible, and ignores `requestUpdate()`, so a glance can't poll continuously. |
| WidgetView                      | 64 KB  | Large status; while open, `Timer` every **10 s** → `makeWebRequest /v1/s/:id`. Long press / menu → region picker (`Menu2`, 27 items generated from shared). Later: map page.                                                                                                                                                                                                                                                                                                        |
| `(:background)` ServiceDelegate | 32 KB  | `registerForTemporalEvent(5 min)`. Fetches `/v1/s/:id`, compares with the last known level, `Background.exit(dict)`. On change → `requestApplicationWake(msg)`, then `exit()` (the dialog appears only after exit). `msg` is short, with the important word first, e.g. `"Kyivska: RED"`, `"Kyivska: yellow"`, `"Kyivska: all clear"`. The dialog wraps at ~14 characters per line in a large font, and the buttons take the lower half.                                            |
| App `onBackgroundData`          | —      | Writes the result to `Application.Storage`, then `WatchUi.requestUpdate()`.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Settings                        | —      | `properties.xml` + `settings.xml`: region list (also editable in the Garmin Connect app), proxy URL. Future alarm toggles reserved here (D6).                                                                                                                                                                                                                                                                                                                                       |

**Stored state** (`Storage`): `{ r: regionId, l: level, f: flags, t: since, ft: fetchedAt, err: lastErrorCode }`. The glance shows grey `?` when `now - ft > 15 min` or `x == 1`.

**Alarms later (D6 groundwork)**: settings keys `al_red`, `al_yellow`, `al_green` (bool, all default `true` for now). The background reads them before calling `requestApplicationWake`. The dialog itself vibrates once. After Accept, the widget plays a level-specific `Attention.vibrate` pattern (e.g. long-long-long for red, one short for clear), which also makes the level recognisable without looking.

**Colour on an 8-colour MIP**: red `0xFF0000`, yellow `0xFFFF00`, green `0x00FF00`, all exact palette colours, no dithering. Text black on yellow/green, white on red.

### 3.3 Freshness end to end

1. Upstream → proxy: snapshot `at` and `stale` from the state machine.
2. Proxy → watch: `a` (age) and `x` (stale) in every response.
3. Watch: `fetchedAt` stored. Grey state if old. Without a phone connection, `makeWebRequest` fails and is shown as "no phone" in the widget.

### 3.4 Region IDs (raion-ready)

The canonical ID is the **ukrainealarm/Siren `regionId`**. `packages/shared/regions.ts` holds for each oblast: `id`, `sirenId`, `tryvohaSlug`, `nameUk`, `nameLatin`, `mapIndex`. Raions are added later as a generated file from `/api/v3/regions` (with Tryvoha slugs matched by name). The watch API already takes any `:id`, so raion support is UI-only work plus a two-step picker.

---

## 4. Repository layout

```
alarmin/
├─ package.json              # pnpm root: scripts (build, test, codegen, watch:build, watch:sim)
├─ pnpm-workspace.yaml       # apps/proxy, packages/*
├─ .editorconfig  .gitignore  .env.example
├─ apps/
│  ├─ proxy/
│  │  ├─ src/
│  │  │  ├─ adapters/{siren,tryvoha}.ts   # fetch + zod schema → raw alerts
│  │  │  ├─ normalize.ts                  # raw → Snapshot (D3 rules)
│  │  │  ├─ poller.ts                     # timers, source state machine
│  │  │  ├─ regions.ts                    # tree refresh + cache
│  │  │  ├─ routes/{v1,health}.ts
│  │  │  └─ server.ts
│  │  ├─ test/fixtures/                   # recorded real upstream payloads
│  │  ├─ Dockerfile                       # multi-stage, non-root, node:22-alpine
│  │  └─ package.json  tsconfig.json
│  └─ watch/                              # plain Monkey C project (not a pnpm package)
│     ├─ manifest.xml  monkey.jungle
│     ├─ source/{App,GlanceView,WidgetView,Background,Api,Picker}.mc
│     ├─ source/generated/Regions.mc      # ← codegen, committed
│     └─ resources/{strings,settings,properties,drawables}/
├─ packages/
│  └─ shared/
│     ├─ src/regions.ts                   # source of truth
│     └─ scripts/gen-monkeyc.ts           # → apps/watch/source/generated + resources/settings list
├─ deploy/
│  ├─ docker-compose.yml                  # proxy + caddy
│  └─ Caddyfile
└─ docs/
   ├─ PLAN.md   api.md   sources.md
```

- Watch build: Connect IQ SDK + `monkeyc` with a developer key path from an env var (never committed). Root scripts wrap `monkeyc -d fr55 -f apps/watch/monkey.jungle`. VS Code Monkey C extension for the simulator.
- CI later: GitHub Actions for proxy lint/test/docker build. The watch build is possible with the SDK in CI but optional.

---

## 5. Phases

**Phase 0: Spikes (de-risk, ~1–2 days)**

- [x] Siren honours `ETag` / `If-None-Match` (304s), `Cache-Control: max-age=1`. Tryvoha has no validators, `max-age=30`, sends `X-RateLimit-Remaining`.
- [ ] Analyse the 2-hour recording (`spikes/upstream-recorder/`): change frequency, 304 reliability, oblast-wide vs partial alerts, Siren vs Tryvoha lag. Pick fixtures.
- [x] Tryvoha slug ↔ Siren ID map for all 28 regions (`pnpm --filter @alarmin/shared verify-upstream` checks it against live data).
- [x] Wake prompt on a real FR55: works, native dialog, one vibration (§7). Spike: `spikes/wake-prompt/`.
- [ ] Can the background read `Storage`? (Writing goes via `Background.exit`.)
- [ ] Glance refresh: on a real FR55, does a `makeWebRequest` sent from glance `onStart` deliver its callback before the glance app is shut down? How often does the system re-render a visible glance? Can the glance pull the next background run forward (`registerForTemporalEvent(Moment)`)?
- [ ] Confirm Cyrillic can't render on the FR55 (D8). Test a `Ї`/`Є` string in the simulator.
- [ ] Confirm `makeWebRequest` custom header + HTTPS through Garmin Connect Mobile on a real phone.
- [ ] Send the ukrainealarm.com API key application. Message the Siren maintainer about acceptable polling rates.

**Phase 1: Monorepo scaffold**

- [x] git init, pnpm workspace, TS config, lint/format, `packages/shared` region table, Monkey C codegen (`pnpm codegen` → `apps/watch/source/generated/Regions.mc`, compiles for the FR55).

**Phase 2: Proxy MVP**

- [ ] Siren adapter + zod schema, region tree, normalizer (unit-tested against fixtures), in-memory snapshot.
- [ ] `/v1/s/:id`, `/v1/all`, `/v1/meta`, `/healthz`; `X-Alarmin-Key` check; per-IP rate limit (`@fastify/rate-limit`).
- [ ] Dockerfile + compose + Caddy; run locally.

**Phase 3: Watch MVP**

- [ ] Region picker (on-device `Menu2` + phone settings list), `Storage` model.
- [ ] Glance view (colour, name, since, stale state).
- [ ] Widget view + 10-s foreground polling, error states (no phone / HTTP error / stale).

**Phase 4: Background and change prompt**

- [ ] 5-min temporal event, compare, `requestApplicationWake` on every change (D6), vibrate on open.
- [ ] Alarm-settings keys stubbed in properties.

**Phase 5: Resilience**

- [ ] Tryvoha adapter, source state machine, divergence logging, stale propagation.
- [ ] Attribution in About screen + README.

**Phase 6: Personal deployment**

- [ ] VPS + domain + Caddy TLS, uptime check on `/healthz`, sideload to the FR55, a week of real-world use.

**Phase 7: Map view**

- [ ] Simplify oblast polygons (e.g. mapshaper) → quantize to the 208-px grid → codegen packed coordinate arrays (resource JSON or Monkey C arrays). Measure memory against the 64 KB widget budget.
- [ ] Map page fills each oblast from `/v1/all`, highlights the selected one.

**Phase 8: Later**

- [ ] Raion selection (two-step picker, generated raion table).
- [ ] Configurable alarms (per-transition toggles, quiet hours).
- [ ] Cyrillic custom font (if memory allows).
- [ ] More devices (`manifest.xml` products, layout per resolution).
- [ ] Store readiness: per-device tokens, privacy note, official ukrainealarm key, ToS review of all sources.

---

## 6. Risks

| Risk                                                                  | Impact                                        | Mitigation                                                                                                                            |
| --------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| siren.pp.ua is unofficial with no terms; it may disappear or block us | Main source lost                              | Tryvoha fallback; apply for the official ukrainealarm key (same format); polite 5 s polling; ask the maintainer                       |
| Tryvoha's 30–60 s cache                                               | Late alerts in fallback mode                  | Fallback only; show the source in `/healthz`; still well within the 5-min background interval                                         |
| Background minimum is 5 min                                           | Up to 5 min latency when the widget is closed | Platform limit. Documented in About. The foreground updates every 10 s.                                                               |
| Watch ↔ phone disconnected                                            | No updates                                    | Grey stale state with age shown; never show stale green as current                                                                    |
| FR55 memory (glance 32 KB / background 32 KB)                         | Crashes                                       | `(:glance)` / `(:background)` annotations, minimal JSON, no string-heavy code in those scopes; check with the simulator memory viewer |
| Upstream disagreement / errors                                        | Wrong colour                                  | Cross-check + logging; disclaimer; never claim "all clear" when stale                                                                 |
| Shared static app key gets extracted                                  | Proxy abuse                                   | Rate limiting, key rotation via app update; per-device tokens before Store                                                            |

---

## 7. Findings log

| Date       | Finding                                                                                                                                                                                                             | Effect on the plan                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 2026-11-24 | `requestApplicationWake` on a real FR55: native full-screen black-and-white dialog (message on top, Accept / Decline list), **one vibration** on appearance. The simulator shows only a generic Windows dialog.     | D6 confirmed as the only alert channel; phone-notification fallback dropped. Messages kept short (§3.2). |
| 2026-11-24 | FR55 glances use "background UI update" mode: drawn once and cached, redrawn ≥30 s apart while visible, `requestUpdate()` ignored.                                                                                  | Glance can't poll; fetch-on-start idea to verify (Phase 0).                                              |
| 2026-11-24 | Region lists: Kharkiv city (1293) and Zaporizhzhia city (564) announce alerts separately from their oblasts in both sources. Sevastopol is in neither; Crimea only in Siren. Siren also lists a test region (id 0). | 28 selectable regions; a city alert makes its parent oblast yellow (`parentId`).                         |
| 2026-11-24 | Siren supports ETag/304; its data changed several times a minute in testing. Tryvoha has no validators.                                                                                                             | Proxy sends `If-None-Match` to Siren; full fetch from Tryvoha.                                           |
| 2026-11-24 | FR55 device file: API 3.4, glance 32 KB, background 32 KB, widget 64 KB, 8-colour palette, no Ukrainian language.                                                                                                   | Memory budgets, exact palette colours, Latin names (D8).                                                 |

## 8. Open items

- Domain and VPS provider for the proxy (needed by Phase 6).
- Whether to keep a third fallback (Ubilling, oblast on/off only) in Phase 5.
- App display name and icon.
- Licence for the repo (MIT suggested).
