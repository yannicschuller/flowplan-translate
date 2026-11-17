# syntax=docker/dockerfile:1
# flowplan-translate – image for Coolify's Dockerfile build pack (or any
# Docker host). Build with Next.js standalone output, run as the non-root
# user "node" with one data volume (/app/data: SQLite database and the
# generated key for hashed rate-limit keys).
FROM node:26-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# npm's download cache survives between builds (BuildKit cache mount).
RUN --mount=type=cache,target=/root/.npm npm ci
FROM deps AS build
COPY . .
# The CI checkout may be private (umask 077); the app runs as node.
RUN chmod -R a+rX /app
ENV NEXT_TELEMETRY_DISABLED=1
# The type check already runs in CI; image builds there skip it.
ARG FLOWPLAN_SKIP_TYPECHECK=""
RUN --mount=type=cache,target=/app/.next/cache npm run build
FROM node:26-bookworm-slim AS runtime
LABEL org.opencontainers.image.title="flowplan-translate" \
  org.opencontainers.image.description="Translate Flowplan in the browser – reviewed translations go back to the repositories as pull requests." \
  org.opencontainers.image.source="https://github.com/yannicschuller/flowplan-translate" \
  org.opencontainers.image.url="https://translate.flowplan.org" \
  org.opencontainers.image.licenses="AGPL-3.0-only"
# OS security updates; curl for Coolify's HTTP healthcheck inside the
# container; npm, npx and corepack are not needed at runtime.
RUN apt-get update && apt-get upgrade -y --no-install-recommends \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 \
  TRANSLATE_DATA_DIR=/app/data NODE_OPTIONS=--disable-warning=ExperimentalWarning
RUN mkdir /app/data && chown node:node /app/data && chmod 700 /app/data
# Application files belong to root: the runtime user can't change them.
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# The catalogues to translate (read at runtime by lib/components.ts).
COPY --from=build /app/components.json ./components.json
USER node
VOLUME ["/app/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
