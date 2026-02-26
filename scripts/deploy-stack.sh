#!/bin/bash
# Deploy the full DonnieBot SOC stack to k3s
# Usage: ./scripts/deploy-stack.sh [component]
#   component: all | namespaces | shared | wazuh | thehive | opencti | monitoring | ingress
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K8S_DIR="$PROJECT_DIR/k8s"

# Set kubeconfig if not already set
if [ -z "${KUBECONFIG:-}" ]; then
  KUBECONFIG_PATH="$(limactl list k3s-soc --format '{{.Dir}}')/copied-from-guest/kubeconfig.yaml"
  export KUBECONFIG="$KUBECONFIG_PATH"
fi

COMPONENT="${1:-all}"

# Validate prerequisites
for cmd in kubectl helm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd not found. Run ./scripts/setup-lima.sh first."
    exit 1
  fi
done

# Verify cluster connectivity
if ! kubectl cluster-info &>/dev/null; then
  echo "ERROR: Cannot connect to Kubernetes cluster."
  echo "  Check KUBECONFIG: ${KUBECONFIG:-not set}"
  echo "  Is the Lima VM running? limactl list"
  exit 1
fi

echo "=== DonnieBot Security Center — Stack Deployment ==="
echo "Component: $COMPONENT"
echo ""

deploy_namespaces() {
  echo "[namespaces] Creating Kubernetes namespaces..."
  kubectl apply -f "$K8S_DIR/namespaces.yaml"
  echo "  Done."
}

deploy_shared() {
  echo "[shared] Deploying shared infrastructure..."

  echo "  OpenSearch..."
  helm upgrade --install opensearch opensearch/opensearch \
    -n shared -f "$K8S_DIR/shared/opensearch.yaml" \
    --wait --timeout 5m

  echo "  Redis..."
  helm upgrade --install redis bitnami/redis \
    -n shared -f "$K8S_DIR/shared/redis.yaml" \
    --wait --timeout 3m

  echo "  RabbitMQ..."
  helm upgrade --install rabbitmq bitnami/rabbitmq \
    -n shared -f "$K8S_DIR/shared/rabbitmq.yaml" \
    --wait --timeout 3m

  echo "  MinIO..."
  helm upgrade --install minio minio/minio \
    -n shared -f "$K8S_DIR/shared/minio.yaml" \
    --wait --timeout 3m

  echo "  NFS Server..."
  kubectl apply -f "$K8S_DIR/storage/nfs-server.yaml"

  echo "  Storage PVs/PVCs..."
  kubectl apply -f "$K8S_DIR/storage/pv-claims.yaml"

  echo "  Done. Waiting for pods to be ready..."
  kubectl wait --for=condition=ready pod -l app=opensearch -n shared --timeout=300s || true
  echo "  Shared infrastructure deployed."
}

deploy_wazuh() {
  echo "[wazuh] Deploying Wazuh SIEM/XDR..."

  echo "  Applying ConfigMaps..."
  kubectl apply -f "$K8S_DIR/wazuh/manager/configmap-ossec.yaml"
  kubectl apply -f "$K8S_DIR/wazuh/manager/configmap-rules.yaml"
  kubectl apply -f "$K8S_DIR/wazuh/manager/configmap-decoders.yaml"

  echo "  Deploying Wazuh Agent DaemonSet..."
  kubectl apply -f "$K8S_DIR/wazuh/agents/daemonset.yaml"

  # Note: Full Wazuh deployment depends on available Helm chart
  # If community chart is unavailable, use raw manifests
  echo "  NOTE: Wazuh Helm chart may need manual setup."
  echo "  Refer to: https://documentation.wazuh.com/current/deployment-options/deploying-with-kubernetes/"

  echo "  Done."
}

deploy_thehive() {
  echo "[thehive] Deploying TheHive + Cortex..."

  echo "  Applying Cortex RBAC..."
  kubectl apply -f "$K8S_DIR/thehive/cortex/rbac.yaml"

  echo "  Deploying TheHive..."
  helm upgrade --install thehive strangebee/thehive \
    -n thehive -f "$K8S_DIR/thehive/helm-values.yaml" \
    --wait --timeout 5m || echo "  WARN: TheHive Helm install may need manual adjustment"

  echo "  Deploying Cortex..."
  helm upgrade --install cortex strangebee/cortex \
    -n thehive -f "$K8S_DIR/thehive/cortex/helm-values.yaml" \
    --wait --timeout 5m || echo "  WARN: Cortex Helm install may need manual adjustment"

  echo "  Done."
}

deploy_opencti() {
  echo "[opencti] Deploying OpenCTI Threat Intelligence..."

  echo "  Creating Secrets (placeholder — update with real API keys)..."
  kubectl create secret generic opencti-secrets -n opencti \
    --from-literal=admin-token="CHANGE_ME" \
    --from-literal=alienvault-api-key="CHANGE_ME" \
    --from-literal=abuseipdb-api-key="CHANGE_ME" \
    --from-literal=virustotal-api-key="CHANGE_ME" \
    --dry-run=client -o yaml | kubectl apply -f -

  echo "  Deploying OpenCTI platform..."
  helm upgrade --install opencti opencti/opencti \
    -n opencti -f "$K8S_DIR/opencti/helm-values.yaml" \
    --wait --timeout 10m || echo "  WARN: OpenCTI Helm install may need manual adjustment"

  echo "  Deploying connectors..."
  kubectl apply -f "$K8S_DIR/opencti/connectors/"

  echo "  Done. Remember to update API keys in opencti-secrets!"
}

deploy_monitoring() {
  echo "[monitoring] Deploying Prometheus + Grafana..."

  helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
    -n monitoring -f "$K8S_DIR/monitoring/kube-prometheus-values.yaml" \
    --wait --timeout 10m

  echo "  Done."
}

deploy_ingress() {
  echo "[ingress] Deploying Traefik IngressRoutes..."

  echo "  Installing Traefik..."
  helm upgrade --install traefik traefik/traefik -n kube-system \
    --set resources.requests.memory=64Mi \
    --set resources.limits.memory=128Mi \
    --wait --timeout 3m

  echo "  Applying IngressRoutes..."
  kubectl apply -f "$K8S_DIR/ingress/traefik-routes.yaml"

  echo "  Done."
  echo ""
  echo "  Add to /etc/hosts: 127.0.0.1 soc.homelab.local"
}

# Execute based on component argument
case "$COMPONENT" in
  all)
    deploy_namespaces
    deploy_shared
    deploy_wazuh
    deploy_thehive
    deploy_opencti
    deploy_monitoring
    deploy_ingress
    ;;
  namespaces) deploy_namespaces ;;
  shared) deploy_shared ;;
  wazuh) deploy_wazuh ;;
  thehive) deploy_thehive ;;
  opencti) deploy_opencti ;;
  monitoring) deploy_monitoring ;;
  ingress) deploy_ingress ;;
  *)
    echo "Usage: $0 [all|namespaces|shared|wazuh|thehive|opencti|monitoring|ingress]"
    exit 1
    ;;
esac

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Check status: kubectl get pods --all-namespaces"
echo "Dashboards:   https://soc.homelab.local/{wazuh,thehive,opencti,grafana}"
