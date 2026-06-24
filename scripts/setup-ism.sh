#!/bin/bash
# Setup OpenSearch ISM (Index State Management) policies
# Run after OpenSearch is up and healthy (invoked automatically by deploy_shared()).
# Usage: ./scripts/setup-ism.sh
set -euo pipefail

export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
if [ -z "${KUBECONFIG:-}" ]; then
  # Guard the command substitution itself so a missing limactl neither leaks stderr
  # nor aborts under set -e before KUBECONFIG can fall back to the ambient value.
  LIMA_DIR="$( (limactl list k3s-soc --format '{{.Dir}}' 2>/dev/null) || true )"
  if [ -n "$LIMA_DIR" ]; then
    export KUBECONFIG="$LIMA_DIR/copied-from-guest/kubeconfig.yaml"
  fi
fi

OS_POD="opensearch-cluster-master-0"
OS_NS="shared"
# OpenSearch admin user (override if the security config uses a different admin).
OS_USER="${OPENSEARCH_USER:-admin}"

# Track whether any policy PUT failed so we can exit non-zero at the end.
ISM_FAILED=0

# os_api METHOD PATH [JSON_BODY]
# The JSON body is piped over stdin (curl -d @-) so payloads containing single
# quotes can't break the inner sh -c quoting. The admin password is expanded inside
# the pod (escaped $), never placed on the host argument list or printed.
os_api() {
  local method="$1" path="$2" body="${3:-}"
  printf '%s' "$body" | kubectl exec -i -n "$OS_NS" "$OS_POD" -- \
    sh -c "curl -sk -u \"$OS_USER:\$OPENSEARCH_INITIAL_ADMIN_PASSWORD\" -X${method} \"https://localhost:9200${path}\" -H 'Content-Type: application/json' -d @-"
}

# put_policy NAME JSON_BODY — PUT an ISM policy and verify it was created.
# Prints OK/<_id> or FAIL and records a failure so the script exits non-zero.
put_policy() {
  local name="$1" body="$2" result
  if result="$(os_api PUT "/_plugins/_ism/policies/$name" "$body" \
      | python3 -c "import sys,json; print(json.load(sys.stdin).get('_id','FAIL'))" 2>/dev/null)" \
      && [ "$result" != "FAIL" ] && [ -n "$result" ]; then
    echo "$result"
  else
    echo "FAIL"
    ISM_FAILED=1
  fi
}

echo "=== Creating ISM Policies ==="

# 1. Wazuh alerts: delete after 30 days
echo -n "  Wazuh alerts (30d retention)... "
put_policy "wazuh-cleanup" '{
  "policy": {
    "description": "Delete Wazuh alert indices after 30 days",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "transitions": [{ "state_name": "delete", "conditions": { "min_index_age": "30d" } }]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }]
      }
    ],
    "ism_template": [{ "index_patterns": ["wazuh-alerts-*", "wazuh-statistics-*"], "priority": 100 }]
  }
}'

# 2. OpenCTI indices: delete after 90 days
echo -n "  OpenCTI indices (90d retention)... "
put_policy "opencti-cleanup" '{
  "policy": {
    "description": "Delete OpenCTI indices after 90 days",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "transitions": [{ "state_name": "delete", "conditions": { "min_index_age": "90d" } }]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }]
      }
    ],
    "ism_template": [{ "index_patterns": ["opencti_history-*"], "priority": 100 }]
  }
}'

# 3. Security audit logs: delete after 14 days
echo -n "  Security audit logs (14d retention)... "
put_policy "audit-cleanup" '{
  "policy": {
    "description": "Delete security audit log indices after 14 days",
    "default_state": "hot",
    "states": [
      {
        "name": "hot",
        "transitions": [{ "state_name": "delete", "conditions": { "min_index_age": "14d" } }]
      },
      {
        "name": "delete",
        "actions": [{ "delete": {} }]
      }
    ],
    "ism_template": [{ "index_patterns": ["security-auditlog-*"], "priority": 100 }]
  }
}'

echo ""
echo "=== Verifying ISM Policies ==="
# Verification is best-effort: don't let a transient GET/parse hiccup mask the real
# PUT results captured in ISM_FAILED. (|| true keeps a verify glitch from aborting.)
os_api GET "/_plugins/_ism/policies" | python3 -c "
import sys,json
data = json.load(sys.stdin)
policies = data.get('policies', [])
for p in policies:
    pid = p.get('_id','?')
    desc = p.get('policy',{}).get('description','?')
    print(f'  {pid}: {desc}')
print(f'Total: {len(policies)} policies')
" 2>/dev/null || true

echo ""
if [ "$ISM_FAILED" -ne 0 ]; then
  echo "ERROR: one or more ISM policies failed to apply (see FAIL above)."
  exit 1
fi
echo "All ISM policies applied successfully."
