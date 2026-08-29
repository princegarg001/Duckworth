# syntax=docker/dockerfile:1.7
#
# Ingest image — a one-shot job, not a service.
#
# Runs as a Kubernetes Job / Cloud Run Job (and as the `migrate` service in
# compose) rather than a long-lived container: it migrates, loads, refreshes
# the marts, and exits non-zero if any data-quality check fails.
#
# It carries the SQL that the API does not: `packages/db/migrations` and
# `packages/db/checks` ship inside this image so the schema and its contract
# travel together and cannot drift from each other between deploys.

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
COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/ingest/ apps/ingest/

RUN pnpm --filter @ipl/config --filter @ipl/domain --filter @ipl/observability \
         --filter @ipl/db --filter @ipl/ingest build

RUN pnpm --filter @ipl/ingest deploy --legacy --prod /out

FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian12:nonroot AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    SOURCE_DIR=/data/raw

COPY --from=build --chown=nonroot:nonroot /out ./

USER nonroot

# `all` = migrate -> load -> refresh -> verify, exiting non-zero on any failed
# check. Override with `["dist/cli.js","migrate"]` for a migrate-only job.
ENTRYPOINT ["dist/cli.js"]
CMD ["all"]
