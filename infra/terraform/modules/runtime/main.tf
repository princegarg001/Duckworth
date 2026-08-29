variable "name" { type = string }
variable "project_id" { type = string }
variable "region" { type = string }
variable "labels" { type = map(string) }
variable "image_api" { type = string }
variable "image_web" { type = string }
variable "image_ingest" { type = string }
variable "vpc_connector_id" { type = string }
variable "database_url_secret" { type = string }
variable "internal_token_secret" { type = string }
variable "allowed_origins" { type = list(string) }
variable "min_instances" { type = number }
variable "max_instances" { type = number }

# A dedicated service account with only the permissions the services need.
# The default Compute service account is Editor on the whole project.
resource "google_service_account" "runtime" {
  account_id   = "${var.name}-runtime"
  display_name = "IPL platform runtime"
}

resource "google_project_iam_member" "sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "database_url" {
  secret_id = var.database_url_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_secret_manager_secret_iam_member" "internal_token" {
  secret_id = var.internal_token_secret
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_run_v2_service" "api" {
  name     = "${var.name}-api"
  location = var.region
  labels   = var.labels

  # Only the load balancer and internal traffic; the service is not directly
  # addressable from the internet.
  ingress = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    vpc_access {
      connector = var.vpc_connector_id
      # Only private ranges go through the connector; everything else exits
      # normally, which keeps the connector from becoming a bottleneck.
      egress = "PRIVATE_RANGES_ONLY"
    }

    containers {
      image = var.image_api

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        # CPU is allocated only while a request is in flight.
        cpu_idle = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name  = "CORS_ORIGINS"
        value = join(",", var.allowed_origins)
      }
      env {
        name  = "TRUST_PROXY"
        value = "true"
      }
      env {
        name  = "DATABASE_SSL"
        value = "true"
      }

      # Secrets are injected by reference. The value never appears in the
      # service definition, in Terraform state, or in `gcloud run describe`.
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = var.database_url_secret
            version = "latest"
          }
        }
      }
      env {
        name = "INTERNAL_API_TOKEN"
        value_source {
          secret_key_ref {
            secret  = var.internal_token_secret
            version = "latest"
          }
        }
      }

      startup_probe {
        http_get {
          path = "/health/live"
          port = 3000
        }
        initial_delay_seconds = 3
        period_seconds        = 3
        failure_threshold     = 10
      }

      liveness_probe {
        http_get {
          path = "/health/live"
          port = 3000
        }
        period_seconds = 30
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }

  depends_on = [
    google_secret_manager_secret_iam_member.database_url,
    google_secret_manager_secret_iam_member.internal_token,
  ]
}

resource "google_cloud_run_v2_service" "web" {
  name     = "${var.name}-web"
  location = var.region
  labels   = var.labels
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }

    containers {
      image = var.image_web
      ports {
        container_port = 3001
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
    }
  }

  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
}

# The ingest runs as a Job, not a service: it migrates, loads, refreshes and
# verifies, then exits. Executed once after each deploy.
resource "google_cloud_run_v2_job" "ingest" {
  name     = "${var.name}-ingest"
  location = var.region
  labels   = var.labels

  template {
    template {
      service_account = google_service_account.runtime.email
      # Two retries; a migration failing three times needs a human.
      max_retries = 2
      timeout     = "1800s"

      vpc_access {
        connector = var.vpc_connector_id
        egress    = "PRIVATE_RANGES_ONLY"
      }

      containers {
        image = var.image_ingest
        args  = ["all"]

        resources {
          limits = {
            cpu    = "2"
            memory = "2Gi"
          }
        }

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = var.database_url_secret
              version = "latest"
            }
          }
        }
        env {
          name  = "DATABASE_SSL"
          value = "true"
        }
      }
    }
  }
}

# Public read access. The dataset is public and the API is read-only; see the
# threat model in docs/architecture.md for what would change if it were not.
resource "google_cloud_run_v2_service_iam_member" "api_public" {
  location = google_cloud_run_v2_service.api.location
  name     = google_cloud_run_v2_service.api.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "web_public" {
  location = google_cloud_run_v2_service.web.location
  name     = google_cloud_run_v2_service.web.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

output "api_url" { value = google_cloud_run_v2_service.api.uri }
output "web_url" { value = google_cloud_run_v2_service.web.uri }
output "service_account_email" { value = google_service_account.runtime.email }
