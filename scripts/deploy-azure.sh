#!/usr/bin/env bash
#
# One-command deploy to Azure Container Apps, backed by Azure Database for
# PostgreSQL Flexible Server.
#
# Why Container Apps: it is the closest Azure service to the shape this
# application already has — a scale-to-zero HTTP container with a managed
# HTTPS endpoint, plus **Jobs**, which is exactly what the ingest is (run once,
# migrate, load, verify, exit non-zero if the data does not reconcile).
# App Service would need a paid tier for Linux containers and has no job
# primitive; Container Instances has neither scale-to-zero nor managed TLS.
#
# Cost on a new account: nothing. Container Apps has a permanent monthly free
# grant that this workload sits well inside, and PostgreSQL Flexible Server
# B1ms is free for the first 12 months.
#
# Usage:
#   az login
#   ./scripts/deploy-azure.sh
#
# Requires Docker running locally: `az acr build` (ACR Tasks) is disabled on
# Azure for Students subscriptions, so images are built here and pushed to
# ACR rather than built remotely.
# Everything is idempotent — re-running redeploys the current commit.

set -euo pipefail

# ── Configuration ───────────────────────────────────────────────────────────
RG="${RG:-ipl-platform}"
# centralindia is closest for an India-based reviewer; Container Apps and
# Flexible Server are both available there.
LOCATION="${LOCATION:-centralindia}"
ENV_NAME="${ENV_NAME:-ipl-env}"
PG_ADMIN="${PG_ADMIN:-ipladmin}"
PG_DB="ipl"
TAG="${TAG:-$(git rev-parse --short HEAD)}"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v az >/dev/null || die "az CLI not found — https://aka.ms/installazurecliwindows"
az account show >/dev/null 2>&1 || die "not signed in — run: az login"

SUB="$(az account show --query name -o tsv)"
say "Subscription: ${SUB} · region ${LOCATION} · tag ${TAG}"

# A generated password is never echoed and never stored in the repo.
PG_PASSWORD="${PG_PASSWORD:-$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)Aa1!}"
INTERNAL_TOKEN="${INTERNAL_API_TOKEN:-$(openssl rand -hex 24)}"

# ── Providers and extensions ────────────────────────────────────────────────
say "Registering resource providers (first run only; can take a few minutes)"
az extension add --name containerapp --upgrade --only-show-errors >/dev/null
for ns in Microsoft.App Microsoft.OperationalInsights Microsoft.ContainerRegistry Microsoft.DBforPostgreSQL; do
  az provider register --namespace "$ns" --wait --only-show-errors >/dev/null &
done
wait

# ── Resource group ──────────────────────────────────────────────────────────
say "Resource group ${RG}"
az group create -n "$RG" -l "$LOCATION" --only-show-errors -o none

# ── Resolve resource names ──────────────────────────────────────────────────
# Registry and server names are globally unique, so they carry a random suffix.
# That suffix must NOT be regenerated on a re-run, or the second attempt builds
# a whole second stack beside the first. Adopt what is already in the group;
# only mint a new name when there is nothing to adopt.
if [ -z "${ACR:-}" ]; then
  ACR="$(az acr list -g "$RG" --query '[0].name' -o tsv 2>/dev/null || true)"
  [ -n "$ACR" ] && echo "  adopting existing registry: $ACR"
fi
[ -z "${ACR:-}" ] && ACR="iplacr$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"

if [ -z "${PG_SERVER:-}" ]; then
  PG_SERVER="$(az postgres flexible-server list -g "$RG" --query '[0].name' -o tsv 2>/dev/null || true)"
  [ -n "$PG_SERVER" ] && echo "  adopting existing database: $PG_SERVER"
fi
[ -z "${PG_SERVER:-}" ] && PG_SERVER="ipl-pg-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"

# ── Container registry ──────────────────────────────────────────────────────
say "Container registry ${ACR}"
if ! az acr show -n "$ACR" -g "$RG" >/dev/null 2>&1; then
  az acr create -n "$ACR" -g "$RG" --sku Basic --admin-enabled true --only-show-errors -o none
fi
ACR_SERVER="$(az acr show -n "$ACR" -g "$RG" --query loginServer -o tsv)"

