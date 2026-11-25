# syntax=docker/dockerfile:1
#
# Alarmin proxy: one small container, plain HTTP on :8080. Put it behind any
# reverse proxy that terminates TLS (Garmin Connect requires HTTPS for real watches).
#
# Build from the repository root:
#   docker build -f apps/proxy/Dockerfile -t alarmin-proxy .
#   docker buildx build -f apps/proxy/Dockerfile --platform linux/arm64 -t alarmin-proxy:arm64 --load .
#
# Runs TypeScript directly (Node 26 type stripping); no build step.

# --- deps: production node_modules -------------------------------------------
# Runs on the build machine's own platform: every dependency is pure JavaScript,
# so the result works on any target and cross-builds need no emulation.
# If a dependency with a native addon is ever added, drop `--platform=$BUILDPLATFORM`.
FROM --platform=$BUILDPLATFORM node:26-alpine AS deps
RUN npm install -g pnpm@12.23.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/proxy/package.json apps/proxy/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --prod --filter "@alarmin/proxy..." --store-dir /pnpm-store

# --- runtime -----------------------------------------------------------------
# Target platform (amd64, arm64, ...). No package manager, no build tools.
FROM node:26-alpine
WORKDIR /app
COPY --from=deps /app ./
COPY packages/shared/src packages/shared/src
COPY apps/proxy/src apps/proxy/src

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "apps/proxy/src/main.ts"]
