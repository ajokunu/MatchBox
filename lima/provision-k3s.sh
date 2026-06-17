#!/bin/bash
# Shared k3s provisioning script for the MatchBox Lima VMs.
#
# Referenced by BOTH lima/k3s-soc.yaml and lima/k3s-soc-minimal.yaml via
# `provision: [{ mode: system, file: provision-k3s.sh }]`, so fixes (version pins,
# kubeconfig mode, etc.) are applied once and can't drift between the two defs.
#
# The few values that differ between the full and minimal VMs are passed in through
# the Lima top-level `env:` map (injected into this script's environment):
#   SWAP_SIZE                  e.g. 4G (full) / 2G (minimal)
#   K3S_SYSTEM_RESERVED        e.g. cpu=200m,memory=256Mi
#   K3S_EVICTION_HARD          e.g. memory.available<200Mi
#   K3S_EVICTION_SOFT          e.g. memory.available<500Mi
#
# Pinned, integrity-checked toolchain (supply-chain hardening):
#   INSTALL_K3S_VERSION        pinned k3s release (no floating "latest")
#   HELM_VERSION               pinned Helm release, installer verified by SHA256
set -euo pipefail

# --- Defaults (used if the Lima env map omits a value) -------------------------
SWAP_SIZE="${SWAP_SIZE:-4G}"
K3S_SYSTEM_RESERVED="${K3S_SYSTEM_RESERVED:-cpu=200m,memory=256Mi}"
K3S_EVICTION_HARD="${K3S_EVICTION_HARD:-memory.available<200Mi}"
K3S_EVICTION_SOFT="${K3S_EVICTION_SOFT:-memory.available<500Mi}"

# Pinned toolchain versions — bump deliberately, never by drift.
INSTALL_K3S_VERSION="${INSTALL_K3S_VERSION:-v1.31.4+k3s1}"
HELM_VERSION="${HELM_VERSION:-v3.16.3}"

# Lima substitutes {{.User}} before writing this file, so LIMA_USER is the VM user.
LIMA_USER="{{.User}}"

# --- Swap Configuration --------------------------------------------------------
# Safety net for memory pressure on the slim Mac Mini profile.
if [ ! -f /swapfile ]; then
  fallocate -l "$SWAP_SIZE" /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- System Tuning -------------------------------------------------------------
# OpenSearch requires vm.max_map_count >= 262144.
echo "vm.max_map_count=262144" > /etc/sysctl.d/99-opensearch.conf
sysctl -w vm.max_map_count=262144

# Raise file-descriptor limits for OpenSearch and Wazuh.
if ! grep -q "matchbox nofile" /etc/security/limits.conf; then
  {
    echo "* soft nofile 65536  # matchbox nofile"
    echo "* hard nofile 65536  # matchbox nofile"
  } >> /etc/security/limits.conf
fi

# --- Install k3s (pinned) ------------------------------------------------------
# --disable=traefik: we install our own Traefik with custom config.
# kubeconfig mode is left at the secure k3s default (600); we copy a per-user
# kubeconfig below so non-root access works without world-readable admin creds.
curl -sfL https://get.k3s.io | \
  INSTALL_K3S_VERSION="$INSTALL_K3S_VERSION" \
  INSTALL_K3S_EXEC="server \
    --disable=traefik \
    --kubelet-arg=system-reserved=${K3S_SYSTEM_RESERVED} \
    --kubelet-arg=eviction-hard=${K3S_EVICTION_HARD} \
    --kubelet-arg=eviction-soft=${K3S_EVICTION_SOFT} \
    --kubelet-arg=eviction-soft-grace-period=memory.available=30s" \
  sh -

# --- Install Helm (pinned + checksum-verified) ---------------------------------
# Fetch a tagged release tarball (not the moving main-branch installer) and verify
# its SHA256 against the published checksum before extracting.
HELM_ARCH="$(dpkg --print-architecture)"   # arm64 on Apple Silicon
HELM_TGZ="helm-${HELM_VERSION}-linux-${HELM_ARCH}.tar.gz"
HELM_BASE="https://get.helm.sh"
TMP_HELM="$(mktemp -d)"
curl -fsSL "${HELM_BASE}/${HELM_TGZ}" -o "${TMP_HELM}/${HELM_TGZ}"
curl -fsSL "${HELM_BASE}/${HELM_TGZ}.sha256sum" -o "${TMP_HELM}/${HELM_TGZ}.sha256sum"
( cd "$TMP_HELM" && sha256sum -c "${HELM_TGZ}.sha256sum" )
tar -xzf "${TMP_HELM}/${HELM_TGZ}" -C "$TMP_HELM"
install -m 0755 "${TMP_HELM}/linux-${HELM_ARCH}/helm" /usr/local/bin/helm
rm -rf "$TMP_HELM"

# --- Export kubeconfig for per-user (non-root) access --------------------------
# k3s.yaml already points at 127.0.0.1, which is reachable from macOS via the
# Lima 6443 port-forward — no 0.0.0.0 rewrite needed (and rewriting it is misleading).
mkdir -p "/home/${LIMA_USER}/.kube"
cp /etc/rancher/k3s/k3s.yaml "/home/${LIMA_USER}/.kube/config"
chmod 600 "/home/${LIMA_USER}/.kube/config"
chown -R "$(id -u "${LIMA_USER}")":"$(id -g "${LIMA_USER}")" "/home/${LIMA_USER}/.kube"

# --- NFS server packages (Cortex shared filesystem) ----------------------------
apt-get update && apt-get install -y nfs-kernel-server

# --- Wait for k3s to be ready --------------------------------------------------
until kubectl --kubeconfig=/etc/rancher/k3s/k3s.yaml get nodes 2>/dev/null; do
  echo "Waiting for k3s..."
  sleep 5
done
echo "k3s is ready!"
