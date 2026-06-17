# Changelog

All notable changes to MatchBox are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioned with [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.6.0] — 2026-06-17

A full-codebase hardening pass across 7 parallel lanes (mcp, dashboard, k8s-wazuh, k8s-rest-sec, scripts, docs, ci-dx) closing ~200 audit findings (see `docs/AUDIT-2026-findings.json`). Per `docs/IMPLEMENTATION-CONTRACT.md`, this moves the SOC from "demo-grade with TLS disabled and broken MCP endpoints" to "fail-closed, CA-verified, CI-gated, SOPS-managed". The Wazuh MCP now queries the real OpenSearch indexer, every TLS-verification kill switch is gone, secrets move to SOPS+age, and an npm-workspaces monorepo + GitHub Actions CI build and validate the whole tree.

### Added
- **npm workspaces monorepo**: new root `package.json` (`@matchbox/soc`, private, type:module, node>=20) ordering `mcp-servers/shared` first so `@matchbox/mcp-shared` builds before its consumers and the dashboard. Root `build`/`test`/`lint`/`typecheck` fan out via `--workspaces --if-present`. A root `overrides` pins a single Vite 6 across the tree (vitest 3) so `svelte-check` is not broken by duplicate Vite plugin identities.
- **GitHub Actions CI** (`.github/workflows/ci.yml`): shellcheck over `scripts/`, kubeconform over raw `k8s/**`, `helm template | kubeconform` for the wired charts, gitleaks, a Node 20/22 matrix (`npm ci` + shared-first build + typecheck + test), and dashboard `svelte-check`. Actions pinned to commit SHAs; least-privilege `contents:read`.
- **DX tooling**: `Makefile` (up/down/build/certs/secrets-init/deploy/teardown/test/lint/ci), `.nvmrc` (Node 20), shared `biome.json`, `.editorconfig`.
- **SOC PKI script** `scripts/generate-certs.sh`: openssl-generates root-ca + esnode/kirk(admin)/wazuh-dashboard certs (PKCS#8 keys, canonical SANs/DNs `O=MatchBox C=US`), idempotent, and loads `opensearch-certs` (ns shared+wazuh), `wazuh-dashboard-certs` (ns wazuh), and the `opensearch-ca-cert` ConfigMap (ns wazuh+opencti+thehive+monitoring) — single source for the CA across every consuming namespace.
- **SOPS+age secret management**: `scripts/setup-sops.sh` (age key kept OUTSIDE the repo, public recipient only), root `.sops.yaml` (`encrypted_regex '^(data|stringData)$'`), and a committable structural placeholder `k8s/shared/secrets.enc.yaml`; deploy decrypts at apply time.
- **Shared MCP lib hardening** (`mcp-servers/shared`): deadline-aware idempotency-respecting `fetchWithRetry`, `formatResponse` that truncates records into a valid-JSON `{truncated,shown,total,data}` envelope before serialization, canonical `safeId`/`ID_PATTERN`, structured JSON logging, `[WRITE]` audit logging, generic tool-facing errors via `toolGuard`, `indexerSearch` (OpenSearch `_search`), and version from `package.json`.
- **Wazuh MCP indexer path** (Contract §3): new `WAZUH_INDEXER_URL`/`WAZUH_INDEXER_USER`/`WAZUH_INDEXER_PASSWORD` env (fail-closed without the password).
- **k8s reliability/observability**: stable `wazuh-manager-api` ClusterIP Service (:55000); `k8s/monitoring/soc-prometheus-rules.yaml` (PodOOMKilled, PodCrashLooping, NodeDiskPressure, WazuhManagerDown, OpenSearchClusterNotGreen, ConnectorCronJobFailed); Alertmanager webhook receiver.
- **Pod Security Standards** labels per namespace (restricted for opencti/thehive/monitoring, baseline for shared, privileged for wazuh).
- **Vitest contract tests** pinning Wazuh/OpenCTI/TheHive request shapes and shared-lib behavior; dashboard Vitest suites for auth enforcement, upstream error redaction, and StatusDot a11y.
- **Docs**: `docs/VERSIONS.md` single source of truth (versions, ports, counts); cert-generation + SOPS steps in the initial-setup runbook.

### Changed
- **Wazuh MCP**: `list-alerts`/`get-alert`/`get-vulnerabilities` now POST `_search` to the Wazuh indexer (`wazuh-alerts-*` / `wazuh-states-vulnerabilities-*`) instead of non-existent Server API endpoints; agents/rules/decoders stay on the Server API; JWT expiry read from the `exp` claim with 401 re-auth.
- **OpenCTI MCP**: `get-attack-patterns` applies a real `killChainPhases.phase_name` FilterGroup (tactic filter previously ignored); `search-indicators`/`get-indicator` renamed to `search-observables`/`get-observable` (BREAKING tool rename); enrich mutation no longer auto-retried.
- **TheHive MCP**: `merge-alerts` uses the TheHive 5 bulk endpoint `POST /api/v1/alert/merge/_bulk` and promotes the first alert to a case when none is given; fixed an ingress sub-path bug that dropped `/thehive` from every request via a `joinUrl()` helper.
- **OpenCTI/TheHive/Cortex/Grafana → OpenSearch** now connect over `https://` with certificate verification against the mounted SOC CA and credentials from `soc-shared-secrets`; all plaintext-http and verify-disabled paths removed. OpenCTI platform/worker pinned to 6.9.5 (matches connectors); all Helm chart `--version`s pinned.
- **Wazuh manager** `/var/ossec/etc` now persists on a PVC (seed-only-when-empty init) so `client.keys` survive restarts; probes switched from `tcpSocket:1514` to `exec wazuh-control status` + startupProbe; Filebeat CA path corrected to `/etc/ssl/opensearch/root-ca.pem`.
- **Config de-hardcoding**: every dashboard `localhost:300x/4000/5601/9000/9001` moved to `PUBLIC_*` env; service URLs derived from config.
- **deploy-stack.sh** now actually deploys the Wazuh Manager StatefulSet + Dashboard + ConfigMap, decrypts/applies SOPS secrets before shared infra, generates certs first, creates `soc-tls-cert`/`soc-auth-secret` for ingress, pins `--version` on all Helm installs, and treats OpenSearch-readiness failure and any unhealthy pod as fatal.
- **Lima** kubeconfig hardened to mode 600 (was 644); `INSTALL_K3S_VERSION` and a checksum-verified Helm release pinned; port-forwards pinned to `hostIP 127.0.0.1`; duplicated provisioning extracted to shared `lima/provision-k3s.sh`.
- **Docs reconciled**: Wazuh Dashboard 443→5601, Wazuh agent 4.9.2→4.14.3, NetworkPolicy count → 32, RAM/disk figures aligned, compliance "audited against"→"designed with reference to".

### Fixed
- Dashboard health probe (`redirect:'manual'` + status classification, probes Wazuh Server API not the UI root); TheHive count array-vs-number unwrap; OpenCTI/Cortex/Grafana partial-shape guards; polling pauses on tab-hidden and backs off on failure.
- `w2thive.py` TypeError on JSON-null `full_log`/`groups`/`mitre.id`; corrected its "deployed" docstring (integration is NOT wired).
- Wazuh agent hostNetwork DNS via `dnsPolicy: ClusterFirstWithHostNet`; NFS/teardown/setup-ism `2>/dev/null||true` redirect placement bugs.

### Security
- **Removed every TLS-verification kill switch**: `NODE_TLS_REJECT_UNAUTHORIZED=0` (dashboard `vite.config.ts`/`.env`/`.env.example`), OpenSearch `verificationMode: none` (Wazuh dashboard), Grafana `tlsSkipVerify: true`, `TH_DB_ES_SSL_VERIFY=false`. The self-signed SOC CA is now trusted by scope only (`NODE_EXTRA_CA_CERTS` / pinned undici dispatcher / mounted `opensearch-ca-cert`).
- **Dashboard auth boundary** (`src/hooks.server.ts`): `SOC_API_TOKEN` bearer (constant-time compare) + same-origin/CSRF guard on all `/api/*`, fail-closed in production; proxy routes return generic errors and no longer leak upstream host/port/TLS detail.
- **Fail-closed credentials**: removed `optional:true` from all 4 Wazuh manager/dashboard credential `secretKeyRef`s; Wazuh MCP fails closed without `WAZUH_INDEXER_PASSWORD`.
- **De-privileged workloads**: Wazuh agent DaemonSet (dropped `privileged:true`, host mounts narrowed from `/` to exact FIM dirs read-only), manager/dashboard (seccomp RuntimeDefault + drop ALL), NFS server (scoped caps).
- **NetworkPolicy hardening**: hostNetwork agents→manager on 1514/1515 via node ipBlock, dashboard ingress scoped to Traefik, internet-only HTTPS egress (no wildcard `to:[]`). 32 NetworkPolicy objects on disk.
- **`.claude/settings.json`** references secrets via `${ENV}` instead of inlining live creds; `.gitignore` excludes `*.agekey`/`keys.txt`; `secrets.yaml` stays local while `secrets.enc.yaml` is the committable SOPS bundle.
- **Supply-chain**: MITRE connector pinned to an ATT&CK release tag (was mutable master); connector image tags tied to the platform tag.

### Removed
- Dead raw manifests superseded by Helm: `k8s/thehive/deployment.yaml`, `k8s/thehive/cortex/deployment.yaml`, `k8s/opencti/deployment.yaml`, `k8s/shared/rabbitmq-deployment.yaml`.
- Placeholder CA ConfigMap manifests (`k8s/shared|thehive|monitoring/opensearch-ca-cert.yaml`) — `generate-certs.sh` is now the single source. Empty `k8s/wazuh/indexer/` dir.
- Three stale per-package `package-lock.json` files (single root workspace lockfile now); dead secret keys `soc-wazuh-secrets/indexer-password` and `soc-thehive-secrets/api-key`; the non-existent `run-sca-scan` MCP tool from docs.

### Verified
- `npm run build`, `npm run typecheck`, `npm run test` (all workspaces) — PASS. `svelte-check` — 0 errors / 0 warnings. `shellcheck` (warning level) — clean. `kubeconform -strict` over raw `k8s/**` — 64 valid, 0 invalid, 0 errors (11 CRD schema-skips).
- Integration fixes applied on top of the fleet output: extended `generate-certs.sh` to load the CA ConfigMap into thehive+monitoring; deduped Vite to a single v6 (vitest 3 + root override) to clear `svelte-check`; reconciled NetworkPolicy count to 32 in `VERSIONS.md`/`CLAUDE.md`; corrected `docs/integrations.md` off the removed `soc-thehive-secrets/api-key`; `.nvmrc` set to the installed Node 20.
- **Known (pre-existing): `gitleaks` reports 14 secrets in git _history_** (the `secrets.yaml` committed in the v1.0.0 / initial commits). `secrets.yaml` is now gitignored and untracked, but history still contains the values — rotate the affected credentials and scrub history (e.g. `git filter-repo`) as an operator step.

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
- **NetworkPolicies** — 31 policies across 5 namespaces: 5 default-deny-ingress + 5 default-deny-egress + 21 explicit allow (see `docs/VERSIONS.md`). ISO 27001 A.8.3/A.8.20, NIST AC-4/SC-7
- **TLS 1.2+ enforcement** — TLSOption with ECDHE cipher suites on Traefik ingress. NIST SC-13
- **Self-signed cert issuer** — cert-manager ClusterIssuer + Certificate resource for automated TLS cert management
- OpenSearch security plugin with internal user authentication
- Redis authentication via Kubernetes Secrets
- NFS `root_squash` enforced for storage security
- Cortex RBAC scoped to minimal permissions (create/manage Jobs only)
- Wazuh Manager: `automountServiceAccountToken: false`, `allowPrivilegeEscalation: false`
- All container images pinned to specific version tags (no `:latest`)
- Designed with reference to ISO 27001:2022, NIST 800-53 Rev 5, and OWASP Top 10 for LLM Applications 2025 (control citations are inline; no formal third-party audit was performed)

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
