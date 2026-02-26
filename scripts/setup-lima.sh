#!/bin/bash
# Setup Lima VM with k3s for DonnieBot Security Center
# Usage: ./scripts/setup-lima.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== DonnieBot Security Center — Lima VM Setup ==="

# Ensure Homebrew is in PATH (common issue on Apple Silicon)
if [ -f /opt/homebrew/bin/brew ]; then
  eval "$(/opt/homebrew/bin/brew shellenv)"
elif [ -f /usr/local/bin/brew ]; then
  eval "$(/usr/local/bin/brew shellenv)"
fi

# Check prerequisites
echo "[1/5] Checking prerequisites..."
if ! command -v brew &>/dev/null; then
  echo "ERROR: Homebrew not found. Install from https://brew.sh"
  exit 1
fi
echo "  brew: OK"

for cmd in limactl kubectl helm; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "  Installing $cmd..."
    case $cmd in
      limactl) brew install lima ;;
      kubectl) brew install kubectl ;;
      helm) brew install helm ;;
    esac
  else
    echo "  $cmd: OK ($(command -v "$cmd"))"
  fi
done

# Check if VM already exists
if limactl list --format '{{.Name}}' 2>/dev/null | grep -q "^k3s-soc$"; then
  echo "[!] Lima VM 'k3s-soc' already exists."
  echo "    Status: $(limactl list k3s-soc --format '{{.Status}}')"
  echo "    To recreate: limactl delete k3s-soc && ./scripts/setup-lima.sh"

  # Start if stopped
  if [ "$(limactl list k3s-soc --format '{{.Status}}')" = "Stopped" ]; then
    echo "    Starting stopped VM..."
    limactl start k3s-soc
  fi
else
  # Create and start Lima VM
  echo "[2/5] Creating Lima VM (10GB RAM, 4 CPUs, 120GB disk)..."
  echo "  This will take a few minutes on first boot..."
  limactl start "$PROJECT_DIR/lima/k3s-soc.yaml" --name k3s-soc
fi

# Configure kubeconfig
echo "[3/5] Configuring kubeconfig..."
KUBECONFIG_PATH="$(limactl list k3s-soc --format '{{.Dir}}')/copied-from-guest/kubeconfig.yaml"

if [ -f "$KUBECONFIG_PATH" ]; then
  # Fix server address for macOS access
  sed -i '' 's/0\.0\.0\.0/127.0.0.1/g' "$KUBECONFIG_PATH" 2>/dev/null || true
  export KUBECONFIG="$KUBECONFIG_PATH"
  echo "  KUBECONFIG=$KUBECONFIG_PATH"
else
  echo "  ERROR: kubeconfig not found at $KUBECONFIG_PATH"
  echo "  Trying manual copy..."
  limactl shell k3s-soc sudo cat /etc/rancher/k3s/k3s.yaml > /tmp/k3s-soc-kubeconfig.yaml
  sed -i '' 's/127\.0\.0\.1/127.0.0.1/g' /tmp/k3s-soc-kubeconfig.yaml
  KUBECONFIG_PATH="/tmp/k3s-soc-kubeconfig.yaml"
  export KUBECONFIG="$KUBECONFIG_PATH"
fi

# Wait for k3s to be ready
echo "[4/5] Waiting for k3s cluster to be ready..."
for i in $(seq 1 30); do
  if kubectl get nodes &>/dev/null; then
    echo "  k3s cluster is ready!"
    kubectl get nodes
    break
  fi
  echo "  Waiting... ($i/30)"
  sleep 10
done

# Add Helm repos
echo "[5/5] Adding Helm repositories..."
helm repo add opensearch https://opensearch-project.github.io/helm-charts/ 2>/dev/null || true
helm repo add bitnami https://charts.bitnami.com/bitnami 2>/dev/null || true
helm repo add minio https://charts.min.io/ 2>/dev/null || true
helm repo add strangebee https://strangebee.github.io/helm-charts/ 2>/dev/null || true
helm repo add opencti https://devops-ia.github.io/helm-opencti/ 2>/dev/null || true
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts/ 2>/dev/null || true
helm repo add traefik https://traefik.github.io/charts 2>/dev/null || true
helm repo update

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To use kubectl from your terminal, run:"
echo "  export KUBECONFIG=$KUBECONFIG_PATH"
echo ""
echo "Next step: Deploy the SOC stack:"
echo "  ./scripts/deploy-stack.sh"
