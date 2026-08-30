terraform {
  required_version = ">= 1.9"

  # Remote state with locking. Never local: local state is one lost laptop away
  # from an environment nobody can change, and two concurrent applies against a
  # local file corrupt it silently.
  backend "gcs" {
    bucket = "ipl-platform-tfstate"
    prefix = "envs/prod"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.14"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  name = "ipl-platform"
  labels = {
    app        = "ipl-platform"
    managed-by = "terraform"
    env        = "prod"
  }
}

module "network" {
  source = "../../modules/network"

  name       = local.name
  project_id = var.project_id
  region     = var.region
  labels     = local.labels
}

module "registry" {
  source = "../../modules/registry"

  name       = local.name
  project_id = var.project_id
  region     = var.region
  labels     = local.labels
}

module "database" {
  source = "../../modules/database"

  name       = local.name
  project_id = var.project_id
  region     = var.region
  labels     = local.labels

  # Private IP only: the database has no public address, and Cloud Run reaches
  # it through the VPC connector.
  network_id                = module.network.network_id
  private_vpc_connection_id = module.network.private_vpc_connection_id

  tier              = var.db_tier
  availability_type = "REGIONAL"
  disk_size_gb      = 20
  backup_enabled    = true
  # Point-in-time recovery. Backups tell you what yesterday looked like; PITR
  # is what lets you undo a bad migration applied twenty minutes ago.
  point_in_time_recovery = true
  deletion_protection    = true
}

module "runtime" {
  source = "../../modules/runtime"

  name       = local.name
  project_id = var.project_id
  region     = var.region
  labels     = local.labels

  image_api    = "${module.registry.repository_url}/api:${var.image_tag}"
  image_web    = "${module.registry.repository_url}/web:${var.image_tag}"
  image_ingest = "${module.registry.repository_url}/ingest:${var.image_tag}"

  vpc_connector_id      = module.network.vpc_connector_id
  database_url_secret   = module.database.database_url_secret_id
  internal_token_secret = google_secret_manager_secret.internal_token.secret_id

  allowed_origins = ["https://${var.domain}"]

  min_instances = 1
  max_instances = 10
}

# The internal API token is generated here and stored in Secret Manager. It is
# never written to state in plaintext beyond the random resource, never printed
# by `plan`, and never appears in a values file.
resource "random_password" "internal_token" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret" "internal_token" {
  secret_id = "${local.name}-internal-api-token"
  labels    = local.labels

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "internal_token" {
  secret      = google_secret_manager_secret.internal_token.id
  secret_data = random_password.internal_token.result
}

output "api_url" {
  value       = module.runtime.api_url
  description = "Public URL of the API service"
}

output "web_url" {
  value       = module.runtime.web_url
  description = "Public URL of the web application"
}
