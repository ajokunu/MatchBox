#!/bin/bash
# Generate the PKI for the MatchBox SOC and load it into Kubernetes.
#
# This is the CANONICAL cert path (cert-manager is intentionally NOT used to keep
# steady-state RAM at 0 for PKI on the 16GB Mac Mini). It uses plain openssl so it
# is reproducible and runs anywhere.
#
# Produces:
#   - root-ca.pem / root-ca-key.pem  (self-signed CA, O=MatchBox)
#   - esnode.pem  / esnode-key.pem   (OpenSearch node cert, CN=opensearch-node)
#   - kirk.pem    / kirk-key.pem     (OpenSearch admin cert,  CN=admin)
#   - dashboard.pem / dashboard-key.pem (Wazuh Dashboard server cert, CN=wazuh-dashboard)
#
# All private keys are converted to PKCS#8 (-topk8 -nocrypt) because Wazuh's
# Filebeat (Go crypto/tls) rejects the legacy PKCS#1 "RSA PRIVATE KEY" form.
#
# Loads them as the cluster objects the manifests reference (Contract Section 1):
#   - Secret    opensearch-certs        in ns shared AND wazuh
#       keys: esnode.pem, esnode-key.pem, root-ca.pem, kirk.pem, kirk-key.pem
#   - Secret    wazuh-dashboard-certs   in ns wazuh
#       keys: root-ca.pem, dashboard.pem, dashboard-key.pem
#   - ConfigMap opensearch-ca-cert      in ns wazuh AND opencti  (key ca.crt = root-ca.pem)
#
# Idempotent: certs are regenerated into a temp dir each run, then secrets are
# get-or-replaced via `kubectl apply` (dry-run|apply) so re-runs are safe. To force
# brand-new key material, delete the secrets first.
#
# Usage: ./scripts/generate-certs.sh
# Requires: openssl, kubectl (with a working KUBECONFIG / cluster).
set -euo pipefail


# Resolve kubeconfig the same way the other scripts do, so this can run stand-alone.
if [ -z "${KUBECONFIG:-}" ]; then
  LIMA_DIR="$(limactl list k3s-soc --format '{{.Dir}}' 2>/dev/null || true)"
  if [ -n "$LIMA_DIR" ]; then
    export KUBECONFIG="$LIMA_DIR/copied-from-guest/kubeconfig.yaml"
  fi
fi

# --- Distinguished names / SANs (MUST match opensearch.yaml security config) ---
CA_SUBJECT="/CN=MatchBox Root CA/O=MatchBox/C=US"
NODE_SUBJECT="/CN=opensearch-node/O=MatchBox/C=US"
ADMIN_SUBJECT="/CN=admin/O=MatchBox/C=US"
DASHBOARD_SUBJECT="/CN=wazuh-dashboard/O=MatchBox/C=US"

# SANs for the OpenSearch node cert — must cover the in-cluster Service DNS names
# the Wazuh/OpenCTI/TheHive clients dial, plus localhost for in-pod curl checks.
ESNODE_SAN="DNS:opensearch-cluster-master.shared.svc.cluster.local,DNS:opensearch-cluster-master,DNS:localhost,IP:127.0.0.1"
DASHBOARD_SAN="DNS:wazuh-dashboard.wazuh.svc.cluster.local,DNS:wazuh-dashboard,DNS:localhost,IP:127.0.0.1"

CERT_DAYS=825   # < 825d keeps the leaf certs within common client validity caps
RSA_BITS=2048

echo "=== MatchBox — Certificate Generation ==="

if ! command -v openssl &>/dev/null; then
  echo "ERROR: openssl not found." >&2
  exit 1
fi
if ! command -v kubectl &>/dev/null; then
  echo "ERROR: kubectl not found. Run ./scripts/setup-lima.sh first." >&2
  exit 1
fi
if ! kubectl cluster-info &>/dev/null; then
  echo "ERROR: Cannot connect to Kubernetes cluster (KUBECONFIG: ${KUBECONFIG:-not set})." >&2
  exit 1
fi

# Idempotency: if the cert objects already exist in every target namespace, do
# nothing. This is critical — regenerating would mint a NEW CA, breaking the trust
# already established between OpenSearch (shared) and the Wazuh manager (wazuh).
# Pass --force to deliberately rotate all key material.
FORCE="${1:-}"
if [ "$FORCE" != "--force" ]; then
  if kubectl get secret opensearch-certs -n shared &>/dev/null \
    && kubectl get secret opensearch-certs -n wazuh &>/dev/null \
    && kubectl get secret wazuh-dashboard-certs -n wazuh &>/dev/null \
    && kubectl get configmap opensearch-ca-cert -n wazuh &>/dev/null \
    && kubectl get configmap opensearch-ca-cert -n opencti &>/dev/null \
    && kubectl get configmap opensearch-ca-cert -n thehive &>/dev/null \
    && kubectl get configmap opensearch-ca-cert -n monitoring &>/dev/null; then
    echo "  Certs already present in all namespaces — skipping (use --force to rotate)."
    exit 0
  fi
fi

# Work in a private temp dir with locked-down perms; clean up on exit so no key
# material is left on disk (0 RAM PKI, ephemeral key files).
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/matchbox-certs.XXXXXX")"
chmod 700 "$WORK_DIR"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

