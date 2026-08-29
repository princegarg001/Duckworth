variable "name" { type = string }
variable "project_id" { type = string }
variable "region" { type = string }
variable "labels" { type = map(string) }
variable "network_id" { type = string }
variable "private_vpc_connection_id" { type = string }
variable "tier" { type = string }
variable "availability_type" { type = string }
variable "disk_size_gb" { type = number }
variable "backup_enabled" { type = bool }
variable "point_in_time_recovery" { type = bool }
variable "deletion_protection" { type = bool }

resource "random_password" "db" {
  length  = 32
  special = true
  # Exclude characters that need escaping in a postgres:// URL.
  override_special = "-_.~"
}

resource "google_sql_database_instance" "main" {
  name             = "${var.name}-pg"
  database_version = "POSTGRES_17"
  region           = var.region

  # On by default. An accidental `terraform destroy` against production should
  # fail, loudly, rather than delete the database.
  deletion_protection = var.deletion_protection

  # The instance cannot be created until the private connection exists.
  depends_on = [var.private_vpc_connection_id]

  settings {
    tier              = var.tier
    availability_type = var.availability_type
    disk_size         = var.disk_size_gb
    disk_type         = "PD_SSD"
    disk_autoresize   = true
    user_labels       = var.labels

    ip_configuration {
      # No public IP. The database is reachable only from inside the VPC.
      ipv4_enabled                                  = false
      private_network                               = var.network_id
      enable_private_path_for_google_cloud_services = true
      ssl_mode                                      = "ENCRYPTED_ONLY"
    }

    backup_configuration {
      enabled    = var.backup_enabled
      start_time = "18:00" # 23:30 IST — after the daily traffic peak
      location   = var.region

      # Backups answer "what did yesterday look like". PITR answers "undo the
      # migration someone applied twenty minutes ago", which is the question
      # actually asked during an incident.
      point_in_time_recovery_enabled = var.point_in_time_recovery
      transaction_log_retention_days = 7

      backup_retention_settings {
        retained_backups = 14
        retention_unit   = "COUNT"
      }
    }

    maintenance_window {
      day          = 2 # Tuesday
      hour         = 19
      update_track = "stable"
    }

    insights_config {
      query_insights_enabled  = true
      query_string_length     = 1024
      record_application_tags = true
    }

    database_flags {
      # Log any statement over a second. The ceiling the application sets is
      # 10s; anything approaching it should be visible before it is fatal.
      name  = "log_min_duration_statement"
      value = "1000"
    }
  }
}

resource "google_sql_database" "main" {
  name     = "ipl"
  instance = google_sql_database_instance.main.name
}

resource "google_sql_user" "app" {
  name     = "ipl_app"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}

# The connection string is assembled here and stored in Secret Manager. It is
# never an output, never a variable, and never printed by `terraform plan`.
resource "google_secret_manager_secret" "database_url" {
  secret_id = "${var.name}-database-url"
  labels    = var.labels
  replication { auto {} }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  secret_data = format(
    "postgres://%s:%s@%s:5432/%s?sslmode=require",
    google_sql_user.app.name,
    random_password.db.result,
    google_sql_database_instance.main.private_ip_address,
    google_sql_database.main.name,
  )
}

output "instance_name" { value = google_sql_database_instance.main.name }
output "private_ip" { value = google_sql_database_instance.main.private_ip_address }
output "database_url_secret_id" { value = google_secret_manager_secret.database_url.secret_id }
