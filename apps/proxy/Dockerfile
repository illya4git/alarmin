# Build from the repository root:  docker build -f apps/proxy/Dockerfile .
# Runs TypeScript directly (Node 26 type stripping); no build step.
FROM node:26-alpine

RUN npm install -g pnpm@12.23.0 && npm cache clean --force

WORKDIR /app

# Manifests first for layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/proxy/package.json apps/proxy/
RUN pnpm install --frozen-lockfile --prod --filter "@alarmin/proxy..."

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
