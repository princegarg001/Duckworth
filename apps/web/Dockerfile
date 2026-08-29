# syntax=docker/dockerfile:1.7
#
# Web image.
#
# Uses Next's `output: 'standalone'`, which traces the module graph and emits
# only the files the server actually imports — a few tens of megabytes instead
# of the whole node_modules tree.
#
# `NEXT_PUBLIC_API_URL` is deliberately a **build argument**: Next inlines
# `NEXT_PUBLIC_*` at build time, so it cannot be changed by an environment
# variable at runtime. The compose file and the CD pipeline pass it explicitly;
# see docs/runbook.md for why a per-environment image is the honest consequence.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/ingest/package.json apps/ingest/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/observability/package.json packages/observability/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM deps AS build
WORKDIR /repo
ARG NEXT_PUBLIC_API_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/

RUN pnpm --filter @ipl/domain --filter @ipl/contracts build
RUN pnpm --filter @ipl/web build

# ── runtime ─────────────────────────────────────────────────────────────────
# node:slim rather than distroless: Next's standalone server resolves a few
# paths at startup in a way that expects a conventional filesystem layout, and
# a runtime that half-works is worse than one that is 40MB larger. The API —
# the service that is actually exposed to untrusted input — is distroless.
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3001 \
    HOSTNAME=0.0.0.0

# node:*-bookworm-slim carries whatever libssl3 was current when that image
# last rebuilt; when a CVE lands in between rebuilds, this image carries it
# until upstream republishes. Unlike the distroless runtimes, this base still
# has apt, so the fix is just pulling the patched package from Debian's own
# security repo directly.
RUN apt-get update && apt-get install -y --only-upgrade libssl3 \
    && rm -rf /var/lib/apt/lists/*

# node:slim ships a `node` user (uid 1000); use it rather than root.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public

USER node
EXPOSE 3001

CMD ["node", "apps/web/server.js"]
