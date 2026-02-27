#!/bin/bash
# Deploy the full MatchBox SOC stack to k3s
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

# Add required Helm chart repositories
setup_helm_repos() {
  echo "[helm] Adding Helm repositories..."
  helm repo add opensearch https://opensearch-project.github.io/helm-charts/ 2>/dev/null || true
  helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
  helm repo add minio https://charts.min.io/ 2>/dev/null || true
  helm repo add strangebee https://charts.thehive-project.org 2>/dev/null || true
  helm repo add opencti https://charts.opencti.io/ 2>/dev/null || true
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts 2>/dev/null || true
  helm repo add traefik https://helm.traefik.io/traefik 2>/dev/null || true
  helm repo update
  echo "  Done."
}

# Validate secrets are not using placeholder values
validate_secrets() {
  local secrets_file="$K8S_DIR/shared/secrets.yaml"
  if [ -f "$secrets_file" ]; then
    if grep -q "Q0hBTkdFX01F" "$secrets_file" 2>/dev/null; then
      echo "ERROR: secrets.yaml contains placeholder 'CHANGE_ME' values (base64-encoded)."
      echo "  Edit $secrets_file and replace all placeholder passwords before deploying."
      echo "  Template: $K8S_DIR/shared/secrets.yaml.example"
      exit 1
    fi
  else
    echo "WARNING: $secrets_file not found."
    echo "  Copy $K8S_DIR/shared/secrets.yaml.example to $K8S_DIR/shared/secrets.yaml"
    echo "  and fill in real credential values before deploying."
    exit 1
  fi
}

echo "=== MatchBox — Stack Deployment ==="
echo "Component: $COMPONENT"
echo ""

# Always validate secrets before deploying
validate_secrets

deploy_namespaces() {
  echo "[namespaces] Creating Kubernetes namespaces..."
  kubectl apply -f "$K8S_DIR/namespaces.yaml"

  echo "[network-policies] Applying NetworkPolicies..."
  kubectl apply -f "$K8S_DIR/network-policies.yaml"
  echo "  Done."
}

deploy_shared() {
  echo "[shared] Deploying shared infrastructure..."

  echo "  OpenSearch..."
  helm upgrade --install opensearch opensearch/opensearch \
    -n shared -f "$K8S_DIR/shared/opensearch.yaml" \
    --cleanup-on-fail --wait --timeout 5m

  echo "  Redis..."
  helm upgrade --install redis bitnami/redis \
    -n shared -f "$K8S_DIR/shared/redis.yaml" \
    --cleanup-on-fail --wait --timeout 3m

  echo "  RabbitMQ..."
  helm upgrade --install rabbitmq bitnami/rabbitmq \
    -n shared -f "$K8S_DIR/shared/rabbitmq.yaml" \
    --cleanup-on-fail --wait --timeout 3m

  echo "  MinIO..."
  helm upgrade --install minio minio/minio \
    -n shared -f "$K8S_DIR/shared/minio.yaml" \
    --cleanup-on-fail --wait --timeout 3m

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
    --cleanup-on-fail --wait --timeout 5m || echo "  WARN: TheHive Helm install may need manual adjustment"

  echo "  Deploying Cortex..."
  helm upgrade --install cortex strangebee/cortex \
    -n thehive -f "$K8S_DIR/thehive/cortex/helm-values.yaml" \
    --cleanup-on-fail --wait --timeout 5m || echo "  WARN: Cortex Helm install may need manual adjustment"

  echo "  Done."
}

deploy_opencti() {
  echo "[opencti] Deploying OpenCTI Threat Intelligence..."

  echo "  Creating OpenCTI Secrets from environment variables..."
  local octi_token="${OPENCTI_ADMIN_TOKEN:-}"
  local octi_password="${OPENCTI_ADMIN_PASSWORD:-}"
  local health_key="${OPENCTI_HEALTH_KEY:-}"
  local otx_key="${ALIENVAULT_OTX_API_KEY:-}"
  local abuse_key="${ABUSEIPDB_API_KEY:-}"
  local vt_key="${VIRUSTOTAL_API_KEY:-}"
  if [ -z "$octi_token" ] || [ -z "$octi_password" ]; then
    echo "  ERROR: OPENCTI_ADMIN_TOKEN and OPENCTI_ADMIN_PASSWORD env vars are required."
    echo "  Export before deploying: export OPENCTI_ADMIN_TOKEN=<token> OPENCTI_ADMIN_PASSWORD=<password>"
    exit 1
  fi
  kubectl create secret generic soc-opencti-secrets -n opencti \
    --from-literal=admin-token="$octi_token" \
    --from-literal=admin-password="$octi_password" \
    --from-literal=health-access-key="${health_key:-$(openssl rand -hex 16)}" \
    --from-literal=alienvault-api-key="${otx_key:-placeholder}" \
    --from-literal=abuseipdb-api-key="${abuse_key:-placeholder}" \
    --from-literal=virustotal-api-key="${vt_key:-placeholder}" \
    --dry-run=client -o yaml | kubectl apply -f -
  if [ -z "$otx_key" ] || [ -z "$abuse_key" ] || [ -z "$vt_key" ]; then
    echo "  WARNING: Some threat intel API keys not set. Connectors will fail until updated."
    echo "  Set: ALIENVAULT_OTX_API_KEY, ABUSEIPDB_API_KEY, VIRUSTOTAL_API_KEY"
  fi

  echo "  Deploying OpenCTI platform..."
  helm upgrade --install opencti opencti/opencti \
    -n opencti -f "$K8S_DIR/opencti/helm-values.yaml" \
    --cleanup-on-fail --wait --timeout 10m || echo "  WARN: OpenCTI Helm install may need manual adjustment"

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
    setup_helm_repos
    deploy_namespaces
    deploy_shared
    deploy_wazuh
    deploy_thehive
    deploy_opencti
    deploy_monitoring
    deploy_ingress
    ;;
  namespaces) deploy_namespaces ;;
  shared) setup_helm_repos && deploy_shared ;;
  wazuh) deploy_wazuh ;;
  thehive) setup_helm_repos && deploy_thehive ;;
  opencti) setup_helm_repos && deploy_opencti ;;
  monitoring) setup_helm_repos && deploy_monitoring ;;
  ingress) setup_helm_repos && deploy_ingress ;;
  *)
    echo "Usage: $0 [all|namespaces|shared|wazuh|thehive|opencti|monitoring|ingress]"
    exit 1
    ;;
esac

echo ""
echo "=== Deployment Complete ==="
echo ""

# Final health check
echo "Running post-deploy health check..."
UNHEALTHY=$(kubectl get pods --all-namespaces --no-headers 2>/dev/null | grep -v Running | grep -v Completed | wc -l | tr -d ' ')
if [ "$UNHEALTHY" -gt 0 ]; then
  echo "WARNING: $UNHEALTHY pod(s) are not Running:"
  kubectl get pods --all-namespaces --no-headers 2>/dev/null | grep -v Running | grep -v Completed
  echo ""
fi

echo "Check status: kubectl get pods --all-namespaces"
echo "Run tests:    ./scripts/test-flow.sh"
echo "Dashboards:   https://soc.homelab.local/{wazuh,thehive,opencti,grafana}"
