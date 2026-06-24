#!/bin/bash
# Deploy the full MatchBox SOC stack to k3s.
# Usage: ./scripts/deploy-stack.sh [component]
#   component: all | namespaces | secrets | certs | shared | opensearch-users | wazuh | thehive | opencti | monitoring | ingress
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
K8S_DIR="$PROJECT_DIR/k8s"

# Resolve kubeconfig if not already set. Guard the command substitution itself (not
# the assignment) so a missing/failed limactl does not abort under `set -e` and its
# stderr does not leak.
if [ -z "${KUBECONFIG:-}" ]; then
  LIMA_DIR="$( (limactl list k3s-soc --format '{{.Dir}}' 2>/dev/null) || true )"
  if [ -n "$LIMA_DIR" ]; then
    export KUBECONFIG="$LIMA_DIR/copied-from-guest/kubeconfig.yaml"
  fi
fi

COMPONENT="${1:-all}"

# --- Pinned Helm chart versions (reproducible deploys) -------------------------
# Pinning the chart --version keeps the slim resource profile stable and the image
# tags aligned with what CLAUDE.md/docs claim. Bump deliberately, not by drift.
OPENSEARCH_CHART_VERSION="2.21.0"
REDIS_CHART_VERSION="20.6.3"
RABBITMQ_CHART_VERSION="15.3.2"
MINIO_CHART_VERSION="5.4.0"
THEHIVE_CHART_VERSION="0.3.0"
CORTEX_CHART_VERSION="0.2.0"
OPENCTI_CHART_VERSION="1.4.0"
KUBE_PROM_CHART_VERSION="67.5.0"
TRAEFIK_CHART_VERSION="33.2.1"

# Validate prerequisites
for cmd in kubectl helm openssl; do
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

# Add required Helm chart repositories.
# Canonical URLs are kept in sync with setup-lima.sh (single source of truth);
# --force-update overwrites any stale repo of the same name so chart resolution is
# deterministic regardless of which script ran first.
setup_helm_repos() {
  echo "[helm] Adding Helm repositories..."
  helm repo add opensearch https://opensearch-project.github.io/helm-charts/ --force-update
  helm repo add bitnami https://charts.bitnami.com/bitnami --force-update
  helm repo add minio https://charts.min.io/ --force-update
  helm repo add strangebee https://strangebee.github.io/helm-charts/ --force-update
  helm repo add opencti https://devops-ia.github.io/helm-opencti/ --force-update
  helm repo add prometheus-community https://prometheus-community.github.io/helm-charts/ --force-update
  helm repo add traefik https://traefik.github.io/charts --force-update
  helm repo update
  echo "  Done."
}

# Ensure all namespaces exist. Idempotent; safe to call from any branch so a
# standalone component deploy after a namespace teardown still works.
ensure_namespaces() {
  kubectl apply -f "$K8S_DIR/namespaces.yaml"
}

# Validate the encrypted secrets bundle is present and configured.
# We do NOT decrypt here (no key access required just to validate) — only confirm
# the SOPS tooling and the encrypted file exist so deploy fails fast with a clear
# message rather than mid-way through a helm install that waits on a missing secret.
validate_secrets() {
  local enc_file="$K8S_DIR/shared/secrets.enc.yaml"
  if [ ! -f "$enc_file" ]; then
    echo "ERROR: $enc_file not found."
    echo "  Run ./scripts/setup-sops.sh (or 'make secrets-init') to create the"
    echo "  encrypted secrets bundle from k8s/shared/secrets.yaml."
    exit 1
  fi
  if ! command -v sops &>/dev/null; then
    echo "ERROR: 'sops' not found but secrets.enc.yaml is encrypted with it."
    echo "  Install with: brew install sops age"
    exit 1
  fi
  if [ -z "${SOPS_AGE_KEY_FILE:-}" ] && [ ! -f "$HOME/.config/sops/age/keys.txt" ]; then
    echo "ERROR: No age key found. Set SOPS_AGE_KEY_FILE or place the key at"
    echo "  ~/.config/sops/age/keys.txt (created by ./scripts/setup-sops.sh)."
    exit 1
  fi
}

