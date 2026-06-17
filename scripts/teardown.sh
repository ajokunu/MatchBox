#!/bin/bash
# Teardown MatchBox SOC stack
# Usage: ./scripts/teardown.sh [component|all|vm]
#   component: shared | wazuh | thehive | opencti | monitoring | ingress
#   all: remove all Helm releases and k8s resources (keep VM)
#   vm: remove everything including the Lima VM
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K8S_DIR="$PROJECT_DIR/k8s"

if [ -z "${KUBECONFIG:-}" ]; then
  # Guard the command substitution itself (not the assignment) so a missing limactl
  # neither leaks stderr nor produces a misleading path.
  LIMA_DIR="$( (limactl list k3s-soc --format '{{.Dir}}' 2>/dev/null) || true )"
  if [ -n "$LIMA_DIR" ]; then
    export KUBECONFIG="$LIMA_DIR/copied-from-guest/kubeconfig.yaml"
  fi
fi

COMPONENT="${1:-}"

if [ -z "$COMPONENT" ]; then
  echo "Usage: $0 [shared|wazuh|thehive|opencti|monitoring|ingress|all|vm]"
  echo ""
  echo "  shared     - Remove OpenSearch, Redis, RabbitMQ, MinIO, NFS"
  echo "  wazuh      - Remove Wazuh stack"
  echo "  thehive    - Remove TheHive + Cortex"
  echo "  opencti    - Remove OpenCTI + connectors"
  echo "  monitoring - Remove Prometheus + Grafana"
  echo "  ingress    - Remove Traefik IngressRoutes"
  echo "  all        - Remove all components (keep Lima VM)"
  echo "  vm         - Remove everything including Lima VM"
  exit 1
fi

# Validate cluster connectivity before teardown
if [ "$COMPONENT" != "vm" ]; then
  if ! kubectl cluster-info &>/dev/null; then
    echo "ERROR: Cannot connect to Kubernetes cluster."
    echo "  Check KUBECONFIG: ${KUBECONFIG:-not set}"
    echo "  If the VM is stopped, use: $0 vm"
    exit 1
  fi
fi

echo "=== MatchBox — Teardown ==="
echo "Component: $COMPONENT"
echo ""

teardown_ingress() {
  echo "[ingress] Removing Traefik routes..."
  kubectl delete -f "$K8S_DIR/ingress/traefik-routes.yaml" --ignore-not-found
  # Remove the ingress cert + basic-auth secrets created by deploy_ingress().
  kubectl delete secret soc-tls-cert -n kube-system --ignore-not-found
  kubectl delete secret soc-auth-secret -n kube-system --ignore-not-found
}

teardown_monitoring() {
  echo "[monitoring] Removing Prometheus + Grafana..."
  helm uninstall monitoring -n monitoring 2>/dev/null || true
}

teardown_opencti() {
  echo "[opencti] Removing OpenCTI..."
  kubectl delete -f "$K8S_DIR/opencti/connectors/" --ignore-not-found
  helm uninstall opencti -n opencti 2>/dev/null || true
  kubectl delete secret soc-opencti-secrets -n opencti --ignore-not-found
  # CA-trust ConfigMap created by generate-certs.sh in the opencti namespace.
  kubectl delete configmap opensearch-ca-cert -n opencti --ignore-not-found
}

teardown_thehive() {
  echo "[thehive] Removing TheHive + Cortex..."
  helm uninstall cortex -n thehive 2>/dev/null || true
  helm uninstall thehive -n thehive 2>/dev/null || true
  kubectl delete -f "$K8S_DIR/thehive/cortex/rbac.yaml" --ignore-not-found
}

teardown_wazuh() {
  echo "[wazuh] Removing Wazuh..."
  kubectl delete -f "$K8S_DIR/wazuh/agents/daemonset.yaml" --ignore-not-found
  # Delete the Dashboard (Deployment + Service + ConfigMap) and Manager (StatefulSet
  # + Services + ConfigMaps) — mirrors what deploy_wazuh() applies.
  kubectl delete -f "$K8S_DIR/wazuh/dashboard/deployment.yaml" --ignore-not-found
  kubectl delete -f "$K8S_DIR/wazuh/dashboard/configmap-dashboard.yaml" --ignore-not-found
  kubectl delete -f "$K8S_DIR/wazuh/manager/" --ignore-not-found
  # Cert secrets/configmaps created by generate-certs.sh in the wazuh namespace.
  kubectl delete secret opensearch-certs wazuh-dashboard-certs -n wazuh --ignore-not-found
  kubectl delete configmap opensearch-ca-cert -n wazuh --ignore-not-found
  helm uninstall wazuh -n wazuh 2>/dev/null || true
}

teardown_shared() {
  echo "[shared] Removing shared infrastructure..."
  kubectl delete -f "$K8S_DIR/storage/pv-claims.yaml" --ignore-not-found
  kubectl delete -f "$K8S_DIR/storage/nfs-server.yaml" --ignore-not-found
  helm uninstall minio -n shared 2>/dev/null || true
  helm uninstall rabbitmq -n shared 2>/dev/null || true
  helm uninstall redis -n shared 2>/dev/null || true
  helm uninstall opensearch -n shared 2>/dev/null || true
  # Cert secret created by generate-certs.sh in the shared namespace.
  kubectl delete secret opensearch-certs -n shared --ignore-not-found
}

teardown_all() {
  teardown_ingress
  teardown_monitoring
  teardown_opencti
  teardown_thehive
  teardown_wazuh
  teardown_shared
  echo ""
  echo "[namespaces] Removing namespaces..."
  kubectl delete -f "$K8S_DIR/namespaces.yaml" --ignore-not-found
}

teardown_vm() {
  teardown_all
  echo ""
  echo "[vm] Stopping and deleting Lima VM..."
  limactl stop k3s-soc 2>/dev/null || true
  limactl delete k3s-soc 2>/dev/null || true
  echo "  Lima VM 'k3s-soc' deleted."
}

case "$COMPONENT" in
  ingress) teardown_ingress ;;
  monitoring) teardown_monitoring ;;
  opencti) teardown_opencti ;;
  thehive) teardown_thehive ;;
  wazuh) teardown_wazuh ;;
  shared) teardown_shared ;;
  all) teardown_all ;;
  vm) teardown_vm ;;
  *) echo "Unknown component: $COMPONENT"; exit 1 ;;
esac

echo ""
echo "=== Teardown Complete ==="
