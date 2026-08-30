# A tiny custom image, for the same reason as infra/prometheus/Dockerfile:
# Container Apps has no volume-mount primitive to hand Grafana its
# provisioning files, so they are baked in at build time instead.
FROM grafana/grafana-oss:11.4.0
COPY provisioning/datasources/datasource.azure.yml /etc/grafana/provisioning/datasources/datasource.yml
COPY provisioning/dashboards/dashboards.yml /etc/grafana/provisioning/dashboards/dashboards.yml
COPY dashboards/ /var/lib/grafana/dashboards/
