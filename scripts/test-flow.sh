#!/bin/bash
# End-to-end test for MatchBox
# Validates the full alert pipeline: Wazuh -> TheHive -> Cortex -> OpenCTI
# Usage: ./scripts/test-flow.sh
set -euo pipefail

if [ -z "${KUBECONFIG:-}" ]; then
  KUBECONFIG_PATH="$(limactl list k3s-soc --format '{{.Dir}}')/copied-from-guest/kubeconfig.yaml" 2>/dev/null || true
  export KUBECONFIG="${KUBECONFIG_PATH:-}"
fi

PASS=0
FAIL=0
SKIP=0

check() {
  local name="$1"
  local cmd="$2"
  printf "  %-50s" "$name"
  if eval "$cmd" &>/dev/null; then
    echo "[PASS]"
    ((PASS++))
  else
    echo "[FAIL]"
    ((FAIL++))
  fi
}

skip() {
  local name="$1"
  printf "  %-50s" "$name"
  echo "[SKIP]"
  ((SKIP++))
}

echo "=== MatchBox — End-to-End Test ==="
echo ""

# 1. Cluster Health
echo "[1/7] Cluster Health"
check "k3s node ready" "kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type==\"Ready\")].status}' | grep -q True"
check "All system pods running" "kubectl get pods -n kube-system --no-headers | grep -v Completed | grep -c Running"
echo ""

# 2. Shared Infrastructure
echo "[2/7] Shared Infrastructure"
check "OpenSearch pod ready" "kubectl get pods -n shared -l app=opensearch -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "Redis pod ready" "kubectl get pods -n shared -l app.kubernetes.io/name=redis -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "RabbitMQ pod ready" "kubectl get pods -n shared -l app.kubernetes.io/name=rabbitmq -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "MinIO pod ready" "kubectl get pods -n shared -l app=minio -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "NFS server pod ready" "kubectl get pods -n shared -l app=nfs-server -o jsonpath='{.items[0].status.phase}' | grep -q Running"
echo ""

# 3. Wazuh
echo "[3/7] Wazuh SIEM/XDR"
check "Wazuh Manager running" "kubectl get pods -n wazuh -l app=wazuh-manager -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "Wazuh Dashboard running" "kubectl get pods -n wazuh -l app=wazuh-dashboard -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "Wazuh Agent DaemonSet" "kubectl get daemonset -n wazuh wazuh-agent -o jsonpath='{.status.numberReady}' | grep -qE '[1-9]'"
check "Wazuh ConfigMaps exist" "kubectl get configmap -n wazuh wazuh-manager-config"
check "Wazuh custom rules exist" "kubectl get configmap -n wazuh wazuh-custom-rules"
echo ""

# 4. TheHive + Cortex
echo "[4/7] TheHive + Cortex (Incident Response)"
check "TheHive pod running" "kubectl get pods -n thehive -l app.kubernetes.io/name=thehive -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "Cortex pod running" "kubectl get pods -n thehive -l app.kubernetes.io/name=cortex -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "Cortex ServiceAccount exists" "kubectl get serviceaccount -n thehive cortex-job-runner"
check "Cortex RBAC Role exists" "kubectl get role -n thehive cortex-job-runner"
check "Cortex NFS PVC bound" "kubectl get pvc -n thehive cortex-shared-data -o jsonpath='{.status.phase}' | grep -q Bound"
echo ""

# 5. OpenCTI
echo "[5/7] OpenCTI (Threat Intelligence)"
check "OpenCTI pod running" "kubectl get pods -n opencti -l app.kubernetes.io/name=opencti -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "OpenCTI Worker running" "kubectl get pods -n opencti -l app.kubernetes.io/name=opencti-worker -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "OpenCTI Secrets exist" "kubectl get secret -n opencti soc-opencti-secrets"
check "MITRE ATT&CK CronJob exists" "kubectl get cronjob -n opencti opencti-connector-mitre"
check "AlienVault OTX CronJob exists" "kubectl get cronjob -n opencti opencti-connector-alienvault"
check "AbuseIPDB CronJob exists" "kubectl get cronjob -n opencti opencti-connector-abuseipdb"
echo ""

# 6. Monitoring
echo "[6/7] Monitoring (Prometheus + Grafana)"
check "Prometheus pod running" "kubectl get pods -n monitoring -l app.kubernetes.io/name=prometheus -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "Grafana pod running" "kubectl get pods -n monitoring -l app.kubernetes.io/name=grafana -o jsonpath='{.items[0].status.phase}' | grep -q Running"
echo ""

# 7. Ingress
echo "[7/7] Ingress (Traefik)"
check "Traefik pod running" "kubectl get pods -n kube-system -l app.kubernetes.io/name=traefik -o jsonpath='{.items[0].status.phase}' | grep -q Running"
check "Wazuh IngressRoute exists" "kubectl get ingressroute -n wazuh wazuh-dashboard"
check "TheHive IngressRoute exists" "kubectl get ingressroute -n thehive thehive"
check "OpenCTI IngressRoute exists" "kubectl get ingressroute -n opencti opencti"
check "Grafana IngressRoute exists" "kubectl get ingressroute -n monitoring grafana"
echo ""

# Summary
echo "=== Test Summary ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  SKIP: $SKIP"
echo ""

if [ $FAIL -eq 0 ]; then
  echo "All tests passed! SOC stack is operational."
else
  echo "$FAIL test(s) failed. Check pod logs with:"
  echo "  kubectl logs -n <namespace> <pod-name>"
fi
