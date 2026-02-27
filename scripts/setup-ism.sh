#!/bin/bash
# Setup OpenSearch ISM (Index State Management) policies
# Run after OpenSearch is up and healthy.
# Usage: ./scripts/setup-ism.sh
set +e

export PATH="$HOME/.local/bin:$HOME/bin:$PATH"
if [ -z "${KUBECONFIG:-}" ]; then
  KUBECONFIG_PATH="$(limactl list k3s-soc --format '{{.Dir}}')/copied-from-guest/kubeconfig.yaml" 2>/dev/null || true
  export KUBECONFIG="${KUBECONFIG_PATH:-}"
fi

OS_POD="opensearch-cluster-master-0"
OS_NS="shared"

os_api() {
  kubectl exec -n "$OS_NS" "$OS_POD" -- \
    sh -c "curl -sk -u admin:\$OPENSEARCH_INITIAL_ADMIN_PASSWORD -X${1} \"https://localhost:9200${2}\" -H 'Content-Type: application/json' -d '${3:-}'" 2>/dev/null
}

echo "=== Creating ISM Policies ==="

# 1. Wazuh alerts: delete after 30 days
echo -n "  Wazuh alerts (30d retention)... "
os_api PUT "/_plugins/_ism/policies/wazuh-cleanup" '{
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
}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_id','FAIL'))" 2>/dev/null || echo "FAIL"

# 2. OpenCTI indices: delete after 90 days
echo -n "  OpenCTI indices (90d retention)... "
os_api PUT "/_plugins/_ism/policies/opencti-cleanup" '{
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
}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_id','FAIL'))" 2>/dev/null || echo "FAIL"

# 3. Security audit logs: delete after 14 days
echo -n "  Security audit logs (14d retention)... "
os_api PUT "/_plugins/_ism/policies/audit-cleanup" '{
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
}' | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('_id','FAIL'))" 2>/dev/null || echo "FAIL"

echo ""
echo "=== Verifying ISM Policies ==="
os_api GET "/_plugins/_ism/policies" | python3 -c "
import sys,json
data = json.load(sys.stdin)
policies = data.get('policies', [])
for p in policies:
    pid = p.get('_id','?')
    desc = p.get('policy',{}).get('description','?')
    print(f'  {pid}: {desc}')
print(f'Total: {len(policies)} policies')
" 2>/dev/null
