# Runbook: Initial Setup

## Prerequisites
- Mac Mini M4 with macOS
- Homebrew installed (`/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"`)
- 16GB+ RAM, 120GB+ free disk space
- Internet access (for container image pulls and threat feed downloads)

## Step 1: Install CLI Tools
```bash
brew install lima kubectl helm
```

## Step 2: Start the Lima VM + k3s
```bash
cd MatchBox
./scripts/setup-lima.sh
```

This creates a Lima VM with:
- 10GB RAM, 4 CPUs, 120GB disk
- k3s Kubernetes pre-installed
- Helm package manager
- NFS server packages
- 4GB swap file

## Step 3: Set KUBECONFIG
```bash
export KUBECONFIG=$(limactl list k3s-soc --format '{{.Dir}}/copied-from-guest/kubeconfig.yaml')

# Add to your shell profile for persistence:
echo 'export KUBECONFIG=$(limactl list k3s-soc --format "{{.Dir}}/copied-from-guest/kubeconfig.yaml")' >> ~/.zshrc
```

## Step 4: Verify Cluster
```bash
kubectl get nodes
# Should show one node in Ready state

kubectl get pods -n kube-system
# Should show CoreDNS, local-path-provisioner, metrics-server running
```

## Step 5: Deploy the Full Stack
```bash
# Deploy everything at once:
./scripts/deploy-stack.sh all

# Or deploy component by component:
./scripts/deploy-stack.sh namespaces
./scripts/deploy-stack.sh shared
./scripts/deploy-stack.sh wazuh
./scripts/deploy-stack.sh thehive
./scripts/deploy-stack.sh opencti
./scripts/deploy-stack.sh monitoring
./scripts/deploy-stack.sh ingress
```

## Step 6: Configure DNS
Add to `/etc/hosts`:
```
127.0.0.1  soc.homelab.local
```

## Step 7: Update API Keys
```bash
# Edit the OpenCTI secrets with real API keys:
kubectl edit secret opencti-secrets -n opencti

# Required keys:
# - admin-token: Get from OpenCTI UI after first login
# - alienvault-api-key: Register at https://otx.alienvault.com
# - abuseipdb-api-key: Register at https://www.abuseipdb.com/api
# - virustotal-api-key: Register at https://www.virustotal.com/gui/join-us
```

## Step 8: Configure TheHive API Key
1. Open TheHive: https://soc.homelab.local/thehive
2. Login with default admin credentials
3. Go to Organization > API Keys > Create key
4. Update the Wazuh Manager ConfigMap with the TheHive API key:
```bash
kubectl edit configmap wazuh-manager-config -n wazuh
# Replace THEHIVE_API_KEY_PLACEHOLDER with the real key
# Restart Wazuh Manager to pick up the change
kubectl rollout restart deployment wazuh-manager -n wazuh
```

## Step 9: Run End-to-End Test
```bash
./scripts/test-flow.sh
```

## Step 10: Install MCP Servers (Optional)
```bash
cd mcp-servers/wazuh-mcp && npm install && npm run build && cd ../..
cd mcp-servers/thehive-mcp && npm install && npm run build && cd ../..
cd mcp-servers/opencti-mcp && npm install && npm run build && cd ../..
```

## Troubleshooting

### VM won't start
```bash
limactl list  # Check status
limactl stop k3s-soc && limactl start k3s-soc  # Restart
```

### Pods stuck in Pending
```bash
kubectl describe pod <pod-name> -n <namespace>  # Check events
kubectl get pvc -A  # Check PVC binding
```

### OpenSearch crashes (OOMKilled)
Increase memory limit in opensearch.yaml and redeploy:
```bash
helm upgrade opensearch opensearch/opensearch -n shared -f k8s/shared/opensearch.yaml
```

### Wazuh agents not connecting
```bash
kubectl logs -n wazuh -l app=wazuh-agent
# Check manager service DNS resolution:
kubectl exec -n wazuh -it <agent-pod> -- nslookup wazuh-manager.wazuh.svc.cluster.local
```