cd "$WORK_DIR"

# --- 1. Root CA ----------------------------------------------------------------
echo "[1/4] Root CA..."
openssl genrsa -out root-ca-key-pkcs1.pem "$RSA_BITS" 2>/dev/null
# Normalise the CA key to PKCS#8 for consistency with the leaf keys.
openssl pkcs8 -topk8 -nocrypt -in root-ca-key-pkcs1.pem -out root-ca-key.pem
openssl req -x509 -new -nodes -key root-ca-key.pem -sha256 -days "$CERT_DAYS" \
  -subj "$CA_SUBJECT" -out root-ca.pem

# Helper: issue a leaf cert signed by the root CA.
#   $1 = name prefix   $2 = subject DN   $3 = SAN list (may be empty)
issue_cert() {
  local name="$1" subject="$2" san="$3"
  openssl genrsa -out "${name}-key-pkcs1.pem" "$RSA_BITS" 2>/dev/null
  # Convert to PKCS#8 — required by Wazuh Filebeat (Go TLS rejects PKCS#1).
  openssl pkcs8 -topk8 -nocrypt -in "${name}-key-pkcs1.pem" -out "${name}-key.pem"

  local ext_file="${name}-ext.cnf"
  {
    echo "basicConstraints=CA:FALSE"
    echo "keyUsage=digitalSignature,keyEncipherment"
    echo "extendedKeyUsage=serverAuth,clientAuth"
    if [ -n "$san" ]; then
      echo "subjectAltName=${san}"
    fi
  } > "$ext_file"

  openssl req -new -key "${name}-key.pem" -subj "$subject" -out "${name}.csr"
  openssl x509 -req -in "${name}.csr" -CA root-ca.pem -CAkey root-ca-key.pem \
    -CAcreateserial -sha256 -days "$CERT_DAYS" \
    -extfile "$ext_file" -out "${name}.pem" 2>/dev/null
  rm -f "${name}.csr" "${name}-key-pkcs1.pem" "$ext_file"
}

# --- 2. OpenSearch node + admin (kirk) certs -----------------------------------
echo "[2/4] OpenSearch node + admin certs..."
issue_cert "esnode" "$NODE_SUBJECT" "$ESNODE_SAN"
# Admin cert: no SAN needed (used as a client cert for the security admin tool).
issue_cert "kirk" "$ADMIN_SUBJECT" ""

# --- 3. Wazuh Dashboard cert ---------------------------------------------------
echo "[3/4] Wazuh Dashboard cert..."
issue_cert "dashboard" "$DASHBOARD_SUBJECT" "$DASHBOARD_SAN"

# Tidy up the CA's PKCS#1 scratch key.
rm -f root-ca-key-pkcs1.pem root-ca.srl

# --- 4. Load into Kubernetes ---------------------------------------------------
echo "[4/4] Loading certs into Kubernetes..."

# Ensure target namespaces exist (idempotent) so a stand-alone run can't fail on a
# missing namespace. thehive + monitoring consume the CA ConfigMap too (TheHive,
# Cortex, and Grafana all verify the TLS-only shared OpenSearch).
for ns in shared wazuh opencti thehive monitoring; do
  kubectl create namespace "$ns" --dry-run=client -o yaml | kubectl apply -f - >/dev/null
done

# opensearch-certs (shared + wazuh) — same material in both namespaces.
for ns in shared wazuh; do
  kubectl create secret generic opensearch-certs -n "$ns" \
    --from-file=esnode.pem=esnode.pem \
    --from-file=esnode-key.pem=esnode-key.pem \
    --from-file=root-ca.pem=root-ca.pem \
    --from-file=kirk.pem=kirk.pem \
    --from-file=kirk-key.pem=kirk-key.pem \
    --dry-run=client -o yaml | kubectl apply -f -
done

# wazuh-dashboard-certs (wazuh).
kubectl create secret generic wazuh-dashboard-certs -n wazuh \
  --from-file=root-ca.pem=root-ca.pem \
  --from-file=dashboard.pem=dashboard.pem \
  --from-file=dashboard-key.pem=dashboard-key.pem \
  --dry-run=client -o yaml | kubectl apply -f -

# opensearch-ca-cert ConfigMap — upstream CA trust bundle for every namespace whose
# workloads verify the shared OpenSearch server cert: wazuh (manager/dashboard),
# opencti (platform/worker), thehive (TheHive + Cortex), monitoring (Grafana datasource).
# This script is the SINGLE SOURCE for these ConfigMaps — there are no in-repo manifest
# files for them (a committed placeholder cert would be an invalid-CA footgun).
for ns in wazuh opencti thehive monitoring; do
  kubectl create configmap opensearch-ca-cert -n "$ns" \
    --from-file=ca.crt=root-ca.pem \
    --dry-run=client -o yaml | kubectl apply -f -
done

echo ""
echo "=== Certificate generation complete ==="
echo "  Loaded: opensearch-certs (shared, wazuh), wazuh-dashboard-certs (wazuh),"
echo "          opensearch-ca-cert ConfigMap (wazuh, opencti, thehive, monitoring)."
echo "  Temp key material in $WORK_DIR has been removed."
