# A tiny custom image rather than a bare prom/prometheus + a mounted file:
# Container Apps has no ConfigMap/volume-mount primitive for this, so the
# scrape config has to be baked in the same way the web image bakes
# NEXT_PUBLIC_API_URL — config-as-image, not config-as-volume.
FROM prom/prometheus:v3.1.0
COPY prometheus.azure.yml /etc/prometheus/prometheus.yml
