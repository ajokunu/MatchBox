#!/bin/bash
# Bootstrap SOPS + age encryption for the MatchBox secrets.
#
# What this does (Contract Section 2):
#   1. Generate an age keypair to $SOPS_AGE_KEY_FILE (default
#      ~/.config/sops/age/keys.txt) — OUTSIDE the repo — if one does not exist.
#   2. Write the PUBLIC recipient (age1...) into the repo-root .sops.yaml so the
#      creation_rule can encrypt for it.
#   3. Encrypt k8s/shared/secrets.yaml -> k8s/shared/secrets.enc.yaml.
#
# The plaintext k8s/shared/secrets.yaml stays gitignored; secrets.enc.yaml is the
# committable, encrypted source of truth that deploy-stack.sh decrypts at apply time.
#
# NEVER commit the private key. The age key file lives outside the repo and is added
# to .gitignore defensively (*.agekey, keys.txt) in case anyone relocates it inside.
#
# Usage: ./scripts/setup-sops.sh
# Requires: sops, age (age-keygen). Install: brew install sops age
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

SOPS_FILE="$PROJECT_DIR/.sops.yaml"
SECRETS_PLAIN="$PROJECT_DIR/k8s/shared/secrets.yaml"
SECRETS_ENC="$PROJECT_DIR/k8s/shared/secrets.enc.yaml"

# Age key lives OUTSIDE the repo by default.
AGE_KEY_FILE="${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}"

echo "=== MatchBox — SOPS/age Setup ==="

# --- Prerequisites -------------------------------------------------------------
for cmd in sops age-keygen; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: '$cmd' not found. Install with: brew install sops age" >&2
    exit 1
  fi
done

# --- 1. Generate the age key (outside the repo) if absent ----------------------
if [ -f "$AGE_KEY_FILE" ]; then
  echo "[1/3] Age key already exists at $AGE_KEY_FILE (leaving it untouched)."
else
  echo "[1/3] Generating age key at $AGE_KEY_FILE..."
  mkdir -p "$(dirname "$AGE_KEY_FILE")"
  # Generate with restrictive perms; never print the private key.
  ( umask 077 && age-keygen -o "$AGE_KEY_FILE" >/dev/null 2>&1 )
  chmod 600 "$AGE_KEY_FILE"
  echo "  Created. Keep this file private and backed up — losing it means the"
  echo "  encrypted secrets can no longer be decrypted."
fi

# Refuse to continue if the key somehow landed inside the repo tree.
case "$AGE_KEY_FILE" in
  "$PROJECT_DIR"/*)
    echo "ERROR: age key file is inside the repo ($AGE_KEY_FILE). Move it outside" >&2
    echo "  (e.g. ~/.config/sops/age/keys.txt) before continuing — never commit it." >&2
    exit 1
    ;;
esac

# Extract the PUBLIC recipient only (the 'public key:' comment line). The private
# line ('AGE-SECRET-KEY-...') is never read into a variable or printed.
AGE_RECIPIENT="$(grep -oE 'age1[0-9a-z]+' "$AGE_KEY_FILE" | head -n1)"
if [ -z "$AGE_RECIPIENT" ]; then
  echo "ERROR: could not find an age public recipient (age1...) in $AGE_KEY_FILE." >&2
  exit 1
fi

# --- 2. Write the public recipient into .sops.yaml -----------------------------
echo "[2/3] Writing public recipient into .sops.yaml..."
# Regenerate .sops.yaml deterministically so re-running picks up a rotated key.
cat > "$SOPS_FILE" <<EOF
# SOPS configuration — generated/updated by scripts/setup-sops.sh.
# Only the 'data' and 'stringData' fields of secret manifests are encrypted so
# the YAML structure (kind, metadata, namespace) stays readable in git diffs.
# The 'age' value below is a PUBLIC recipient; the matching private key lives at
# \$SOPS_AGE_KEY_FILE (default ~/.config/sops/age/keys.txt), OUTSIDE this repo.
creation_rules:
  - path_regex: k8s/shared/secrets\.enc\.yaml$
    encrypted_regex: '^(data|stringData)$'
    age: $AGE_RECIPIENT
EOF
echo "  Recipient written (public key only)."

# --- 3. Encrypt secrets.yaml -> secrets.enc.yaml -------------------------------
if [ ! -f "$SECRETS_PLAIN" ]; then
  echo "[3/3] No plaintext secrets at $SECRETS_PLAIN."
  echo "  Copy k8s/shared/secrets.yaml.example to k8s/shared/secrets.yaml, fill in"
  echo "  real values, then re-run this script to produce secrets.enc.yaml."
  exit 0
fi

echo "[3/3] Encrypting secrets.yaml -> secrets.enc.yaml..."
# SOPS reads the recipient from .sops.yaml via the path_regex match. We give the
# output path so the creation_rule applies. The plaintext never goes to stdout.
SOPS_AGE_KEY_FILE="$AGE_KEY_FILE" sops --encrypt "$SECRETS_PLAIN" > "$SECRETS_ENC"
echo "  Wrote $SECRETS_ENC (commit this; secrets.yaml stays gitignored)."

echo ""
echo "=== SOPS setup complete ==="
echo "  Encrypted secrets:  k8s/shared/secrets.enc.yaml  (committable)"
echo "  Private age key:    $AGE_KEY_FILE  (NEVER commit)"
echo "  deploy-stack.sh will decrypt at apply time using SOPS_AGE_KEY_FILE."