# Decrypt the SOPS bundle and apply it. Each secret manifest carries its own
# metadata.namespace, so a single apply creates secrets across all namespaces.
# Fails fast if the age key is missing/wrong (sops exits non-zero, pipefail aborts).
deploy_secrets() {
  echo "[secrets] Decrypting and applying SOPS secrets bundle..."
  ensure_namespaces
  sops --decrypt "$K8S_DIR/shared/secrets.enc.yaml" | kubectl apply -f -
  echo "  Done."
}

echo "=== MatchBox — Stack Deployment ==="
echo "Component: $COMPONENT"
echo ""

# Always validate the secrets bundle before deploying anything.
validate_secrets

deploy_namespaces() {
  echo "[namespaces] Creating Kubernetes namespaces..."
  ensure_namespaces

  echo "[network-policies] Applying NetworkPolicies..."
  kubectl apply -f "$K8S_DIR/network-policies.yaml"
  echo "  Done."
}

# Generate the PKI and load the cert secrets/configmaps the manifests reference.
deploy_certs() {
  echo "[certs] Generating TLS certificates..."
  ensure_namespaces
  "$SCRIPT_DIR/generate-certs.sh"
  echo "  Done."
}

deploy_shared() {
  echo "[shared] Deploying shared infrastructure..."
  ensure_namespaces

  # Certs must exist before OpenSearch starts (it mounts opensearch-certs).
  deploy_certs

  echo "  OpenSearch..."
  helm upgrade --install opensearch opensearch/opensearch \
    --version "$OPENSEARCH_CHART_VERSION" \
    -n shared -f "$K8S_DIR/shared/opensearch.yaml" \
    --cleanup-on-fail --wait --timeout 5m

  echo "  Redis..."
  helm upgrade --install redis bitnami/redis \
    --version "$REDIS_CHART_VERSION" \
    -n shared -f "$K8S_DIR/shared/redis.yaml" \
    --cleanup-on-fail --wait --timeout 3m

  echo "  RabbitMQ..."
  helm upgrade --install rabbitmq bitnami/rabbitmq \
    --version "$RABBITMQ_CHART_VERSION" \
    -n shared -f "$K8S_DIR/shared/rabbitmq.yaml" \
    --cleanup-on-fail --wait --timeout 3m

  echo "  MinIO..."
  helm upgrade --install minio minio/minio \
    --version "$MINIO_CHART_VERSION" \
    -n shared -f "$K8S_DIR/shared/minio.yaml" \
    --cleanup-on-fail --wait --timeout 3m

  echo "  NFS Server..."
  kubectl apply -f "$K8S_DIR/storage/nfs-server.yaml"

  echo "  Storage PVs/PVCs..."
  kubectl apply -f "$K8S_DIR/storage/pv-claims.yaml"

  echo "  Done. Waiting for OpenSearch to be ready..."
  # OpenSearch is a hard dependency for Wazuh/OpenCTI/TheHive — a never-ready
  # OpenSearch must abort the deploy rather than silently continuing.
  if ! kubectl wait --for=condition=ready pod -l app=opensearch -n shared --timeout=300s; then
    echo "ERROR: OpenSearch did not become ready within 300s. Aborting."
    echo "  Inspect: kubectl get pods -n shared; kubectl logs -n shared -l app=opensearch"
    exit 1
  fi

  # Apply the REAL admin password to the security config now that OpenSearch is
  # ready and soc-shared-secrets exists. Must run BEFORE Wazuh (its manager/indexer
  # auth uses this password). setup-opensearch-users.sh fails closed if the cluster
  # or the source Secret is missing (pipefail propagates the error here).
  echo "  Applying OpenSearch admin password (custom internal_users.yml)..."
  "$SCRIPT_DIR/setup-opensearch-users.sh"

  # Apply index retention (ISM) policies now that OpenSearch is ready. setup-ism.sh
  # exits non-zero on any policy failure (pipefail propagates the error here).
  echo "  Applying OpenSearch ISM retention policies..."
  "$SCRIPT_DIR/setup-ism.sh"

  echo "  Shared infrastructure deployed."
}

