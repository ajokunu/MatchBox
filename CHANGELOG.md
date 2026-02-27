# Changelog

All notable changes to MatchBox are documented here.

## [1.1.0] — 2026-02-26

### Compliance Hardening & Dashboard Update

#### Security Hardening
- **NetworkPolicies** — 23 rules across 5 namespaces (default-deny + explicit allow). ISO 27001 A.8.3/A.8.20, NIST AC-4/SC-7
- **TLS 1.2+ enforcement** — TLSOption with ECDHE cipher suites on Traefik ingress. NIST SC-13
- **Self-signed cert issuer** — cert-manager ClusterIssuer + Certificate resource for automated TLS cert management
- **MCP response truncation** — 50KB `formatResponse()` limit on all 21 MCP tools. OWASP LLM04/LLM05
- **Write operation annotations** — `[WRITE]` prefix on 5 mutation tool descriptions for human-in-the-loop safety. OWASP LLM08
- **GraphQL error truncation** — 500-char limit on OpenCTI error messages. OWASP LLM06
- **Wazuh Manager security context** — `automountServiceAccountToken: false`, `allowPrivilegeEscalation: false`
- **Input validation** — `safeId` regex on all ID parameters to prevent path traversal

#### Version Updates
- Wazuh Manager: 4.11.1 → 4.14.3 (matches Agent version)
- MCP SDK: `@modelcontextprotocol/sdk` ^1.0.0 → ^1.9.0 (all 3 servers)

#### Dashboard
- Added **Blog tab** (#5) — Medium-style article about building the home SOC
- Updated version badge to v1.1.0

#### Compliance Audits Completed
- ISO 27001:2022 Annex A — 12 PASS, 17 PARTIAL, 2 FAIL
- NIST 800-53 Rev 5 — 16 PASS, 17 PARTIAL, 4 FAIL
- OWASP Top 10 for LLM Applications 2025 — 35 findings addressed

---

## [1.0.0] — 2026-02-26

### Initial Release

A production-grade home Security Operations Center running on a single Mac Mini M4 (16GB RAM) with k3s Kubernetes via Lima VM.

#### Core Stack
- **Wazuh 4.14.3** — SIEM/XDR with Manager, Dashboard, and Agent DaemonSet
- **OpenCTI 6.9.5** — Threat intelligence platform with MITRE ATT&CK, AlienVault OTX, AbuseIPDB, VirusTotal connectors
- **TheHive 5.4 + Cortex 3.1.8** — Incident response with automated analyzers (K8s Jobs)
- **Prometheus + Grafana** — Full observability with custom Wazuh dashboards
- **OpenSearch** — Shared search/index backend for all services
- **Redis, RabbitMQ, MinIO, NFS** — Shared infrastructure layer

#### Kubernetes Infrastructure
- Lima VM definition (VZ framework, Rosetta 2, 10GB RAM, 4 CPUs, 120GB disk)
- k3s with custom kubelet tuning (eviction thresholds, system-reserved)
- 5 isolated namespaces: shared, wazuh, thehive, opencti, monitoring
- Traefik ingress with TLS (self-signed cert) and BasicAuth middleware
- Path-based routing under `soc.homelab.local`

#### Architecture & Security
- Kubernetes-native secret management via `secretKeyRef` (template: `secrets.yaml.example`)
- OpenSearch security plugin with internal user authentication
- Redis authentication via Kubernetes Secrets
- TLS on all Traefik IngressRoutes with self-signed certificates
- NFS `root_squash` enforced for storage security
- Cortex RBAC scoped to minimal permissions (create/manage Jobs only)
- All container images pinned to specific version tags for reproducible deployments

#### MCP Servers (Claude Code Integration)
- `@matchbox/wazuh-mcp` — 7 tools: alerts, agents, vulnerabilities, rules, decoders
- `@matchbox/thehive-mcp` — 8 tools: cases, observables, analyzers, alerts
- `@matchbox/opencti-mcp` — 6 tools: indicators, reports, attack patterns, enrichment
- 10-second request timeouts on all servers
- Startup connectivity checks with stderr warnings
- Built on `@modelcontextprotocol/sdk`

#### Automation
- `setup-lima.sh` — Bootstrap Lima VM + k3s + Helm repos
- `deploy-stack.sh` — Deploy full stack or individual components
- `teardown.sh` — Clean teardown with cluster validation
- `test-flow.sh` — End-to-end validation (7 test sections, 20+ checks)

#### Dashboard
- Self-contained HTML dashboard (`public/index.html`)
- 4 tabs: Overview, Architecture, Components, MCP Servers
- Custom SVG icon system — zero external dependencies
- Dark theme, fully offline-capable

#### Documentation
- Architecture design with reasoning for each technology choice
- Network diagrams and port reference
- Resource requirements and phased startup strategy
- MCP server design docs with tool tables and usage examples
- Operational runbooks: initial setup, adding agents, incident response
