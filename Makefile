# Convenience targets. `make help` lists them.
#
# The contract this file exists to keep:
#     git clone && cp .env.example .env && make up
# produces a working app with real data.

SHELL := /bin/bash
.DEFAULT_GOAL := help

DATASET_URL := https://aiko-cricket-tips-cyeef3d8fjcfb4e0.z02.azurefd.net/core-aiko-archive/Indian_Premier_League_2022-03-26.zip?sp=r&st=2026-08-01T10:01:46Z&se=2027-04-01T18:16:46Z&sv=2026-02-06&sr=b&sig=fe6UVJbR9zAnZ%2FACgFBeJdpnM6xzonkElXr5nC35%2B9o%3D
DEV_DB := postgres://ipl:ipl@localhost:5432/ipl

.PHONY: help
help: ## Show this help
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

.PHONY: data
data: ## Download and unpack the IPL dataset into data/raw
	@mkdir -p data/raw
	@if [ -d "data/raw/Indian_Premier_League_2022-03-26" ]; then \
		echo "dataset already present"; \
	else \
		echo "downloading dataset…"; \
		curl -sSL -o data/ipl.zip "$(DATASET_URL)"; \
		unzip -q -o data/ipl.zip -d data/raw; \
		echo "unpacked $$(find data/raw -type f | wc -l) files"; \
	fi

.PHONY: up
up: data ## Start the whole stack (postgres, redis, ingest, api, web)
	docker compose up --build -d
	@echo ""
	@echo "  web     http://localhost:$${WEB_PORT:-3001}"
	@echo "  api     http://localhost:$${API_PORT:-3000}"
	@echo "  docs    http://localhost:$${API_PORT:-3000}/docs"
	@echo "  health  http://localhost:$${API_PORT:-3000}/health/ready"

.PHONY: observability
observability: ## Start Prometheus + Grafana + the OTel collector alongside the stack
	docker compose --profile observability up -d
	@echo ""
	@echo "  grafana     http://localhost:$${GRAFANA_PORT:-3002}  (anonymous admin, dashboard pre-loaded)"
	@echo "  prometheus  http://localhost:$${PROMETHEUS_PORT:-9090}"

.PHONY: down
down: ## Stop the stack, keeping the database volume
	docker compose down

.PHONY: clean
clean: ## Stop the stack and delete the database volume
	docker compose down -v

.PHONY: logs
logs: ## Tail logs from every service
	docker compose logs -f --tail=100

.PHONY: install
install: ## Install workspace dependencies
	pnpm install

.PHONY: dev
dev: ## Run api and web against a local database (needs `make db`)
	pnpm turbo run dev --filter=@ipl/api --filter=@ipl/web

.PHONY: db
db: ## Start only postgres and redis, for local (non-container) development
	docker compose up -d postgres redis

.PHONY: migrate
migrate: ## Apply migrations and rebuild materialised views
	DATABASE_URL=$(DEV_DB) pnpm --filter @ipl/ingest start migrate

.PHONY: ingest
ingest: data ## Load the dataset (idempotent), refresh marts, run the checks
	DATABASE_URL=$(DEV_DB) pnpm --filter @ipl/ingest start all --source ./data/raw

.PHONY: verify
verify: ## Run the data-quality contract against the current database
	DATABASE_URL=$(DEV_DB) pnpm --filter @ipl/ingest start verify

.PHONY: build
build: ## Build every package
	pnpm turbo run build

.PHONY: test
test: ## Run unit tests
	pnpm turbo run test:unit

.PHONY: test-integration
test-integration: ## Run integration tests (starts Postgres via Testcontainers)
	pnpm turbo run test:integration

.PHONY: e2e
e2e: ## Run Playwright end-to-end tests against a running stack
	pnpm --filter @ipl/web test:e2e

.PHONY: lint
lint: ## Lint and typecheck everything
	pnpm turbo run lint typecheck

.PHONY: format
format: ## Format the repository
	pnpm format

.PHONY: openapi
openapi: ## Regenerate openapi.json and the frontend's types
	pnpm --filter @ipl/api openapi:emit
	pnpm --filter @ipl/web gen:api

.PHONY: check-openapi
check-openapi: ## Fail if the committed OpenAPI document is stale
	@pnpm --filter @ipl/api openapi:emit >/dev/null
	@git diff --exit-code --stat packages/contracts/openapi.json \
		|| (echo ""; echo "openapi.json is out of date — run 'make openapi' and commit."; exit 1)
	@echo "openapi.json is up to date"