# ── PostgreSQL ──────────────────────────────────────────────────────────────
say "PostgreSQL Flexible Server ${PG_SERVER} (free tier — this takes ~5 minutes)"
if ! az postgres flexible-server show -n "$PG_SERVER" -g "$RG" >/dev/null 2>&1; then
  az postgres flexible-server create \
    -n "$PG_SERVER" -g "$RG" -l "$LOCATION" \
    --admin-user "$PG_ADMIN" --admin-password "$PG_PASSWORD" \
    --tier Burstable --sku-name Standard_B1ms \
    --storage-size 32 --version 16 \
    --public-access 0.0.0.0 \
    --yes --only-show-errors -o none
fi

# Container Apps has no fixed egress IP on the consumption plan, so the server
# is reached over its public endpoint with TLS enforced, restricted to Azure
# services. The Terraform footprint in infra/terraform does this properly with
# a private endpoint; that is the honest difference between the two paths.
az postgres flexible-server firewall-rule create \
  -n "$PG_SERVER" -g "$RG" --rule-name allow-azure \
  --start-ip-address 0.0.0.0 --end-ip-address 0.0.0.0 \
  --only-show-errors -o none 2>/dev/null || true

az postgres flexible-server db create \
  -g "$RG" -s "$PG_SERVER" -n "$PG_DB" --only-show-errors -o none 2>/dev/null || true

# The create above swallows its error (a rerun's "already exists" is
# expected), which once hid a wrong flag name silently failing every time —
# the ingest job would then fail deep inside a container with "database
# does not exist". Confirm the database is actually there before proceeding.
az postgres flexible-server db show -g "$RG" -s "$PG_SERVER" -n "$PG_DB" \
  --only-show-errors -o none 2>/dev/null || die "database '$PG_DB' does not exist on $PG_SERVER and could not be created"

# On a re-run the server already exists and the password generated above is not
# the one it has. Set it, so the connection string is correct either way.
az postgres flexible-server update -n "$PG_SERVER" -g "$RG" \
  --admin-password "$PG_PASSWORD" --only-show-errors -o none

PG_HOST="$(az postgres flexible-server show -n "$PG_SERVER" -g "$RG" --query fullyQualifiedDomainName -o tsv)"
DATABASE_URL="postgres://${PG_ADMIN}:${PG_PASSWORD}@${PG_HOST}:5432/${PG_DB}?sslmode=require"

# ── Build images ─────────────────────────────────────────────────────────
# `az acr build` (ACR Tasks) is blocked on Azure for Students subscriptions —
# "TasksOperationsNotAllowed" — so images are built locally with Docker and
# pushed instead. linux/amd64 explicitly: Container Apps does not run arm64,
# and building on an arm64 host without this flag produces an image that
# pushes fine and then fails to start with an exec-format error.
command -v docker >/dev/null || die "Docker is required to build locally (ACR remote build is not available on this subscription type)"
docker info >/dev/null 2>&1 || die "Docker daemon is not running"

say "Logging Docker in to ${ACR_SERVER}"
az acr login --name "$ACR" --only-show-errors -o none

say "Building and pushing api and ingest images"
for svc in api ingest; do
  docker buildx build --platform linux/amd64 \
    -f "apps/${svc}/Dockerfile" \
    -t "${ACR_SERVER}/${svc}:${TAG}" \
    --push .
done

# ── Container Apps environment ──────────────────────────────────────────────
say "Container Apps environment ${ENV_NAME}"
if ! az containerapp env show -n "$ENV_NAME" -g "$RG" >/dev/null 2>&1; then
  az containerapp env create -n "$ENV_NAME" -g "$RG" -l "$LOCATION" \
    --only-show-errors -o none
fi

ACR_USER="$(az acr credential show -n "$ACR" --query username -o tsv)"
ACR_PASS="$(az acr credential show -n "$ACR" --query 'passwords[0].value' -o tsv)"

# ── Ingest job ──────────────────────────────────────────────────────────────
# Runs to completion before anything serves. The image carries the dataset, so
# there is no volume to mount. Exits non-zero if any of the 23 data-quality
# checks fails, which stops the deploy here rather than letting a bad load
# become a live site.
say "Running the ingest job (migrate → load → refresh → verify)"
az containerapp job delete -n ipl-ingest -g "$RG" --yes --only-show-errors -o none 2>/dev/null || true
az containerapp job create \
  -n ipl-ingest -g "$RG" --environment "$ENV_NAME" \
  --trigger-type Manual --replica-timeout 1800 --replica-retry-limit 1 \
  --image "${ACR_SERVER}/ingest:${TAG}" \
  --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --cpu 1 --memory 2Gi \
  --secrets "db-url=${DATABASE_URL}" \
  --env-vars "DATABASE_URL=secretref:db-url" "DATABASE_SSL=true" "LOG_LEVEL=info" \
  --only-show-errors -o none

