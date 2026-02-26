# Changelog

All notable changes to the DonnieBot Security Center are documented here.

## [Unreleased]

### 2026-02-26 — Phase 2: Hardening, Version Updates & Dashboard Integration

#### Security Hardening (43 issues fixed)
- Created `k8s/shared/secrets.yaml` — centralized K8s Secrets template for all credentials
- Removed all hardcoded passwords from: opensearch.yaml, rabbitmq.yaml, minio.yaml, redis.yaml, opencti/helm-values.yaml, thehive/helm-values.yaml, kube-prometheus-values.yaml
- Enabled OpenSearch security (was disabled), added internal user auth via Secret
- Enabled Redis authentication with Secret reference
- Configured TLS on all Traefik IngressRoutes with self-signed cert (soc-tls-cert)
- Added TLSStore default cert resource to traefik-routes.yaml
- Fixed NFS server: `no_root_squash` -> `root_squash`
- Added PVC create/patch/delete verbs to Cortex RBAC
- Hardened w2thive.py with try/except error handling, logging, timeout/connection error handling
- Fixed decoder regex bug: `(\.+)` -> `(.+)` in containerd and k3s decoders
- Increased resource limits: agent 256Mi->384Mi, Cortex jobs 256Mi->512Mi

#### Version Updates
- Wazuh agent: 4.9.2 -> 4.14.3
- OpenCTI connectors: `:latest` -> `6.9.5` (all 4 connectors pinned)
- NFS server: `:latest` -> `2.2.1`

#### MCP Server Hardening
- Added 10-second AbortController request timeouts to all 3 servers
- Added startup connectivity tests with stderr warnings
- Improved error handling with graceful process.exit(1) on fatal errors

#### Script Hardening
- deploy-stack.sh: Added kubectl/helm prerequisite check, cluster connectivity validation
- teardown.sh: Added cluster connectivity check before operations
- setup-lima.sh: Added Homebrew PATH detection for Apple Silicon

#### Dashboard Integration
- Added "SOC" tab to DonnieBot Security Center dashboard (ServiceMonitor/public/index.html)
- SOC tab includes: architecture diagram, component cards, resource budget, MCP tool table, port reference, quick start
- Added "Blog" tab with Medium-style article about the home SOC project
- Matching DonnieBot dark theme: custom styles for namespace badges, resource bars, code blocks, blog typography

### 2026-02-26 — Phase 1: Project Scaffolding & Documentation
- Created project directory structure under `/Users/donniebot/DonnieBot/SecurityCenter/`
- Added CLAUDE.md with project conventions, architecture overview, and common commands
- Added CHANGELOG.md (this file) for tracking all changes
- Added README.md with project overview and quick-start guide
- Added docs/architecture.md with full architecture design and reasoning
- Added docs/network-diagram.md with Mermaid data flow diagrams
- Added docs/resource-requirements.md with slim config RAM/CPU budgets
- Added docs/integrations.md with component connection details
- Added docs/mcp-servers.md with MCP server design documentation
- Added Lima VM definition (lima/k3s-soc.yaml)
- Added Kubernetes namespace manifest (k8s/namespaces.yaml)
- Added shared infrastructure manifests (OpenSearch, Redis, RabbitMQ, MinIO)
- Added Wazuh Helm values and ConfigMaps (ossec.conf, rules, decoders)
- Added TheHive/Cortex Helm values, RBAC, and analyzer configs
- Added OpenCTI Helm values and connector configurations
- Added monitoring Helm values (kube-prometheus-stack)
- Added Traefik IngressRoute configuration
- Added MCP server scaffolds (wazuh-mcp, thehive-mcp, opencti-mcp)
- Added automation scripts (setup-lima, deploy-stack, teardown, test-flow)
- Added operational runbooks (initial-setup, adding-agents, incident-response)
- Initialized git repository