deploy_wazuh() {
  echo "[wazuh] Deploying Wazuh SIEM/XDR..."
  ensure_namespaces

  # Wazuh manager + dashboard mount opensearch-certs / wazuh-dashboard-certs, so
  # make sure the PKI exists in the wazuh namespace before applying workloads.
  deploy_certs

  echo "  Applying ConfigMaps..."
  kubectl apply -f "$K8S_DIR/wazuh/manager/configmap-ossec.yaml"
  kubectl apply -f "$K8S_DIR/wazuh/manager/configmap-rules.yaml"
  kubectl apply -f "$K8S_DIR/wazuh/manager/configmap-decoders.yaml"
  kubectl apply -f "$K8S_DIR/wazuh/dashboard/configmap-dashboard.yaml"

  echo "  Deploying Wazuh Manager (StatefulSet) + Dashboard (Deployment)..."
  kubectl apply -f "$K8S_DIR/wazuh/manager/deployment.yaml"
  kubectl apply -f "$K8S_DIR/wazuh/dashboard/deployment.yaml"

  echo "  Deploying Wazuh Agent DaemonSet..."
  kubectl apply -f "$K8S_DIR/wazuh/agents/daemonset.yaml"

  echo "  Waiting for Wazuh Manager to be ready (agents depend on it)..."
  if ! kubectl rollout status statefulset/wazuh-manager -n wazuh --timeout=300s; then
    echo "ERROR: Wazuh Manager did not become ready within 300s. Aborting."
    echo "  Inspect: kubectl get pods -n wazuh; kubectl logs -n wazuh wazuh-manager-0"
    exit 1
  fi

  echo "  Done."
}

deploy_thehive() {
  echo "[thehive] Deploying TheHive + Cortex..."
  ensure_namespaces

  echo "  Applying Cortex RBAC..."
  kubectl apply -f "$K8S_DIR/thehive/cortex/rbac.yaml"

  echo "  Deploying TheHive..."
  helm upgrade --install thehive strangebee/thehive \
    --version "$THEHIVE_CHART_VERSION" \
    -n thehive -f "$K8S_DIR/thehive/helm-values.yaml" \
    --cleanup-on-fail --wait --timeout 5m

  echo "  Deploying Cortex..."
  helm upgrade --install cortex strangebee/cortex \
    --version "$CORTEX_CHART_VERSION" \
    -n thehive -f "$K8S_DIR/thehive/cortex/helm-values.yaml" \
    --cleanup-on-fail --wait --timeout 5m

  echo "  Done."
}

