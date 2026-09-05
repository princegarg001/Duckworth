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

# ── dataset ─────────────────────────────────────────────────────────────────
# The dataset is baked into the image rather than mounted at runtime.
#
# This job runs as a Cloud Run Job or a Kubernetes Job, where there is no host
# directory to bind-mount and no obvious place to put 33MB of JSON. Embedding it
# makes the image self-contained — `docker run <image> all` migrates, loads,
# refreshes and verifies with no external volume — and means the image tag
# identifies the exact bytes that were loaded.
#
# docker-compose overrides SOURCE_DIR to a read-only bind mount instead, so
# local development still reads from the working tree.
FROM node:${NODE_VERSION}-bookworm-slim AS dataset
ARG DATASET_URL="https://aiko-cricket-tips-cyeef3d8fjcfb4e0.z02.azurefd.net/core-aiko-archive/Indian_Premier_League_2022-03-26.zip?sp=r&st=2026-08-01T10:01:46Z&se=2027-04-01T18:16:46Z&sv=2026-02-06&sr=b&sig=fe6UVJbR9zAnZ%2FACgFBeJdpnM6xzonkElXr5nC35%2B9o%3D"
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /dataset
# Fail the build rather than ship an image that would load nothing: an empty
# or truncated download must not become a silently empty database.
RUN curl -sSLf -o ipl.zip "$DATASET_URL" \
 && unzip -q ipl.zip -d raw \
 && rm ipl.zip \
 && test -n "$(find raw -type d -name match_innings_commentary)" \
 && echo "dataset embedded: $(find raw -type f | wc -l) files"

# distroless/nodejs22-debian12 bundles whatever libssl3 was current when that
# base image last rebuilt; when a CVE lands in between rebuilds, this image
# carries it until Google republishes. Debian's own security repo already has
# the fix, so pull just the two shared objects from a fresh install here and
# overwrite distroless's copies below — no shell or package manager ends up in
# the runtime image, only the two .so files change.
FROM debian:13-slim AS libssl-patch
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 \
    && dpkg-query -s libssl3 | grep -v '^Status:' > /libssl3.status \
    && rm -rf /var/lib/apt/lists/*

FROM gcr.io/distroless/nodejs${NODE_VERSION}-debian12:nonroot AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    SOURCE_DIR=/data/raw

COPY --from=libssl-patch /usr/lib/x86_64-linux-gnu/libssl.so.3 /usr/lib/x86_64-linux-gnu/libssl.so.3
COPY --from=libssl-patch /usr/lib/x86_64-linux-gnu/libcrypto.so.3 /usr/lib/x86_64-linux-gnu/libcrypto.so.3
# Also correct the package database's version record — Trivy scans dpkg
# metadata, not the binaries, so leaving the old entry in place would still
# report the (already-patched) library as vulnerable.
COPY --from=libssl-patch /libssl3.status /var/lib/dpkg/status.d/libssl3
COPY --from=build --chown=nonroot:nonroot /out ./
COPY --from=dataset --chown=nonroot:nonroot /dataset/raw /data/raw

USER nonroot

# The distroless nodejs image's own ENTRYPOINT is `/nodejs/bin/node`. Declaring
# our own replaces it, so node has to be named explicitly — otherwise the
# runtime tries to exec the .js file directly and fails on a missing
# interpreter. Naming it here keeps `docker run <image> migrate` working, with
# the subcommand as the only argument a caller has to think about.
#
# `all` = migrate -> load -> refresh -> verify, exiting non-zero on any failed
# check.
ENTRYPOINT ["/nodejs/bin/node", "dist/cli.js"]
CMD ["all"]
