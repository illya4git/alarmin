#
# Alarmin proxy: one small container, plain HTTP on :8080. Put it behind any
# reverse proxy that terminates TLS (Garmin Connect requires HTTPS for real watches).
#
# Build from the repository root (works with the classic builder and with BuildKit):
#   docker compose up -d --build
#   docker build -f apps/proxy/Dockerfile -t alarmin-proxy .
#
# Build on the machine that will run it: an ARM64 board builds an arm64 image natively.
# Cross-building (docker buildx build --platform linux/arm64 ...) also works, but needs QEMU.
#
# Runs TypeScript directly (Node 26 type stripping); no build step.

# --- deps: production node_modules -------------------------------------------
FROM node:26-alpine AS deps
RUN npm install -g pnpm@12.23.0
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/proxy/package.json apps/proxy/
# The store stays in this stage; only node_modules is copied to the runtime image.
RUN pnpm install --frozen-lockfile --prod --filter "@alarmin/proxy..." --store-dir /tmp/pnpm-store
COPY packages/shared/src packages/shared/src
COPY apps/proxy/src apps/proxy/src
# COPY keeps the checkout's file modes; a clone made with a strict umask (e.g. 077)
# would leave files unreadable to the runtime user. Make everything world-readable.
RUN chmod -R a+rX,go-w /app

# --- runtime -----------------------------------------------------------------
# No package manager, no build tools.
FROM node:26-alpine
WORKDIR /app
COPY --from=deps /app ./

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080
EXPOSE 8080
USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=20s \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "apps/proxy/src/main.ts"]
