# syntax=docker/dockerfile:1.7
#
# API image: multi-stage, ending on distroless.
#
# Layers are ordered by change frequency — lockfile, then dependencies, then
# source — so editing a route does not re-resolve the dependency graph.
#
# The runtime stage has no shell and no package manager. That removes most of
# the CVE surface an image normally carries, and it means a compromised process
# has nothing to exec. The usual objection is "how do you debug it?": with an
# ephemeral debug container (`kubectl debug -it <pod> --image=busybox
# --target=api`), which shares the process namespace without the production
# image ever shipping a shell.

ARG NODE_VERSION=22

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Only the manifests, so this layer is cached until a dependency actually
# changes. pnpm needs every workspace package.json to resolve the graph.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/ingest/package.json apps/ingest/
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/db/package.json packages/db/
COPY packages/domain/package.json packages/domain/
COPY packages/observability/package.json packages/observability/

# --frozen-lockfile: a build that can silently resolve a different tree than
# the one that was tested is not a reproducible build.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── build ───────────────────────────────────────────────────────────────────
FROM deps AS build
WORKDIR /repo
COPY tsconfig.base.json turbo.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/

RUN pnpm --filter @ipl/config --filter @ipl/domain --filter @ipl/contracts \
         --filter @ipl/observability --filter @ipl/db --filter @ipl/api build

# `deploy` flattens the workspace into a single self-contained tree with only
# production dependencies, so the runtime image carries no build toolchain and
# no symlinked workspace graph.
RUN pnpm --filter @ipl/api deploy --legacy --prod /out

# ── runtime ─────────────────────────────────────────────────────────────────
FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian12:nonroot AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build --chown=nonroot:nonroot /out ./

USER nonroot
EXPOSE 3000

# No HEALTHCHECK: distroless has no shell and no curl, so a Dockerfile
# healthcheck would need a Node one-liner that costs a process spawn every few
# seconds. The orchestrator's HTTP probe hits /health/ready directly instead —
# see infra/helm and docker-compose.yml.

CMD ["dist/server.js"]
