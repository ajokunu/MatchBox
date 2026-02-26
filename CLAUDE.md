# DonnieBot Security Center

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
Mac Mini M4 with 16GB RAM. Slim configuration with phased startup:
- Always on: k3s, OpenSearch, Wazuh, Monitoring (~7.1GB steady state)
- On-demand: TheHive, Cortex, OpenCTI (scale up during investigation, ~10.5GB total)
- Scheduled: Threat intel connectors as CronJobs (nightly/weekly)

## Security
- All credentials in K8s Secrets (template: `k8s/shared/secrets.yaml`), never hardcoded
- OpenSearch security enabled with internal user auth
- TLS on Traefik IngressRoutes (self-signed cert: `soc-tls-cert`)
- Redis auth enabled, NFS root_squash, Cortex RBAC with PVC verbs
- All container images pinned (no `:latest` tags)
- MCP servers have 10s request timeouts and startup connectivity checks

## Dashboard Integration
SOC content is integrated into the DonnieBot Security Center dashboard at `http://localhost:3099`:
- **SOC tab**: Architecture, components, resource budget, MCP tools, ports
- **Blog tab**: Medium-style article about the project
- Source: `/Users/donniebot/DonnieBot/ServiceMonitor/public/index.html`

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
```bash
# Start Lima VM + k3s
limactl start ./lima/k3s-soc.yaml
export KUBECONFIG=$(limactl list k3s-soc --format '{{.Dir}}/copied-from-guest/kubeconfig.yaml')

# Deploy full stack
./scripts/deploy-stack.sh

# Check cluster health
kubectl get pods --all-namespaces

# Tear down
./scripts/teardown.sh

# Run end-to-end test
./scripts/test-flow.sh
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
- Sensitive values (API keys, passwords) go in Kubernetes Secrets, never in manifests
- Use `.env.example` files to document required environment variables

## MCP Servers
Three custom MCP servers provide Claude Code integration:
- `wazuh-mcp` — Query alerts, agents, vulnerabilities via Wazuh REST API
- `thehive-mcp` — Manage cases, observables, analyzers via TheHive API
- `opencti-mcp` — Search indicators, reports, attack patterns via OpenCTI GraphQL API

Register in project `.claude/settings.json` (not global).

## Key Ports
| Service | Internal Port | Ingress Path |
|---------|--------------|--------------|
| Wazuh Dashboard | 443 | /wazuh |
| TheHive | 9000 | /thehive |
| Cortex | 9001 | /cortex |
| OpenCTI | 4000 | /opencti |
| Grafana | 3000 | /grafana |
| Wazuh Agent | 1514 | NodePort |
| OpenSearch | 9200 | Internal only |
| Redis | 6379 | Internal only |
| RabbitMQ | 5672 | Internal only |
| MinIO | 9000 | Internal only |
