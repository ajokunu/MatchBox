# Changelog

All notable changes to MatchBox are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned with [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-02-27

Security hardening + code quality fixes across 7 issues from code review.

### Fixed
- **Redis Helm values duplicate `master:` key** — Second block silently overwrote the first, dropping resource limits and persistence config. Merged into single block.
- **TLS verification disabled** — OpenCTI (`REJECT_UNAUTHORIZED: false`, `NODE_TLS_REJECT_UNAUTHORIZED: 0`) and Wazuh Manager (`FILEBEAT_SSL_VERIFICATION_MODE: none`) now use proper CA certificate verification via ConfigMap-mounted CA cert

### Added
- **Egress NetworkPolicies** — Default-deny egress + explicit allow rules for all 5 namespaces: DNS (UDP 53), internal pod-to-pod, cross-namespace service access, and HTTPS (443) for connectors/analyzers. 10 new policies.
- **OpenSearch CA cert ConfigMap** (`k8s/shared/opensearch-ca-cert.yaml`) — Distributes CA cert to opencti and wazuh namespaces for TLS verification
- **`@matchbox/mcp-shared` package** (`mcp-servers/shared/`) — Extracted `fetchWithRetry()`, `formatResponse()`, `RETRYABLE_CODES`, `REQUEST_TIMEOUT_MS`, `MAX_RESPONSE_CHARS` into shared package. All 3 MCP servers now import from shared.
- **OpenCTI health check in test-flow.sh** — API connectivity test checks `/health` endpoint
- **`setup_helm_repos()` in deploy-stack.sh** — Adds all 7 required Helm repos before deployment, called from `all` case and individual Helm-dependent components

### Changed
- **Label standardization** — Wazuh Manager, Dashboard, and Agent manifests converted from `app:` to `app.kubernetes.io/name:` labels. Network policies and test script updated to match.
- Network policies header comment updated to reflect egress is now controlled
- MCP servers now depend on `@matchbox/mcp-shared` (file: link)

### Security
- Egress traffic locked down per namespace — only DNS, internal services, and HTTPS (where needed) allowed
- TLS certificate verification enabled on all OpenSearch connections (was previously disabled)
- Network segmentation now covers both ingress AND egress (was ingress-only)

## [1.3.0] — 2026-02-27

Stability release — fix crash-looping components, harden reliability, optimize resource usage.

### Fixed
- **Wazuh Manager analysisd crash** — `<ruleset>` block was missing default `ruleset/rules` and `ruleset/decoders` directories, causing zero built-in rules to load and analysisd to exit with "Rules in an inconsistent state"
- **Wazuh Dashboard crash-loop** — OpenSearch hostname mismatch (`opensearch-cluster-master` vs actual service name) caused ECONNREFUSED on startup (35+ restarts)
- **Cortex OOMKilled** — Memory limit increased from 512Mi to 768Mi to prevent restart loops on startup
- **rootcheck errors** — Added missing `rootkit_files` and `rootkit_trojans` paths to Wazuh Manager ossec.conf
- **Custom rules using `<if_sid>1</if_sid>`** — Now load correctly since built-in rule IDs are available
- **test-flow.sh arithmetic bug** — Replaced `((PASS++))` with `PASS=$((PASS + 1))` to avoid exit code 1 with `set -e`
- **test-flow.sh label mismatches** — Fixed OpenSearch, Cortex PVC, and NFS pod selectors to match actual K8s labels
- **NetworkPolicy Prometheus ports** — Added actual app metrics ports (55000, 9000, 9001, 4000, 14269) beyond node-exporter 9100

### Added
- **Health probes** on 5 services that lacked them: OpenSearch, Redis, RabbitMQ, MinIO, Wazuh Agent DaemonSet
- **CronJob guards** on all 3 OpenCTI connectors: `concurrencyPolicy: Forbid`, `backoffLimit: 2`, `activeDeadlineSeconds`, `ttlSecondsAfterFinished`
- **OpenSearch ISM policies** — Automatic index cleanup: Wazuh alerts (30d), security audit logs (14d), OpenCTI history (90d)
- **`scripts/setup-ism.sh`** — New script to create/verify ISM policies via OpenSearch API
- **MCP server retry logic** — `fetchWithRetry()` with exponential backoff on HTTP 429/503 and timeouts
- **MCP server env var configuration** — `REQUEST_TIMEOUT_MS`, `MAX_RESPONSE_CHARS`, `TOKEN_TTL_MS` (Wazuh) now configurable
- **Wazuh Dashboard ConfigMap** — New `configmap-dashboard.yaml` for proper opensearch_dashboards.yml
- **test-flow.sh API connectivity tests** — Section [8/8] tests live health endpoints for Wazuh, TheHive, Cortex, Grafana
- **test-flow.sh verbose mode** — `-v` flag shows failing command output for debugging
- **deploy-stack.sh post-deploy health check** — Reports unhealthy pods after deployment completes

### Changed
- Wazuh Manager now loads 8,549 built-in rules + 8 custom rules (was 0 + 0)
- `deploy-stack.sh` — All Helm installs now use `--cleanup-on-fail` flag
- `test-flow.sh` — Rewritten: 33 checks across 8 sections (was 20+ across 7), `eval` usage removed
- Custom Wazuh rules rewritten to use valid OS_Regex syntax (no `{n}` quantifiers)
- TheHive integration commented out in ossec.conf (w2thive script not yet deployed)
- MCP server `safeId` regex uses `+` quantifier (was `*`) to reject empty strings

### Security
- 0 npm vulnerabilities across all 3 MCP servers
- No hardcoded secrets detected in any manifest or source file
- All container images remain pinned (no `:latest` tags)
- Passed full security audit: secrets, RBAC, image pinning, input validation, script injection, NetworkPolicies

## [1.2.0] — 2026-02-27

Consolidated release — production-ready home SOC stack with full compliance auditing.

### Core Stack
- **Wazuh 4.14.3** — SIEM/XDR with Manager, Dashboard, and Agent DaemonSet
- **OpenCTI 6.9.5** — Threat intelligence platform with MITRE ATT&CK, AlienVault OTX, AbuseIPDB, VirusTotal connectors
- **TheHive 5.4 + Cortex 3.1.8** — Incident response with automated analyzers (K8s Jobs)
- **Prometheus + Grafana** — Full observability with custom Wazuh dashboards
- **OpenSearch 2.19.1** — Shared search/index backend for all services
- **Redis, RabbitMQ, MinIO, NFS** — Shared infrastructure layer

### Kubernetes Infrastructure
- Lima VM definition (VZ framework, Rosetta 2, 10GB RAM, 4 CPUs, 120GB disk)
- k3s with custom kubelet tuning (eviction thresholds, system-reserved)
- 5 isolated namespaces: shared, wazuh, thehive, opencti, monitoring
- Traefik ingress with TLS 1.2+ (ECDHE cipher suites) and BasicAuth middleware
- Path-based routing under `soc.homelab.local`

### Security & Compliance
- Kubernetes-native secret management via `secretKeyRef` (template: `secrets.yaml.example`)
- **NetworkPolicies** — 23 rules across 5 namespaces (default-deny + explicit allow). ISO 27001 A.8.3/A.8.20, NIST AC-4/SC-7
- **TLS 1.2+ enforcement** — TLSOption with ECDHE cipher suites on Traefik ingress. NIST SC-13
- **Self-signed cert issuer** — cert-manager ClusterIssuer + Certificate resource for automated TLS cert management
- OpenSearch security plugin with internal user authentication
- Redis authentication via Kubernetes Secrets
- NFS `root_squash` enforced for storage security
- Cortex RBAC scoped to minimal permissions (create/manage Jobs only)
- Wazuh Manager: `automountServiceAccountToken: false`, `allowPrivilegeEscalation: false`
- All container images pinned to specific version tags (no `:latest`)
- Audited against ISO 27001:2022, NIST 800-53 Rev 5, and OWASP Top 10 for LLM Applications 2025

### MCP Servers (Claude Code Integration)
- `@matchbox/wazuh-mcp` — 7 tools: alerts, agents, vulnerabilities, rules, decoders
- `@matchbox/thehive-mcp` — 8 tools: cases, observables, analyzers, alerts
- `@matchbox/opencti-mcp` — 6 tools: indicators, reports, attack patterns, enrichment
- 10-second request timeouts, 50KB response truncation on all 21 tools
- `[WRITE]` prefix on 5 mutation tool descriptions for human-in-the-loop safety
- `safeId` regex input validation on all ID parameters
- Built on `@modelcontextprotocol/sdk` ^1.9.0

### Automation
- `setup-lima.sh` — Bootstrap Lima VM + k3s + Helm repos
- `deploy-stack.sh` — Deploy full stack or individual components
- `teardown.sh` — Clean teardown with cluster validation
- `test-flow.sh` — End-to-end validation

### Dashboard
- Self-contained HTML dashboard (`public/index.html`)
- 4 tabs: Overview, Architecture, Components, MCP Servers
- Custom SVG icon system — zero external dependencies
- Dark theme, fully offline-capable

### Documentation
- Architecture design with reasoning for each technology choice
- Network diagrams and port reference
- Resource requirements and phased startup strategy
- MCP server design docs with tool tables and usage examples
- Operational runbooks: initial setup, adding agents, incident response

## [1.1.0] — 2026-02-26

Security hardening and compliance documentation.

### Added
- cert-manager ClusterIssuer for automated self-signed certificate generation
- NetworkPolicies with default-deny ingress across all 5 namespaces
- TLS 1.2+ enforcement on Traefik with ECDHE cipher suites
- Compliance documentation: ISO 27001, NIST 800-53, OWASP Top 10 for LLMs
- Security contexts on all containers (`allowPrivilegeEscalation: false`, read-only root filesystem where possible)
- MCP server hardening: request timeouts (10s), response truncation (50KB), `[WRITE]` annotations

### Changed
- Bumped `@modelcontextprotocol/sdk` to ^1.9.0 across all MCP servers
- Redis, RabbitMQ, MinIO credentials moved from env vars to K8s Secrets

## [1.0.0] — 2026-02-26

Initial release — home Security Operations Center with MCP integration and interactive dashboard.

### Added
- Full SOC stack: Wazuh, OpenCTI, TheHive, Cortex, Grafana on k3s
- Lima VM definition for Apple Silicon Macs
- 3 custom MCP servers for Claude Code integration (21 total tools)
- Interactive HTML dashboard with 4 tabs
- Deployment, teardown, and test automation scripts
- Complete documentation with architecture docs, network diagrams, and runbooks

[1.4.0]: https://github.com/ajokunu/MatchBox/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/ajokunu/MatchBox/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/ajokunu/MatchBox/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/ajokunu/MatchBox/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/ajokunu/MatchBox/releases/tag/v1.0.0