# Capture the execution name rather than polling "the first one": the list is
# not ordered, so [0] can be a previous run and the script would declare
# success on stale output.
EXEC_NAME="$(az containerapp job start -n ipl-ingest -g "$RG" --query name -o tsv)"
say "Waiting for ingest execution ${EXEC_NAME}"
for i in $(seq 1 90); do
  STATUS="$(az containerapp job execution show -n ipl-ingest -g "$RG" \
            --job-execution-name "$EXEC_NAME" --query 'properties.status' -o tsv 2>/dev/null || echo Running)"
  case "$STATUS" in
    Succeeded)
      echo "  ingest succeeded"
      break ;;
    Failed|Degraded)
      echo "  ingest failed — logs follow:"
      az containerapp job logs show -n ipl-ingest -g "$RG" \
        --container ipl-ingest --tail 80 2>/dev/null || \
        echo "  (fetch logs with: az containerapp job execution show -n ipl-ingest -g $RG --job-execution-name $EXEC_NAME)"
      die "ingest failed — most likely a data-quality check did not pass" ;;
    *)
      printf '.'; sleep 10 ;;
  esac
  [ "$i" = 90 ] && die "ingest timed out after 15 minutes"
done

# ── API ─────────────────────────────────────────────────────────────────────
say "Deploying the API"
az containerapp create \
  -n ipl-api -g "$RG" --environment "$ENV_NAME" \
  --image "${ACR_SERVER}/api:${TAG}" \
  --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --target-port 3000 --ingress external \
  --cpu 0.5 --memory 1Gi --min-replicas 0 --max-replicas 3 \
  --secrets "db-url=${DATABASE_URL}" "internal-token=${INTERNAL_TOKEN}" \
  --env-vars "NODE_ENV=production" "DATABASE_URL=secretref:db-url" "DATABASE_SSL=true" \
             "INTERNAL_API_TOKEN=secretref:internal-token" "TRUST_PROXY=true" \
             "GIT_SHA=${TAG}" "SERVICE_VERSION=${TAG}" \
             "CORS_ORIGINS=https://placeholder.invalid" \
  --only-show-errors -o none 2>/dev/null \
|| az containerapp update -n ipl-api -g "$RG" \
     --image "${ACR_SERVER}/api:${TAG}" --only-show-errors -o none

API_FQDN="$(az containerapp show -n ipl-api -g "$RG" --query 'properties.configuration.ingress.fqdn' -o tsv)"
API_URL="https://${API_FQDN}"
say "API is at ${API_URL}"

say "Smoke-testing the API"
curl -fsS --retry 12 --retry-delay 5 --retry-all-errors "${API_URL}/health/ready" \
  | python -c 'import json,sys; d=json.load(sys.stdin); print("  readiness:", d["status"]); sys.exit(1 if d["status"]=="down" else 0)'
curl -fsS "${API_URL}/v1/seasons/2022/points-table" \
  | python -c 'import json,sys; r=json.load(sys.stdin)["data"][0]; print(f"  leader: {r[\"team\"][\"shortName\"]} {r[\"points\"]}pts {r[\"netRunRate\"]:+.3f}"); assert r["netRunRate"]==0.316, "points table does not match the published standings"'

# ── Web ─────────────────────────────────────────────────────────────────────
# Built only now: Next inlines NEXT_PUBLIC_API_URL at build time, and the API's
# hostname does not exist until Container Apps has provisioned ingress.
say "Building and pushing the web image against ${API_URL}"
docker buildx build --platform linux/amd64 \
  -f apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_API_URL=${API_URL}" \
  -t "${ACR_SERVER}/web:${TAG}" \
  --push .

say "Deploying the web application"
az containerapp create \
  -n ipl-web -g "$RG" --environment "$ENV_NAME" \
  --image "${ACR_SERVER}/web:${TAG}" \
  --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --target-port 3001 --ingress external \
  --cpu 0.5 --memory 1Gi --min-replicas 0 --max-replicas 3 \
  --env-vars "NODE_ENV=production" \
  --only-show-errors -o none 2>/dev/null \
