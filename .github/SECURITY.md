# Security Policy

## Supported Versions

Only the current minor release line receives security fixes. Bump this table and
`CHANGELOG.md` together on every release (see "Release process" below).

| Version | Supported |
|---------|-----------|
| 1.6.x   | Yes       |
| < 1.6   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in MatchBox, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Preferred: use GitHub's **private vulnerability reporting** (repo → *Security* →
   *Report a vulnerability*), which opens a private advisory thread with the maintainers.
3. Alternatively, email the maintainer directly at **aaron@tabletalesai.com** with the
   subject line `MatchBox SECURITY`.
4. Include steps to reproduce, affected component(s), and any proof-of-concept.
5. Allow reasonable time for a fix before public disclosure (target: 90 days).

## Release process

Each tagged release MUST, in the same change:

1. Add a dated entry to `CHANGELOG.md`.
2. Update the **Supported Versions** table above to the new minor line.

## Security Design

MatchBox follows security-by-default principles:

- All credentials stored in Kubernetes Secrets (never hardcoded)
- NetworkPolicies enforce default-deny ingress across all namespaces
- TLS 1.2+ with ECDHE cipher suites on all ingress routes
- Container images pinned to specific versions (no `:latest`)
- MCP servers enforce request timeouts, response truncation, and input validation
- Audited against ISO 27001:2022, NIST 800-53 Rev 5, and OWASP Top 10 for LLM Applications

## Credential Management

MatchBox keeps all credentials in Kubernetes Secrets that are **encrypted at rest with
SOPS + age** before they ever touch version control:

1. The committed, encrypted secret bundle is `k8s/shared/secrets.enc.yaml` (SOPS-encrypted
   with an age recipient; only the `data`/`stringData` fields are ciphertext).
2. The age **private** key lives outside the repo (`$SOPS_AGE_KEY_FILE`, default
   `~/.config/sops/age/keys.txt`) and is never committed.
3. The deploy script decrypts at apply time — `sops --decrypt k8s/shared/secrets.enc.yaml
   | kubectl apply -f -` — and fails fast if the age key is missing.
4. The plaintext `k8s/shared/secrets.yaml` is a local working copy only; it is gitignored
   and must never be committed. `k8s/shared/secrets.yaml.example` documents the required
   keys with placeholder values.
5. `gitleaks` runs in CI to enforce that no plaintext credential ever lands in the tree.

See `docs/runbooks/initial-setup.md` for the `make secrets-init` → encrypt → deploy flow.
