FROM node:20-bookworm-slim AS deps

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json ./
COPY scripts ./scripts
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm run prepare:sqlite
RUN pnpm run verify:sqlite
RUN pnpm -r run build
RUN node scripts/flatten-dist.mjs

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV QIONGQI_HOST=0.0.0.0
ENV QIONGQI_PORT=8899
ENV QIONGQI_DATA_DIR=/data

RUN corepack enable

COPY --from=deps /app ./

EXPOSE 8899
VOLUME ["/data"]

CMD ["pnpm", "--filter", "@qiongqi/cli", "exec", "node", "dist/serve-entry.js", "serve", "--host", "0.0.0.0", "--port", "8899", "--data-dir", "/data"]