deploy_opencti() {
  echo "[opencti] Deploying OpenCTI Threat Intelligence..."
  ensure_namespaces

  # OpenCTI admin creds (token + password) are operator-supplied at deploy time and
  # are required. Threat-intel feed keys are optional; a connector whose key is
  # absent is simply not deployed (rather than seeded with a junk 'placeholder'
  # value that produces recurring failed/crash-looping connectors).
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
  # Reject obviously-weak admin creds so the platform isn't stood up with a default.
  if [ "${#octi_token}" -lt 16 ]; then
    echo "  ERROR: OPENCTI_ADMIN_TOKEN looks too short (<16 chars). Use a real UUID/token."
    exit 1
  fi
  if [ "${#octi_password}" -lt 12 ] || [ "$octi_password" = "admin" ] || [ "$octi_password" = "changeme" ]; then
    echo "  ERROR: OPENCTI_ADMIN_PASSWORD is too weak or a known default. Use >=12 chars."
    exit 1
  fi

  # Build the secret args, only including feed keys that are actually set.
  # Use explicit if-blocks (not `test && cmd`) so a false test can't abort under set -e.
  local secret_args=(
    --from-literal=admin-token="$octi_token"
    --from-literal=admin-password="$octi_password"
    --from-literal=health-access-key="${health_key:-$(openssl rand -hex 16)}"
  )
  if [ -n "$otx_key" ]; then secret_args+=(--from-literal=alienvault-api-key="$otx_key"); fi
  if [ -n "$abuse_key" ]; then secret_args+=(--from-literal=abuseipdb-api-key="$abuse_key"); fi
  if [ -n "$vt_key" ]; then secret_args+=(--from-literal=virustotal-api-key="$vt_key"); fi

  kubectl create secret generic soc-opencti-secrets -n opencti \
    "${secret_args[@]}" \
    --dry-run=client -o yaml | kubectl apply -f -

  echo "  Deploying OpenCTI platform..."
  helm upgrade --install opencti opencti/opencti \
    --version "$OPENCTI_CHART_VERSION" \
    -n opencti -f "$K8S_DIR/opencti/helm-values.yaml" \
    --cleanup-on-fail --wait --timeout 10m

  # Apply connectors selectively: skip any feed connector whose API key is unset so
  # unconfigured feeds don't crash-loop or generate recurring failed Jobs.
  echo "  Deploying connectors..."
  # mitre-attack needs no external API key — always applied.
  kubectl apply -f "$K8S_DIR/opencti/connectors/mitre-attack.yaml"
  if [ -n "$otx_key" ]; then
    kubectl apply -f "$K8S_DIR/opencti/connectors/alienvault-otx.yaml"
  else
    echo "  SKIP: AlienVault OTX connector (ALIENVAULT_OTX_API_KEY not set)."
  fi
  if [ -n "$abuse_key" ]; then
    kubectl apply -f "$K8S_DIR/opencti/connectors/abuseipdb.yaml"
  else
    echo "  SKIP: AbuseIPDB connector (ABUSEIPDB_API_KEY not set)."
  fi
  if [ -n "$vt_key" ]; then
    kubectl apply -f "$K8S_DIR/opencti/connectors/virustotal.yaml"
  else
    echo "  SKIP: VirusTotal connector (VIRUSTOTAL_API_KEY not set)."
  fi

  echo "  Done."
}

deploy_monitoring() {
  echo "[monitoring] Deploying Prometheus + Grafana..."
  ensure_namespaces

  helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
    --version "$KUBE_PROM_CHART_VERSION" \
    -n monitoring -f "$K8S_DIR/monitoring/kube-prometheus-values.yaml" \
    --wait --timeout 10m

  echo "  Done."
}

