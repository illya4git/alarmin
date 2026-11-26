# Alarmin

Ukrainian air-raid alert status on a Garmin watch (Forerunner 55 first), served by a small self-hosted proxy.

> **Not a life-safety system.** Use the official «Повітряна тривога» app and sirens first. Alarmin can be late or wrong: it depends on unofficial data sources, your phone's connection and the watch's 5-minute background limit.

## What it does

- **Glance:** your region's colour, name and "since" time.
- **Widget:** the same status in full screen, refreshed every 10 seconds while open.
- **Background check every 5 minutes:** when the colour changes, the watch shows a prompt (one vibration). Open it to see the new status.

Colours, per oblast (or Kyiv / Kharkiv / Zaporizhzhia city, or Crimea):

| Colour   | Meaning                                                                  |
| -------- | ------------------------------------------------------------------------ |
| Red      | Air-raid alert for the whole region                                      |
| Yellow   | Alert in part of the region, or a region-wide warning of possible threat |
| Green    | No air-raid alert                                                        |
| Grey `?` | Data missing, stale, or not covered by the current source                |

## Data sources

| Source                                   | Role                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| [siren.pp.ua](https://siren.pp.ua)       | Main source, polled every 5 s                               |
| [Tryvoha.online](https://tryvoha.online) | Fallback when Siren is down, and a cross-check every minute |

**Data: siren.pp.ua and Tryvoha.online.** Thanks to both projects. Tryvoha.online's terms require this attribution wherever its data is used. The watch shows "via Tryvoha" while the proxy is serving Tryvoha data, and credits both sources in its About screen.

## How it fits together

```
watch ──HTTPS via phone──► your reverse proxy (TLS) ──► proxy container :8080 ──► siren.pp.ua / tryvoha.online
```

The watch never talks to the sources directly. The proxy polls them, applies one colour rule to both, and answers the watch with a few dozen bytes per request.

## Running the proxy

One small container (amd64 or arm64, about 50 MiB of RAM). TLS, the domain and the reverse proxy are up to you, but a real watch only accepts **HTTPS with a valid certificate**.

```sh
cp .env.example .env   # set APP_KEYS (the shared key the watch sends)
docker compose up -d --build
curl http://127.0.0.1:8080/healthz
```

`/healthz` needs no key. It returns 503 when the data is stale, and shows the source being served, each source's health and any regions where the sources disagree. The other options are listed in [.env.example](.env.example).

## Building the watch app

Needs the Connect IQ SDK, a developer key and Node (see `.node-version`) with pnpm.

```sh
pnpm install
# in .env: WATCH_DEVELOPER_KEY, WATCH_PROXY_URL; the first APP_KEYS entry is built into the app
pnpm watch:build   # → apps/watch/bin/alarmin-fr55.prg; copy it to GARMIN/APPS/ over USB
pnpm watch:sim     # run in the simulator
```

## Repository

- `apps/proxy`: TypeScript proxy (Fastify, zod). `pnpm test`, `pnpm typecheck`, `pnpm lint`.
- `apps/watch`: Monkey C widget.
- `packages/shared`: the region table both sides are generated from (`pnpm codegen`).
- `docs/PLAN.md`: decisions, architecture, phases and findings.

## Licence

Not chosen yet.
