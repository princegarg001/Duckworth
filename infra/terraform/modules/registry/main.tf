variable "name" { type = string }
variable "project_id" { type = string }
variable "region" { type = string }
variable "labels" { type = map(string) }

resource "google_artifact_registry_repository" "main" {
  location      = var.region
  repository_id = var.name
  format        = "DOCKER"
  description   = "Container images for the IPL data platform"
  labels        = var.labels

  docker_config {
    # Tags cannot be moved once pushed. This is what makes a git SHA tag a real
    # identity: `:a1b2c3d` today is the same bytes as `:a1b2c3d` next month, so
    # a rollback actually rolls back.
    immutable_tags = true
  }

  # Keep the last 30 tagged images; expire untagged layers after a week. An
  # unbounded registry is a slow, expensive surprise.
  cleanup_policies {
    id     = "keep-recent-tagged"
    action = "KEEP"
    most_recent_versions {
      keep_count = 30
    }
  }

  cleanup_policies {
    id     = "delete-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "168h"
    }
  }
}

output "repository_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.main.repository_id}"
}
