# syntax=docker/dockerfile:1

# ---- Build stage ----------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install dependencies with a clean, reproducible lockfile install.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci

# Build the client and keep only production dependencies.
COPY . .
RUN npm run build \
 && npm prune --omit=dev

# ---- Runtime stage --------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5050 \
    SERVE_STATIC=true \
    STORAGE_DIR=/data/storage

WORKDIR /app

RUN groupadd --system --gid 10001 minchat \
 && useradd --system --uid 10001 --gid minchat --home /app minchat \
 && mkdir -p /data/storage \
 && chown -R minchat:minchat /data

COPY --from=build --chown=minchat:minchat /app/package.json /app/package-lock.json ./
COPY --from=build --chown=minchat:minchat /app/node_modules ./node_modules
COPY --from=build --chown=minchat:minchat /app/server ./server
COPY --from=build --chown=minchat:minchat /app/client/dist ./client/dist
COPY --from=build --chown=minchat:minchat /app/client/package.json ./client/package.json
COPY --chown=minchat:minchat deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER minchat
EXPOSE 5050
VOLUME ["/data/storage"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5050) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server/src/index.js"]
