# MatchBox

## Project Overview
Home SOC (Security Operations Center) running on lightweight Kubernetes (k3s) via Lima VM on Mac Mini M4 (16GB RAM). Integrates Wazuh (SIEM/XDR), OpenCTI (Threat Intelligence), TheHive+Cortex (Incident Response), and Grafana (Monitoring).

## Architecture
- **Runtime:** k3s inside Lima VM (VZ framework, 10GB RAM, 4 CPUs)
- **SIEM/XDR:** Wazuh 4.14.3 (Manager, Indexer/OpenSearch, Dashboard, Agent DaemonSets)
- **Threat Intel:** OpenCTI with MITRE ATT&CK, AlienVault OTX, AbuseIPDB, VirusTotal connectors
- **Incident Response:** TheHive + Cortex with automated analyzers/responders
- **Monitoring:** Prometheus + Grafana with Wazuh community dashboards
- **Ingress:** Traefik reverse proxy at soc.homelab.local
- **Storage:** Shared OpenSearch, Redis, RabbitMQ, MinIO, NFS

## Hardware Constraint
Mac Mini M4 with 16GB RAM. Slim configuration with phased startup (RAM figures are
authoritative in `docs/VERSIONS.md` / `docs/resource-requirements.md`):
- Always on: k3s, OpenSearch, Wazuh, Traefik (~3.2GB steady state)
- On-demand: TheHive, Cortex, OpenCTI (scale up during investigation, ~5.8GB)
- Full load: + Prometheus/Grafana + active connectors (~7.2GB; under the 10GiB VM)
- Scheduled: Threat intel connectors as CronJobs (nightly/weekly)

## Security
- All credentials in K8s Secrets, encrypted at rest with SOPS+age (`k8s/shared/secrets.enc.yaml`); plaintext `secrets.yaml` is gitignored. Never hardcoded.
- OpenSearch security enabled with internal user auth
- TLS 1.2+ on Traefik IngressRoutes with ECDHE cipher suites (self-signed cert: `soc-tls-cert`)
- TLS PKI via `scripts/generate-certs.sh` (openssl, 0 RAM) — cert-manager is NOT used (documented optional upgrade only)
- NetworkPolicies: 34 total = 5 default-deny-ingress + 5 default-deny-egress + 24 explicit allow, across 5 namespaces (see `docs/VERSIONS.md`)
- Redis auth enabled, NFS root_squash, Cortex RBAC with PVC verbs
- All container images pinned (no `:latest` tags)
- MCP servers: 10s request timeouts, 50KB response truncation, `[WRITE]` annotations on mutations
- Designed with reference to ISO 27001, NIST 800-53, and OWASP Top 10 for LLMs (control citations are inline; no formal third-party audit has been performed)

## Dashboard
The MatchBox SOC Command Center is a SvelteKit app in `dashboard/`, served on port 5173
(`vite dev --port 5173`):
- **Pages**: an overview plus 5 per-service deep-dives (`wazuh`, `grafana`, `opencti`,
  `thehive`, `cortex`) under `dashboard/src/routes/`
- **Data**: server routes under `dashboard/src/routes/api/*` proxy each service's API
  (config via SvelteKit `$env/dynamic/private`, i.e. `dashboard/.env`)
- **Theme**: Solarized light/dark toggle (`dashboard/src/app.css`), synced with embedded Grafana
- Run: `cp dashboard/.env.example dashboard/.env && cd dashboard && npm install && npm run dev`

## Directory Structure
```
SecurityCenter/
  CLAUDE.md              # This file
  CHANGELOG.md           # All changes tracked
  README.md              # Quick-start guide
  docs/                  # Architecture, diagrams, runbooks
  lima/                  # Lima VM definition for k3s
  k8s/                   # All Kubernetes manifests and Helm values
    shared/              # OpenSearch, Redis, RabbitMQ, MinIO
    wazuh/               # Wazuh Manager, Indexer, Dashboard, Agents
    thehive/             # TheHive, Cortex, integration scripts
    opencti/             # OpenCTI platform + connectors
    monitoring/          # Prometheus, Grafana, dashboards
    ingress/             # Traefik IngressRoutes
    storage/             # NFS, PVCs
  mcp-servers/           # Custom MCP servers for Claude Code integration
    wazuh-mcp/           # Wazuh API MCP server
    thehive-mcp/         # TheHive API MCP server
    opencti-mcp/         # OpenCTI API MCP server
  scripts/               # Automation (setup, deploy, teardown, test)
```

## Common Commands
Common workflows are wrapped by the root `Makefile` (run `make help` for the full list);
the underlying scripts can still be called directly.

```bash
# Start Lima VM + k3s
limactl start ./lima/k3s-soc.yaml
export KUBECONFIG=$(limactl list k3s-soc --format '{{.Dir}}/copied-from-guest/kubeconfig.yaml')

# Secrets: init age key + encrypt (one-time), then deploy decrypts at apply time
make secrets-init        # wraps scripts/setup-sops.sh
./scripts/generate-certs.sh   # TLS PEMs + K8s cert Secrets (run before deploy)

# Deploy full stack (decrypts secrets, applies in order)
make deploy              # or: ./scripts/deploy-stack.sh all

# Build / lint / test the TS workspaces (MCP servers + dashboard)
make build && make lint && make test

# Check cluster health
kubectl get pods --all-namespaces

# Tear down
make teardown            # or: ./scripts/teardown.sh

# Run end-to-end test
make e2e                 # or: ./scripts/test-flow.sh
```

## Namespaces
- `wazuh` — Wazuh Manager, Dashboard, Agents
- `thehive` — TheHive, Cortex, integration jobs
- `opencti` — OpenCTI platform, workers, connectors
- `monitoring` — Prometheus, Grafana, Alertmanager
- `shared` — OpenSearch, Redis, RabbitMQ, MinIO, NFS

## Conventions
- All Kubernetes manifests use YAML with inline comments explaining decisions
- Helm values files are in each component's k8s/ subdirectory
- Resource limits are mandatory on every pod (slim config)
- Changes are logged in CHANGELOG.md before committing
- Sensitive values (API keys, passwords) go in Kubernetes Secrets (SOPS+age encrypted in `secrets.enc.yaml`), never in manifests
- Use `.env.example` files to document required environment variables (repo-root for MCP servers, `dashboard/.env.example` for the dashboard)

## MCP Servers
Three custom MCP servers provide Claude Code integration:
- `wazuh-mcp` — Query agents/rules/decoders via the Wazuh Server API (55000) and alerts/vulnerabilities via the Wazuh Indexer (9200)
- `thehive-mcp` — Manage cases, observables, analyzers via TheHive API
- `opencti-mcp` — Search indicators, reports, attack patterns via OpenCTI GraphQL API

Register in project `.claude/settings.json` (not global).

## Key Ports
| Service | Internal Port | Ingress Path |
|---------|--------------|--------------|
| Wazuh Dashboard | 5601 | /wazuh |
| TheHive | 9000 | /thehive |
| Cortex | 9001 | /cortex |
| OpenCTI | 4000 | /opencti |
| Grafana | 3000 | /grafana |
| Wazuh Agent | 1514 | NodePort |
| OpenSearch | 9200 | Internal only |
| Redis | 6379 | Internal only |
| RabbitMQ | 5672 | Internal only |
| MinIO | 9000 | Internal only |
