#!/bin/bash
# Apply a REAL OpenSearch admin password to the shared cluster's security config.
#
# Why this script exists (WAVE-2 HARDENING):
#   The OpenSearch Helm chart runs with DISABLE_INSTALL_DEMO_CONFIG=true so the
#   Docker entrypoint does NOT append the demo securityconfig (which would clobber
#   our custom TLS certs). A side effect is that OPENSEARCH_INITIAL_ADMIN_PASSWORD
#   is NOT honoured and the bundled internal_users.yml ships the demo `admin`
#   bcrypt hash. To run with a real admin password we must:
#     1. bcrypt-hash the desired password (soc-shared-secrets/opensearch-password),
#     2. render a custom internal_users.yml carrying that hash for `admin`,
#     3. persist it as the `opensearch-securityconfig` Secret (referenced by the
#        k8s lane's opensearch.yaml securityConfig.securityConfigSecret), and
#     4. push it into the running cluster's `.opendistro_security` index via
#        securityadmin.sh (the admin client cert = kirk.pem authenticates).
#   After this runs, the chart's `admin` user authenticates with the real password,
#   so soc-shared-secrets/opensearch-password and soc-wazuh-secrets/indexer-password
#   become the live credential everywhere.
#
# Idempotent: re-running re-hashes (bcrypt salt differs but the password verifies
# the same), re-renders the Secret via apply, and re-applies securityadmin.sh. A
# repeat run on an already-correct cluster is a harmless no-op from the operator's
# point of view.
#
# Fails fast if the cluster is unreachable or the source password Secret is missing
# (we will NOT silently fall back to the demo `admin` password).
#
# Usage: ./scripts/setup-opensearch-users.sh
# Requires: kubectl (+ working KUBECONFIG); a running OpenSearch pod in ns `shared`.
#   The bcrypt hash is produced by the OpenSearch image's bundled hash.sh via
#   `kubectl exec` (no host-side htpasswd/python bcrypt dependency required).
set -euo pipefail

# --- Resolve kubeconfig the same way the other scripts do (stand-alone safe) ----
if [ -z "${KUBECONFIG:-}" ]; then
  # Guard the command substitution itself so a missing/failed limactl neither leaks
  # stderr nor aborts under set -e before KUBECONFIG can fall back to the ambient value.
  LIMA_DIR="$( (limactl list k3s-soc --format '{{.Dir}}' 2>/dev/null) || true )"
  if [ -n "$LIMA_DIR" ]; then
    export KUBECONFIG="$LIMA_DIR/copied-from-guest/kubeconfig.yaml"
  fi
fi

OS_NS="shared"
OS_POD="opensearch-cluster-master-0"
# Where the chart mounts opensearch-certs (see opensearch.yaml secretMounts).
CERT_DIR="/usr/share/opensearch/config/certs"
# Bundled security plugin tooling inside the OpenSearch image.
SEC_TOOLS="/usr/share/opensearch/plugins/opensearch-security/tools"

echo "=== MatchBox — OpenSearch Security Users ==="

# --- Prerequisites -------------------------------------------------------------
if ! command -v kubectl &>/dev/null; then
  echo "ERROR: kubectl not found. Run ./scripts/setup-lima.sh first." >&2
  exit 1
fi
if ! kubectl cluster-info &>/dev/null; then
  echo "ERROR: Cannot connect to Kubernetes cluster (KUBECONFIG: ${KUBECONFIG:-not set})." >&2
  exit 1
fi

# Fail fast if the OpenSearch pod isn't running yet — securityadmin.sh needs a live
# transport port (9300) to push the config. deploy-stack.sh only calls us after the
# `app=opensearch` readiness wait, but guard anyway for stand-alone invocation.
if ! kubectl get pod "$OS_POD" -n "$OS_NS" &>/dev/null; then
  echo "ERROR: OpenSearch pod $OS_POD not found in ns $OS_NS." >&2
  echo "  Deploy shared infra first: ./scripts/deploy-stack.sh shared" >&2
  exit 1
fi
if ! kubectl wait --for=condition=ready "pod/$OS_POD" -n "$OS_NS" --timeout=120s &>/dev/null; then
  echo "ERROR: OpenSearch pod $OS_POD did not become ready within 120s." >&2
  exit 1
fi

# Source password Secret MUST exist — never fall back to the demo `admin` password.
if ! kubectl get secret soc-shared-secrets -n "$OS_NS" &>/dev/null; then
  echo "ERROR: Secret soc-shared-secrets not found in ns $OS_NS." >&2
  echo "  Apply secrets first: ./scripts/deploy-stack.sh secrets" >&2
  exit 1
fi

# --- 1. Read the desired admin password (never printed) ------------------------
# Pulled from the cluster Secret so this script has a single source of truth and no
# secret ever touches the host argument list. Captured into a variable only; the
# value is never echoed and is unset at the end.
echo "[1/4] Reading admin password from soc-shared-secrets/opensearch-password..."
ADMIN_PASSWORD="$(kubectl get secret soc-shared-secrets -n "$OS_NS" \
  -o jsonpath='{.data.opensearch-password}' | base64 -d)"
