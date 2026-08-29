#!/usr/bin/env bash
#
# One-command deploy to Cloud Run, backed by a free-tier Neon Postgres.
#
# Deliberately a script rather than Terraform for this path. Terraform in
# infra/terraform provisions the full private-VPC footprint (Cloud SQL, VPC
# connector, Secret Manager) and is the right answer for a real environment;
# it also costs ~$25/month and takes twenty minutes to apply. This script gets
# a working public URL on the free tier in about five, which is what a
# reviewer's link actually needs.
#
# Usage:
#   export PROJECT_ID=your-gcp-project
#   export DATABASE_URL='postgres://user:pass@ep-xxx.neon.tech/ipl?sslmode=require'
#   ./scripts/deploy-cloudrun.sh
#
# Prerequisites: gcloud authenticated, docker running, billing enabled on the
# project (required even for free-tier Cloud Run).
#
# Secrets are passed as environment variables, which means they are readable
# through `gcloud run services describe`. That is the trade-off this path
# accepts for speed; the Terraform footprint puts them in Secret Manager and
# injects them by reference instead.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:?set PROJECT_ID to your GCP project}"
DATABASE_URL="${DATABASE_URL:?set DATABASE_URL to your Neon connection string}"
REGION="${REGION:-asia-south1}"
REPO="${REPO:-ipl-platform}"
TAG="${TAG:-$(git rev-parse --short HEAD)}"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}"
INTERNAL_TOKEN="${INTERNAL_API_TOKEN:-$(openssl rand -hex 24)}"

# CORS starts pinned to an unroutable origin rather than "*", and is narrowed to
# the real web URL once Cloud Run has created it. The config schema rejects "*"
# in production, so there is never a window in which the API is open.
CORS_BOOTSTRAP="https://placeholder.invalid"

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

say "Project ${PROJECT_ID} · region ${REGION} · tag ${TAG}"
gcloud config set project "${PROJECT_ID}" --quiet

say "Enabling the APIs this needs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --quiet

say "Ensuring the image repository exists"
gcloud artifacts repositories describe "${REPO}" --location "${REGION}" >/dev/null 2>&1 || \
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker --location="${REGION}" \
    --description="IPL data platform images" --quiet
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

# ── Build ───────────────────────────────────────────────────────────────────
# linux/amd64 explicitly: Cloud Run does not run arm64, and building on an
# M-series Mac without this produces an image that pushes fine and then fails
# to start with an exec-format error.
say "Building images (linux/amd64)"
for svc in api ingest; do
  docker buildx build --platform linux/amd64 \
    -f "apps/${svc}/Dockerfile" \
    -t "${REGISTRY}/${svc}:${TAG}" \
    --push .
done

# ── Migrate and load ────────────────────────────────────────────────────────
# Runs before anything serves. The job exits non-zero if any of the 23
# data-quality checks fails, so a bad load stops the deploy here rather than
# becoming a live site serving numbers that do not reconcile.
say "Running migrations, ingest and the data-quality contract"
if gcloud run jobs describe ipl-ingest --region "${REGION}" >/dev/null 2>&1; then
  gcloud run jobs update ipl-ingest --region "${REGION}" \
    --image "${REGISTRY}/ingest:${TAG}" \
    --set-env-vars "^##^DATABASE_URL=${DATABASE_URL}##DATABASE_SSL=true##LOG_LEVEL=info" \
    --max-retries 1 --task-timeout 30m --memory 2Gi --cpu 2 --quiet
else
  gcloud run jobs create ipl-ingest --region "${REGION}" \
    --image "${REGISTRY}/ingest:${TAG}" \
    --set-env-vars "^##^DATABASE_URL=${DATABASE_URL}##DATABASE_SSL=true##LOG_LEVEL=info" \
    --max-retries 1 --task-timeout 30m --memory 2Gi --cpu 2 --quiet
fi
gcloud run jobs execute ipl-ingest --region "${REGION}" --wait

# ── API ─────────────────────────────────────────────────────────────────────
say "Deploying the API"
gcloud run deploy ipl-api --region "${REGION}" \
  --image "${REGISTRY}/api:${TAG}" \
  --allow-unauthenticated \
  --port 3000 \
  --memory 512Mi --cpu 1 \
  --min-instances 0 --max-instances 5 \
  --set-env-vars "^##^NODE_ENV=production##DATABASE_URL=${DATABASE_URL}##DATABASE_SSL=true##GIT_SHA=${TAG}##SERVICE_VERSION=${TAG}##INTERNAL_API_TOKEN=${INTERNAL_TOKEN}##TRUST_PROXY=true##CORS_ORIGINS=${CORS_BOOTSTRAP}" \
  --quiet

API_URL="$(gcloud run services describe ipl-api --region "${REGION}" --format='value(status.url)')"
say "API is at ${API_URL}"

say "Smoke-testing the new revision"
curl -fsS --retry 8 --retry-delay 3 --retry-all-errors "${API_URL}/health/ready" \
  | python -c 'import json,sys; d=json.load(sys.stdin); print("  status:", d["status"]); sys.exit(0 if d["status"]!="down" else 1)'
curl -fsS "${API_URL}/v1/seasons/2022/points-table" \
  | python -c 'import json,sys; r=json.load(sys.stdin)["data"][0]; print(f"  leader: {r[\"team\"][\"shortName\"]} {r[\"points\"]}pts {r[\"netRunRate\"]:+.3f}"); assert r["netRunRate"]==0.316, "points table does not match the published standings"'

# ── Web ─────────────────────────────────────────────────────────────────────
# The web image is built AFTER the API is up, because Next inlines
# NEXT_PUBLIC_API_URL at build time — the API's URL does not exist until Cloud
# Run has created the service. This ordering is the whole reason the web build
# is not in the loop above.
say "Building the web image against ${API_URL}"
docker buildx build --platform linux/amd64 \
  -f apps/web/Dockerfile \
  --build-arg "NEXT_PUBLIC_API_URL=${API_URL}" \
  -t "${REGISTRY}/web:${TAG}" \
  --push .

say "Deploying the web application"
gcloud run deploy ipl-web --region "${REGION}" \
  --image "${REGISTRY}/web:${TAG}" \
  --allow-unauthenticated \
  --port 3001 \
  --memory 512Mi --cpu 1 \
  --min-instances 0 --max-instances 5 \
  --set-env-vars "NODE_ENV=production" \
  --quiet

WEB_URL="$(gcloud run services describe ipl-web --region "${REGION}" --format='value(status.url)')"

# Now that the web origin exists, lock CORS down to it. It was a placeholder
# until this point precisely so that it is never briefly "*".
say "Restricting CORS to ${WEB_URL}"
gcloud run services update ipl-api --region "${REGION}" \
  --update-env-vars "CORS_ORIGINS=${WEB_URL}" --quiet

cat <<EOF

┌────────────────────────────────────────────────────────────────
│  Deployed
│
│    Web      ${WEB_URL}
│    API      ${API_URL}
│    Docs     ${API_URL}/docs
│    Health   ${API_URL}/health/ready
│
│  Internal token (store it; needed for POST /internal/*):
│    ${INTERNAL_TOKEN}
└────────────────────────────────────────────────────────────────

Put the two URLs in the README under Deployment.
EOF
