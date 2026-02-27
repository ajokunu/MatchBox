#!/bin/bash
# End-to-end test for MatchBox
# Validates the full alert pipeline: Wazuh -> TheHive -> Cortex -> OpenCTI
# Usage: ./scripts/test-flow.sh [-v]
# Options: -v  Verbose mode — show failing command output
set +e  # Don't exit on first failure — we need to run all checks

VERBOSE=false
[ "${1:-}" = "-v" ] && VERBOSE=true

export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
if [ -z "${KUBECONFIG:-}" ]; then
  KUBECONFIG_PATH="$(limactl list k3s-soc --format '{{.Dir}}')/copied-from-guest/kubeconfig.yaml" 2>/dev/null || true
  export KUBECONFIG="${KUBECONFIG_PATH:-}"
fi

PASS=0
FAIL=0
SKIP=0

check() {
  local name="$1"
  shift
  printf "  %-50s" "$name"
  local output
  if output=$("$@" 2>&1); then
    echo "[PASS]"
    PASS=$((PASS + 1))
  else
    echo "[FAIL]"
    FAIL=$((FAIL + 1))
    if $VERBOSE; then
      echo "    -> $*"
      echo "    -> ${output:0:200}"
    fi
  fi
}

skip() {
  local name="$1"
  printf "  %-50s" "$name"
  echo "[SKIP]"
  SKIP=$((SKIP + 1))
}

# Helper: check pod is Running by label
pod_running() {
  local ns="$1" label="$2"
  kubectl get pods -n "$ns" -l "$label" -o jsonpath='{.items[0].status.phase}' 2>/dev/null | grep -q Running
}

echo "=== MatchBox — End-to-End Test ==="
echo ""

# 1. Cluster Health
echo "[1/8] Cluster Health"
check "k3s node ready" kubectl get nodes -o jsonpath='{.items[0].status.conditions[?(@.type=="Ready")].status}'
check "All system pods running" sh -c 'kubectl get pods -n kube-system --no-headers 2>/dev/null | grep -v Completed | grep -q Running'
echo ""

# 2. Shared Infrastructure
echo "[2/8] Shared Infrastructure"
check "OpenSearch pod ready" pod_running shared "app.kubernetes.io/name=opensearch"
check "Redis pod ready" pod_running shared "app.kubernetes.io/name=redis"
check "RabbitMQ pod ready" pod_running shared "app.kubernetes.io/name=rabbitmq"
check "MinIO pod ready" pod_running shared "app=minio"  # Helm chart uses app: label
echo ""

# 3. Wazuh
echo "[3/8] Wazuh SIEM/XDR"
check "Wazuh Manager running" pod_running wazuh "app.kubernetes.io/name=wazuh-manager"
check "Wazuh Dashboard running" pod_running wazuh "app.kubernetes.io/name=wazuh-dashboard"
check "Wazuh Agent DaemonSet" sh -c "kubectl get daemonset -n wazuh wazuh-agent -o jsonpath='{.status.numberReady}' 2>/dev/null | grep -qE '[1-9]'"
check "Wazuh ConfigMaps exist" kubectl get configmap -n wazuh wazuh-manager-config
check "Wazuh custom rules exist" kubectl get configmap -n wazuh wazuh-custom-rules
echo ""

# 4. TheHive + Cortex
echo "[4/8] TheHive + Cortex (Incident Response)"
check "TheHive pod running" pod_running thehive "app.kubernetes.io/name=thehive"
check "Cortex pod running" pod_running thehive "app.kubernetes.io/name=cortex"
check "Cortex ServiceAccount exists" kubectl get serviceaccount -n thehive cortex-job-runner
check "Cortex RBAC Role exists" kubectl get role -n thehive cortex-job-runner
check "Cortex PVC bound" sh -c "kubectl get pvc -n thehive data-cortex-0 -o jsonpath='{.status.phase}' 2>/dev/null | grep -q Bound"
echo ""

# 5. OpenCTI
echo "[5/8] OpenCTI (Threat Intelligence)"
check "OpenCTI pod running" pod_running opencti "app.kubernetes.io/name=opencti"
check "OpenCTI Worker running" pod_running opencti "app.kubernetes.io/name=opencti-worker"
check "OpenCTI Secrets exist" kubectl get secret -n opencti soc-opencti-secrets
check "MITRE ATT&CK CronJob exists" kubectl get cronjob -n opencti opencti-connector-mitre
check "AlienVault OTX CronJob exists" kubectl get cronjob -n opencti opencti-connector-alienvault
check "AbuseIPDB CronJob exists" kubectl get cronjob -n opencti opencti-connector-abuseipdb
echo ""

# 6. Monitoring
echo "[6/8] Monitoring (Prometheus + Grafana)"
check "Prometheus pod running" pod_running monitoring "app.kubernetes.io/name=prometheus"
check "Grafana pod running" pod_running monitoring "app.kubernetes.io/name=grafana"
echo ""

# 7. Ingress
echo "[7/8] Ingress (Traefik)"
check "Traefik pod running" pod_running kube-system "app.kubernetes.io/name=traefik"
check "Wazuh IngressRoute exists" kubectl get ingressroute -n wazuh wazuh-dashboard
check "TheHive IngressRoute exists" kubectl get ingressroute -n thehive thehive
check "OpenCTI IngressRoute exists" kubectl get ingressroute -n opencti opencti
check "Grafana IngressRoute exists" kubectl get ingressroute -n monitoring grafana
echo ""

# 8. API Connectivity (live health checks)
echo "[8/8] API Connectivity"
check "Wazuh Manager API responds" sh -c "kubectl exec -n wazuh wazuh-manager-0 -- curl -sk https://localhost:55000/ 2>/dev/null | grep -q title"
check "TheHive API responds" sh -c "kubectl exec -n thehive thehive-0 -- curl -sk http://localhost:9000/api/status 2>/dev/null | grep -q version"
check "Cortex API responds" sh -c "kubectl exec -n thehive cortex-0 -- curl -sk http://localhost:9001/api/status 2>/dev/null | grep -q versions"
check "Grafana API responds" sh -c "kubectl exec -n monitoring \$(kubectl get pods -n monitoring -l app.kubernetes.io/name=grafana -o jsonpath='{.items[0].metadata.name}') -c grafana -- curl -s http://localhost:3000/api/health 2>/dev/null | grep -q ok"
check "OpenCTI API responds" sh -c "kubectl exec -n opencti \$(kubectl get pods -n opencti -l app.kubernetes.io/name=opencti -o jsonpath='{.items[0].metadata.name}') -- curl -s http://localhost:4000/health 2>/dev/null | grep -qE 'ok|alive'"
echo ""

# Summary
echo "=== Test Summary ==="
echo "  PASS: $PASS"
echo "  FAIL: $FAIL"
echo "  SKIP: $SKIP"
TOTAL=$((PASS + FAIL + SKIP))
echo "  TOTAL: $TOTAL"
echo ""

if [ "$FAIL" -eq 0 ]; then
  echo "All tests passed! SOC stack is operational."
  exit 0
else
  echo "$FAIL test(s) failed. Check pod logs with:"
  echo "  kubectl logs -n <namespace> <pod-name>"
  echo "  Re-run with -v for verbose output."
  exit 1
fi
