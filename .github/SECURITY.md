# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.3.x   | Yes       |
| < 1.3   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in MatchBox, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities
2. Email security concerns to the maintainer directly
3. Include steps to reproduce the vulnerability
4. Allow reasonable time for a fix before public disclosure

## Security Design

MatchBox follows security-by-default principles:

- All credentials stored in Kubernetes Secrets (never hardcoded)
- NetworkPolicies enforce default-deny ingress across all namespaces
- TLS 1.2+ with ECDHE cipher suites on all ingress routes
- Container images pinned to specific versions (no `:latest`)
- MCP servers enforce request timeouts, response truncation, and input validation
- Audited against ISO 27001:2022, NIST 800-53 Rev 5, and OWASP Top 10 for LLM Applications

## Credential Management

MatchBox uses a template-based approach for secrets:

1. Copy `k8s/shared/secrets.yaml.example` to `k8s/shared/secrets.yaml`
2. Replace all placeholder values with real credentials
3. The deploy script validates that no placeholder values remain before deployment
4. Never commit `secrets.yaml` to version control (it's in `.gitignore`)
