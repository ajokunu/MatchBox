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

## Step 5: Generate TLS Certificates

OpenSearch runs with the security plugin enabled and `allow_unsafe_democertificates: false`,
so it (and the Wazuh Manager/Dashboard) will **not** start without real PEM materials. These
are created by `scripts/generate-certs.sh` (openssl, no cert-manager) and applied as the
`opensearch-certs` / `wazuh-dashboard-certs` Secrets plus the `opensearch-ca-cert` ConfigMap.
This **must run before** `shared`/`wazuh` are deployed.

```bash
# Generate root CA + node/admin/dashboard certs and create the K8s Secrets/ConfigMaps.
# Creates (canonical names): opensearch-certs (ns shared + wazuh),
# wazuh-dashboard-certs (ns wazuh), opensearch-ca-cert ConfigMap (ns wazuh + opencti).
./scripts/generate-certs.sh
```

> Cert facts (see `docs/VERSIONS.md`): node DN `CN=opensearch-node,O=MatchBox,C=US`,
> admin DN `CN=admin,O=MatchBox,C=US`, OpenSearch SANs include
> `opensearch-cluster-master.shared.svc.cluster.local`. Keys are PKCS#8 (Wazuh Filebeat's
> Go TLS rejects PKCS#1).

## Step 6: Encrypt & Apply Secrets (SOPS + age)

Credentials live in `k8s/shared/secrets.enc.yaml` (encrypted, committable). The plaintext
`k8s/shared/secrets.yaml` stays gitignored. Initialize the age key and encrypt once:

```bash
# Generates an age key OUTSIDE the repo, writes its public recipient into .sops.yaml,
# then encrypts secrets.yaml -> secrets.enc.yaml.
make secrets-init          # wraps scripts/setup-sops.sh

# The age private key is written to $SOPS_AGE_KEY_FILE
# (default ~/.config/sops/age/keys.txt) — never commit it.
export SOPS_AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
```

`deploy-stack.sh` decrypts at apply time
(`sops --decrypt k8s/shared/secrets.enc.yaml | kubectl apply -f -`) and fails fast if
`SOPS_AGE_KEY_FILE` is missing.

## Step 7: Deploy the Full Stack

Deploy order matters: namespaces → certs/secrets → shared (OpenSearch) → wazuh → thehive →
opencti → monitoring → ingress. `deploy-stack.sh all` runs them in this order; the cert
generation in Step 5 must already be done.

```bash
# Deploy everything at once (decrypts secrets, applies manifests/Helm in order):
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

## Step 8: Configure DNS
Add to `/etc/hosts`:
```
127.0.0.1  soc.homelab.local
```

## Step 9: Update API Keys
```bash
# Edit the OpenCTI secrets with real API keys:
kubectl edit secret soc-opencti-secrets -n opencti

# Required keys:
# - admin-token: Get from OpenCTI UI after first login
# - alienvault-api-key: Register at https://otx.alienvault.com
# - abuseipdb-api-key: Register at https://www.abuseipdb.com/api
# - virustotal-api-key: Register at https://www.virustotal.com/gui/join-us
```

> Tip: for repeatable changes, edit the plaintext `k8s/shared/secrets.yaml`, re-run
> `make secrets-encrypt`, and re-apply — rather than `kubectl edit` on the live Secret.

## Step 10: Configure TheHive API Key
1. Open TheHive: https://soc.homelab.local/thehive
2. Login with default admin credentials
3. Go to Organization > API Keys > Create key
4. Update the Wazuh Manager ConfigMap with the TheHive API key:
```bash
kubectl edit configmap wazuh-manager-config -n wazuh
# Replace THEHIVE_API_KEY_PLACEHOLDER with the real key
# Restart Wazuh Manager to pick up the change
kubectl rollout restart statefulset wazuh-manager -n wazuh
```

## Step 11: Run End-to-End Test
```bash
./scripts/test-flow.sh
```

## Step 12: Install MCP Servers (Optional)
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
