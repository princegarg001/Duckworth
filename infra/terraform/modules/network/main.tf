variable "name" { type = string }
variable "project_id" { type = string }
variable "region" { type = string }
variable "labels" { type = map(string) }

# A dedicated VPC rather than the auto-created `default` network, which comes
# with permissive firewall rules and a subnet in every region.
resource "google_compute_network" "main" {
  name                    = "${var.name}-vpc"
  auto_create_subnetworks = false
  routing_mode            = "REGIONAL"
}

resource "google_compute_subnetwork" "main" {
  name          = "${var.name}-subnet"
  ip_cidr_range = "10.10.0.0/20"
  region        = var.region
  network       = google_compute_network.main.id

  # Flow logs are how you answer "what talked to what" after an incident.
  # Sampled at 50% to keep the bill sane.
  log_config {
    aggregation_interval = "INTERVAL_10_MIN"
    flow_sampling        = 0.5
    metadata             = "INCLUDE_ALL_METADATA"
  }

  private_ip_google_access = true
}

# Reserved range for Google-managed services (Cloud SQL). This is what allows
# the database to have a private address inside our VPC.
resource "google_compute_global_address" "private_service_range" {
  name          = "${var.name}-private-service-range"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.main.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.main.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_service_range.name]
}

# Cloud Run is serverless and has no NIC in our VPC; the connector is what
# lets it reach the private database.
resource "google_vpc_access_connector" "main" {
  name          = "${var.name}-connector"
  region        = var.region
  ip_cidr_range = "10.11.0.0/28"
  network       = google_compute_network.main.name
  min_instances = 2
  max_instances = 3
}

output "network_id" { value = google_compute_network.main.id }
output "subnet_id" { value = google_compute_subnetwork.main.id }
output "vpc_connector_id" { value = google_vpc_access_connector.main.id }
output "private_vpc_connection_id" { value = google_service_networking_connection.private_vpc.id }