|| az containerapp update -n ipl-web -g "$RG" \
     --image "${ACR_SERVER}/web:${TAG}" --only-show-errors -o none

WEB_FQDN="$(az containerapp show -n ipl-web -g "$RG" --query 'properties.configuration.ingress.fqdn' -o tsv)"
WEB_URL="https://${WEB_FQDN}"

# CORS was pinned to an unroutable origin until the web hostname existed, so
# the API is never briefly open to any origin.
say "Restricting CORS to ${WEB_URL}"
az containerapp update -n ipl-api -g "$RG" \
  --set-env-vars "CORS_ORIGINS=${WEB_URL}" --only-show-errors -o none

# ── Observability (Prometheus + Grafana) ────────────────────────────────────
# Container Apps has no ConfigMap/volume-mount primitive, so — like the web
# image baking in NEXT_PUBLIC_API_URL — the scrape target and the datasource
# URL are baked into custom images at build time rather than mounted.
say "Building and deploying Prometheus + Grafana"
docker buildx build --platform linux/amd64 -f infra/prometheus/Dockerfile \
  -t "${ACR_SERVER}/prometheus:${TAG}" --push infra/prometheus
docker buildx build --platform linux/amd64 -f infra/grafana/Dockerfile \
  -t "${ACR_SERVER}/grafana:${TAG}" --push infra/grafana

az containerapp create \
  -n ipl-prometheus -g "$RG" --environment "$ENV_NAME" \
  --image "${ACR_SERVER}/prometheus:${TAG}" \
  --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --target-port 9090 --ingress internal \
  --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
  --only-show-errors -o none 2>/dev/null \
|| az containerapp update -n ipl-prometheus -g "$RG" \
     --image "${ACR_SERVER}/prometheus:${TAG}" --only-show-errors -o none

# Grafana's admin password is generated fresh on every deploy and printed
# once below — it is a Container Apps secret, never written to disk, and
# deliberately never appears in the README (gitleaks would fail the build).
GRAFANA_PASSWORD="$(openssl rand -hex 12)"
az containerapp create \
  -n ipl-grafana -g "$RG" --environment "$ENV_NAME" \
  --image "${ACR_SERVER}/grafana:${TAG}" \
  --registry-server "$ACR_SERVER" --registry-username "$ACR_USER" --registry-password "$ACR_PASS" \
  --target-port 3000 --ingress external \
  --cpu 0.5 --memory 1Gi --min-replicas 1 --max-replicas 1 \
  --secrets "admin-password=${GRAFANA_PASSWORD}" \
  --env-vars "GF_SECURITY_ADMIN_USER=admin" "GF_SECURITY_ADMIN_PASSWORD=secretref:admin-password" \
             "GF_AUTH_ANONYMOUS_ENABLED=false" "GF_USERS_ALLOW_SIGN_UP=false" \
  --only-show-errors -o none 2>/dev/null \
|| az containerapp update -n ipl-grafana -g "$RG" \
     --image "${ACR_SERVER}/grafana:${TAG}" --only-show-errors -o none

GRAFANA_FQDN="$(az containerapp show -n ipl-grafana -g "$RG" --query 'properties.configuration.ingress.fqdn' -o tsv)"
GRAFANA_URL="https://${GRAFANA_FQDN}"

cat <<EOF

┌──────────────────────────────────────────────────────────────────
│  Deployed to Azure Container Apps
│
│    Web       ${WEB_URL}
│    API       ${API_URL}
│    Docs      ${API_URL}/docs
│    Health    ${API_URL}/health/ready
│    Grafana   ${GRAFANA_URL}
│
│  Resource group : ${RG}   (delete everything: az group delete -n ${RG} --yes)
│  Registry       : ${ACR_SERVER}
│  Database       : ${PG_HOST}
│
│  Store these — they are not written to disk:
│    postgres password : ${PG_PASSWORD}
│    internal token    : ${INTERNAL_TOKEN}
│    grafana password  : ${GRAFANA_PASSWORD} (only set on first deploy; a
│                         rerun's 'update' path does not reset it)
└──────────────────────────────────────────────────────────────────

Next: put the URLs in the README at the <!-- LIVE_URLS --> marker. Never
commit the Grafana password — share it separately.
EOF