deploy_ingress() {
  echo "[ingress] Deploying Traefik IngressRoutes..."
  ensure_namespaces

  echo "  Installing Traefik..."
  helm upgrade --install traefik traefik/traefik -n kube-system \
    --version "$TRAEFIK_CHART_VERSION" \
    --set resources.requests.memory=64Mi \
    --set resources.limits.memory=128Mi \
    --wait --timeout 3m

  # --- soc-tls-cert: self-signed ingress cert (CN soc.homelab.local) -----------
  # Created with openssl (cert-manager is intentionally not used — 0 RAM PKI).
  # get-or-create so re-deploys don't churn the cert.
  if ! kubectl get secret soc-tls-cert -n kube-system &>/dev/null; then
    echo "  Generating self-signed TLS cert (soc-tls-cert)..."
    local tls_dir
    tls_dir="$(mktemp -d "${TMPDIR:-/tmp}/soc-tls.XXXXXX")"
    chmod 700 "$tls_dir"
    openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 825 \
      -keyout "$tls_dir/tls.key" -out "$tls_dir/tls.crt" \
      -subj "/CN=soc.homelab.local/O=MatchBox/C=US" \
      -addext "subjectAltName=DNS:soc.homelab.local,DNS:localhost,IP:127.0.0.1" 2>/dev/null
    kubectl create secret tls soc-tls-cert -n kube-system \
      --cert="$tls_dir/tls.crt" --key="$tls_dir/tls.key" \
      --dry-run=client -o yaml | kubectl apply -f -
    rm -rf "$tls_dir"
  else
    echo "  soc-tls-cert already exists — keeping it."
  fi

  # --- soc-auth-secret: Traefik basic-auth (htpasswd bcrypt) -------------------
  # Backs the soc-basic-auth middleware. Username/password come from env with
  # sensible defaults; password is bcrypt-hashed via htpasswd. get-or-create.
  if ! kubectl get secret soc-auth-secret -n kube-system &>/dev/null; then
    echo "  Generating basic-auth secret (soc-auth-secret)..."
    local auth_user="${SOC_BASIC_AUTH_USER:-admin}"
    local auth_pass="${SOC_BASIC_AUTH_PASSWORD:-}"
    if [ -z "$auth_pass" ]; then
      auth_pass="$(openssl rand -base64 18)"
      echo "  NOTE: SOC_BASIC_AUTH_PASSWORD not set — generated a random one."
      echo "        Set it explicitly to control the ingress login password."
    fi
    if ! command -v htpasswd &>/dev/null; then
      echo "  ERROR: htpasswd not found (install apache2-utils / httpd). Cannot create"
      echo "         soc-auth-secret. The soc-basic-auth middleware would fail to resolve."
      exit 1
    fi
    # -nbB => no update file, batch, bcrypt. Value is never echoed.
    local htpasswd_line
    htpasswd_line="$(htpasswd -nbB "$auth_user" "$auth_pass")"
    kubectl create secret generic soc-auth-secret -n kube-system \
      --from-literal=users="$htpasswd_line" \
      --dry-run=client -o yaml | kubectl apply -f -
    unset auth_pass htpasswd_line
  else
    echo "  soc-auth-secret already exists — keeping it."
  fi

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
    deploy_secrets
    # Certs are generated by deploy_shared()/deploy_wazuh() right before their
    # workloads need them (idempotent), so no separate top-level certs step here.
    deploy_shared
    deploy_wazuh
    deploy_thehive
    deploy_opencti
    deploy_monitoring
    deploy_ingress
    ;;
  namespaces) deploy_namespaces ;;
  secrets) deploy_secrets ;;
  certs) deploy_certs ;;
  shared) setup_helm_repos && deploy_shared ;;
  # Stand-alone re-apply of the OpenSearch admin password (e.g. after rotating
  # soc-shared-secrets/opensearch-password without redeploying all of shared).
  opensearch-users) "$SCRIPT_DIR/setup-opensearch-users.sh" ;;
  wazuh) deploy_wazuh ;;
  thehive) setup_helm_repos && deploy_thehive ;;
  opencti) setup_helm_repos && deploy_opencti ;;
  monitoring) setup_helm_repos && deploy_monitoring ;;
  ingress) setup_helm_repos && deploy_ingress ;;
  *)
    echo "Usage: $0 [all|namespaces|secrets|certs|shared|opensearch-users|wazuh|thehive|opencti|monitoring|ingress]"
    exit 1
    ;;
esac

echo ""
echo "=== Deployment Complete ==="
echo ""

# Final health check — exit non-zero when the stack is unhealthy so CI/automation
# (and the operator) can detect a failed deploy instead of a green-but-broken run.
echo "Running post-deploy health check..."
UNHEALTHY=$(kubectl get pods --all-namespaces --no-headers 2>/dev/null | grep -v Running | grep -v Completed | wc -l | tr -d ' ')
if [ "$UNHEALTHY" -gt 0 ]; then
  echo "ERROR: $UNHEALTHY pod(s) are not Running:"
  kubectl get pods --all-namespaces --no-headers 2>/dev/null | grep -v Running | grep -v Completed
  echo ""
  echo "Check logs: kubectl logs -n <namespace> <pod-name>"
  exit 1
fi

echo "All pods healthy."
echo "Check status: kubectl get pods --all-namespaces"
echo "Run tests:    ./scripts/test-flow.sh"
echo "Dashboards:   https://soc.homelab.local/{wazuh,thehive,opencti,grafana}"