if [ -z "$ADMIN_PASSWORD" ]; then
  echo "ERROR: soc-shared-secrets/opensearch-password is empty." >&2
  exit 1
fi

# --- 2. bcrypt-hash it with the image's bundled hash.sh ------------------------
# The password is read into the pod-side `PASS` env var from stdin (kubectl exec -i)
# so it never appears on the pod's process argument list, then hash.sh -env PASS
# bcrypt-hashes it. The resulting hash is non-secret-by-design (bcrypt) but we still
# avoid logging it. grep keeps only the bcrypt line ($2a/$2b/$2y) in case the tool
# prints JVM banners or warnings around it.
echo "[2/4] Generating bcrypt hash via the OpenSearch image (hash.sh)..."
ADMIN_HASH="$(printf '%s' "$ADMIN_PASSWORD" | kubectl exec -i -n "$OS_NS" "$OS_POD" -- \
  sh -c 'IFS= read -r PASS; export PASS; \
    OPENSEARCH_JAVA_HOME=/usr/share/opensearch/jdk '"$SEC_TOOLS"'/hash.sh -env PASS 2>/dev/null' \
  2>/dev/null | grep -E '^\$2[aby]\$' | head -n1 || true)"
if [ -z "$ADMIN_HASH" ]; then
  echo "ERROR: failed to generate a bcrypt hash via hash.sh in $OS_POD." >&2
  echo "  Inspect: kubectl exec -n $OS_NS $OS_POD -- ls $SEC_TOOLS" >&2
  unset ADMIN_PASSWORD
  exit 1
fi
unset ADMIN_PASSWORD  # cleartext no longer needed

# --- 3. Render internal_users.yml + the opensearch-securityconfig Secret --------
# Only the `admin` user carries the real hash; every other entry is left to the
# chart's bundled defaults by NOT shipping them here (securityadmin.sh -f updates
# just this one config file against the running security index). The heredoc body is
# the canonical OpenSearch internal_users.yml schema.
echo "[3/4] Rendering internal_users.yml + opensearch-securityconfig Secret..."
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/matchbox-os-users.XXXXXX")"
chmod 700 "$WORK_DIR"
cleanup() { rm -rf "$WORK_DIR"; }
trap cleanup EXIT

cat > "$WORK_DIR/internal_users.yml" <<EOF
---
# MatchBox custom internal_users.yml — rendered by scripts/setup-opensearch-users.sh.
# Carries the bcrypt hash of soc-shared-secrets/opensearch-password for \`admin\`.
# DO NOT hand-edit; re-run the script to regenerate.
_meta:
  type: "internalusers"
  config_version: 2

# admin — full cluster access; password = soc-shared-secrets/opensearch-password.
admin:
  hash: "${ADMIN_HASH}"
  reserved: true
  backend_roles:
    - "admin"
  description: "MatchBox SOC admin (real password, WAVE-2 hardened)"
EOF
unset ADMIN_HASH  # hash now lives only in the rendered file (temp + Secret)

# Persist as the Secret the k8s lane's opensearch.yaml references
# (securityConfig.config.securityConfigSecret: opensearch-securityconfig). Stored
# under the canonical filename so the chart mounts it into the securityconfig dir.
kubectl create secret generic opensearch-securityconfig -n "$OS_NS" \
  --from-file=internal_users.yml="$WORK_DIR/internal_users.yml" \
  --dry-run=client -o yaml | kubectl apply -f -

# --- 4. Push it into the running cluster with securityadmin.sh ------------------
# securityadmin.sh authenticates with the admin client cert (kirk.pem) over the
# transport port and updates the .opendistro_security index in place. We copy the
# rendered file into the pod, run the tool against just internal_users.yml (-f), then
# remove the temp copy. -icl ignores cluster name, -nhnv skips hostname verification
# (our certs use service-DNS SANs, not 127.0.0.1's reverse name).
echo "[4/4] Applying via securityadmin.sh (admin cert auth)..."
kubectl cp "$WORK_DIR/internal_users.yml" \
  "$OS_NS/$OS_POD:/tmp/internal_users.yml"

if ! kubectl exec -n "$OS_NS" "$OS_POD" -- \
  sh -c "OPENSEARCH_JAVA_HOME=/usr/share/opensearch/jdk \
    $SEC_TOOLS/securityadmin.sh \
    -f /tmp/internal_users.yml \
    -t internalusers \
    -icl -nhnv \
    -cacert $CERT_DIR/root-ca.pem \
    -cert $CERT_DIR/kirk.pem \
    -key $CERT_DIR/kirk-key.pem \
    -h localhost -p 9300; rc=\$?; rm -f /tmp/internal_users.yml; exit \$rc"; then
  echo "ERROR: securityadmin.sh failed to apply internal_users.yml." >&2
  echo "  Inspect: kubectl logs -n $OS_NS $OS_POD" >&2
  exit 1
fi

echo ""
echo "=== OpenSearch admin password applied ==="
echo "  Secret opensearch-securityconfig (ns $OS_NS) holds the custom internal_users.yml."
echo "  The cluster's .opendistro_security index now uses the real admin password from"
echo "  soc-shared-secrets/opensearch-password. Temp render dir removed."
