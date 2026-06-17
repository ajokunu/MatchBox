# Versions & Facts — Single Source of Truth

This table is the **authoritative source** for component versions, service ports, and
key counts in MatchBox. Other docs (README, CLAUDE.md, runbooks, diagrams) should defer
to this file rather than hard-coding numbers that drift. When you change a version, port,
or count, update it **here first**, then reconcile references.

> Verify, don't trust: every value below was checked against the actual manifests
> (`k8s/**`, `lima/k3s-soc.yaml`) and source, not copied from prose.

## Component Versions

| Component | Version | Pinned in |
|-----------|---------|-----------|
| Wazuh (Manager / Dashboard / Agent) | **4.14.3** | `k8s/wazuh/manager/deployment.yaml`, `k8s/wazuh/dashboard/deployment.yaml`, `k8s/wazuh/agents/daemonset.yaml` |
| OpenSearch | **2.19.1** | `k8s/shared/opensearch.yaml` (`image.tag`) |
| OpenCTI (platform / worker / connectors) | **6.9.5** | `k8s/opencti/helm-values.yaml` + `k8s/opencti/connectors/*.yaml` |
| TheHive | **5.4** | `k8s/thehive/helm-values.yaml` |
| Cortex | **3.1.8** | `k8s/thehive/helm-values.yaml` |
| Prometheus + Grafana | kube-prometheus-stack chart (pinned `--version` in `scripts/deploy-stack.sh`) | `k8s/monitoring/kube-prometheus-values.yaml` |
| k3s | bundled with the Lima image | `lima/k3s-soc.yaml` |
| `@modelcontextprotocol/sdk` (MCP servers) | **^1.9.0** | `mcp-servers/*/package.json` |

> **External Wazuh agents must match the manager minor (4.14.3).** Do not install an older
> agent (e.g. 4.9.x) — see `docs/runbooks/adding-agents.md`. Wazuh tolerates older agents
> against a newer manager, but matching versions avoids feature/format drift.

## Service Ports

| Service | Port | Exposure | Ingress Path |
|---------|------|----------|--------------|
| Traefik Ingress | 443 (HTTPS) / 80 (HTTP→redirect) | External | `soc.homelab.local/*` |
| Wazuh Dashboard | **5601** (HTTPS) | Internal → Traefik | `/wazuh` |
| Wazuh Manager — agent ingestion | 1514 (TCP) | Internal / NodePort | — |
| Wazuh Manager — agent registration | 1515 (TCP) | Internal / NodePort | — |
| Wazuh Manager — Server API | 55000 (HTTPS) | Internal | — |
| Wazuh Indexer (alerts/vuln `_search`) | 9200 (HTTPS, OpenSearch) | Internal | — |
| TheHive | 9000 (TCP) | Internal → Traefik | `/thehive` |
| Cortex | 9001 (TCP) | Internal → Traefik | `/cortex` |
| OpenCTI | 4000 (TCP) | Internal → Traefik | `/opencti` |
| Grafana | 3000 (TCP) | Internal → Traefik | `/grafana` |
| OpenSearch | 9200 (REST) / 9300 (transport) | Internal only | — |
| Redis | 6379 (TCP) | Internal only | — |
| RabbitMQ | 5672 (AMQP) / 15672 (mgmt) / 15692 (metrics) | Internal only | — |
| MinIO | 9000 (S3 API) | Internal only | — |
| NFS Server | 2049 (TCP/UDP) | Internal only | — |
| Prometheus | 9090 (TCP) | Internal only | — |
| Alertmanager | 9093 (TCP) | Internal only | — |
| k3s API Server | 6443 (HTTPS) | Host only | — |

> Note: TheHive and MinIO both use port **9000** but live in different namespaces
> (`thehive` vs `shared`), so there is no collision.

## Counts

| Count | Value | Breakdown | Source |
|-------|-------|-----------|--------|
| NetworkPolicies | **32** | 5 default-deny-ingress + 5 default-deny-egress + 22 explicit allow (17 ingress-allow + 5 egress-allow), one deny pair per namespace × 5 namespaces | `k8s/network-policies.yaml` |
| Namespaces | 5 | `shared`, `wazuh`, `thehive`, `opencti`, `monitoring` | `k8s/namespaces.yaml` |
| MCP servers | 3 | `wazuh-mcp`, `thehive-mcp`, `opencti-mcp` (+ `@matchbox/mcp-shared` lib) | `mcp-servers/` |
| MCP tools (wazuh-mcp) | 7 | list-alerts, get-alert, search-agents, get-agent-info, get-vulnerabilities, get-rules, get-decoders | `mcp-servers/wazuh-mcp/src/index.ts` |
| OpenCTI connectors | 4 | MITRE ATT&CK, AlienVault OTX, AbuseIPDB, VirusTotal | `k8s/opencti/connectors/` |

## Hardware / VM Sizing

| Item | Value | Source |
|------|-------|--------|
| Host RAM | 16 GB (Mac Mini M4) | — |
| Lima VM RAM | 10 GiB | `lima/k3s-soc.yaml` |
| Lima VM CPUs | 4 | `lima/k3s-soc.yaml` |
| Lima VM disk | 120 GiB | `lima/k3s-soc.yaml` |
| Free host disk required | 120 GB+ | `README.md`, `docs/runbooks/initial-setup.md` |
| Swap (in VM) | 4 GB | `lima/k3s-soc.yaml` |

## RAM Budget by Operating Mode

Authoritative figures live in `docs/resource-requirements.md`; summarized here so other docs
can reference a single source. These are *measured/expected usage*, not limits.

| Mode | RAM Used | What's running |
|------|----------|----------------|
| Steady state (always-on) | **~3.2 GB** | k3s, OpenSearch, Wazuh (Manager/Dashboard/Agent), Traefik |
| Investigation mode | **~5.8 GB** | + TheHive, Cortex, OpenCTI platform/worker |
| Full load | **~7.2 GB** | + Prometheus, Grafana, active connectors/analyzers |

Total resource *limits* sum to ~9.5 GB against the 10 GiB VM (≈0.5 GB headroom + 4 GB swap).
No mode should be documented as exceeding the 10 GiB VM allocation.

## PKI / Certificates

cert-manager is **not** used (keeps PKI RAM at 0). TLS materials are generated by
`scripts/generate-certs.sh` (openssl) and applied as Kubernetes Secrets:

| Secret / ConfigMap | Namespace(s) | Purpose |
|--------------------|--------------|---------|
| `opensearch-certs` | `shared`, `wazuh` | OpenSearch node + admin PEMs (PKCS#8 keys) |
| `wazuh-dashboard-certs` | `wazuh` | Wazuh Dashboard server cert |
| `opensearch-ca-cert` (ConfigMap) | `wazuh`, `opencti` | Root CA (`ca.crt`) for upstream TLS trust |
| `soc-tls-cert` | `kube-system` | Ingress TLS for `soc.homelab.local` |
| `soc-auth-secret` | `kube-system` | Traefik basic-auth htpasswd |

See `docs/runbooks/initial-setup.md` for the generate-certs → SOPS → deploy order.
