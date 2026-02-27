# Changelog

All notable changes to MatchBox are documented here.

## [1.2.0] — 2026-02-27

A production-grade home Security Operations Center running on a single Mac Mini M4 (16GB RAM) with k3s Kubernetes via Lima VM.

### Core Stack
- **Wazuh 4.14.3** — SIEM/XDR with Manager, Dashboard, and Agent DaemonSet
- **OpenCTI 6.9.5** — Threat intelligence platform with MITRE ATT&CK, AlienVault OTX, AbuseIPDB, VirusTotal connectors
- **TheHive 5.4 + Cortex 3.1.8** — Incident response with automated analyzers (K8s Jobs)
- **Prometheus + Grafana** — Full observability with custom Wazuh dashboards
- **OpenSearch** — Shared search/index backend for all services
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
- 10-second request timeouts on all servers
- 50KB `formatResponse()` response truncation on all 21 tools
- `[WRITE]` prefix on 5 mutation tool descriptions for human-in-the-loop safety
- `safeId` regex input validation on all ID parameters
- GraphQL error truncation (500 chars) on OpenCTI errors
- Startup connectivity checks with stderr warnings
- Built on `@modelcontextprotocol/sdk` ^1.9.0

### Automation
- `setup-lima.sh` — Bootstrap Lima VM + k3s + Helm repos
- `deploy-stack.sh` — Deploy full stack or individual components
- `teardown.sh` — Clean teardown with cluster validation
- `test-flow.sh` — End-to-end validation (7 test sections, 20+ checks)

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
