# MatchBox
<img width="1232" height="928" alt="MatchBox" src="https://github.com/user-attachments/assets/3f7f8695-7578-489a-bbea-2b009b827544" />

A professional-grade home SOC (Security Operations Center) running on lightweight Kubernetes, designed for the Mac Mini M4 (16GB RAM). SOPS-encrypted secrets, CA-verified TLS, default-deny networking, and a CI-gated TypeScript codebase — built to be deployed, not just admired.

![version](https://img.shields.io/badge/version-1.7.0-blue) ![ci](https://img.shields.io/badge/CI-build%20·%20typecheck%20·%20test%20·%20biome%20·%20kubeconform%20·%20shellcheck%20·%20gitleaks-green) ![secrets](https://img.shields.io/badge/secrets-SOPS%2Fage%20encrypted-success)

## What's Inside

| Component | Role | Why |
|-----------|------|-----|
| **Wazuh 4.14.3** | SIEM/XDR | Log collection, threat detection, file integrity monitoring, vulnerability scanning |
| **OpenCTI 6.9.5** | Threat Intelligence | MITRE ATT&CK mapping, IOC management, threat feed aggregation |
| **TheHive + Cortex** | Incident Response | Case management, automated analysis (VirusTotal, AbuseIPDB, etc.) |
| **Grafana** | Monitoring | SOC dashboards, cluster health, compliance visualization |
| **k3s** (in Lima) | Kubernetes | Lightweight orchestration for all components |
| **MCP Servers** | AI Integration | Claude Code can query alerts, cases, and threat intel directly |

> Component versions, ports, and counts are authoritative in **[`docs/VERSIONS.md`](docs/VERSIONS.md)** — other docs defer to it so numbers don't drift.

## Quick Start

The whole lifecycle is wrapped in a `Makefile` (`make help` lists everything).

### Prerequisites
- macOS with Apple Silicon (M1/M2/M3/M4), Homebrew, 16GB+ RAM, 60GB+ free disk
- `brew install lima kubectl helm sops age`

### Deploy (minimal Wazuh-only — the validated, RAM-light path)

```bash
make up            # start the Lima VM + k3s (minimal: 6GiB / 2 CPU)
make secrets-init  # generate an age key (outside the repo) + encrypt secrets.yaml -> secrets.enc.yaml
make certs         # openssl PKI: root CA + node/admin/dashboard certs (0 extra RAM, no cert-manager)
make deploy        # SOPS-decrypt secrets, install OpenSearch, deploy Wazuh manager + dashboard
```

Then reach the Wazuh dashboard (port 5601 is loopback-only, so port-forward it):

```bash
kubectl port-forward -n wazuh svc/wazuh-dashboard 5601:5601   # open https://localhost:5601
```

This footprint is **~3 GB** in the VM, leaving ~10 GB of the host's 16 GB free for other work.

### Full stack (TheHive + OpenCTI + Grafana + ingress)

`scripts/deploy-stack.sh all` brings up every component via Helm and exposes them through
Traefik at `soc.homelab.local` (add `127.0.0.1 soc.homelab.local` to `/etc/hosts`). See
[`docs/runbooks/initial-setup.md`](docs/runbooks/initial-setup.md) for the ordered runbook,
credentials, and the OpenSearch/Filebeat gotchas.

```bash
make teardown      # tear the stack down (Lima VM stays); `make down` stops the VM
make test          # end-to-end smoke test (scripts/test-flow.sh)
```

## Security & Hardening

MatchBox is built fail-closed and audited (206-finding review → remediated across v1.6.0 / v1.7.0):

- **Secrets**: SOPS + age encrypted (`secrets.enc.yaml` is the committed source of truth; the plaintext `secrets.yaml` is gitignored). Secret refs are fail-closed (no `optional: true`), so a missing credential blocks startup (`CreateContainerConfigError`) instead of booting blank.
- **PKI / TLS**: a self-signed CA (`scripts/generate-certs.sh`, 0 RAM) issues all internal certs; OpenSearch HTTP is HTTPS-only and every consumer trusts the SOC CA (no `NODE_TLS_REJECT_UNAUTHORIZED=0`, no `tlsSkipVerify`). OpenSearch is configured with a **custom `internal_users.yml`** (real bcrypt admin password via `scripts/setup-opensearch-users.sh`, not the chart default).
- **Network**: 34 NetworkPolicies — default-deny ingress *and* egress per namespace + scoped allow rules. Pod Security Standards labels (`restricted` everywhere except the `privileged` Wazuh-agent namespace).
- **Agents**: password-based enrollment (`authd` `use_password`), persisted `client.keys`.
- **Dashboard**: server-side `/api/*` proxy requires auth (no unauthenticated SOC data); credentials never reach the browser.
- **Supply chain**: pinned chart `--version`s and image tags; GitHub Actions runs `gitleaks`, and git history has been scrubbed of previously-committed secrets.

## MCP Server Integration

Three custom MCP servers let Claude Code interact with the SOC. Alerts/vulnerabilities are
read from the Wazuh **indexer** (`_search`), agents/rules/decoders from the Server API:

```text
"Show me all critical Wazuh alerts from the last 24 hours"
"Create a TheHive case for the brute-force attack on 192.168.1.50"
"What MITRE ATT&CK techniques are associated with this IP?"
```

Register them in project `.claude/settings.json` (env-referenced secrets, never inlined). See [`docs/mcp-servers.md`](docs/mcp-servers.md).

## Dashboard

<img alt="MatchBox SOC Command Center" src="docs/dashboard-overview.png" />

The **MatchBox SOC Command Center** is a SvelteKit dashboard that unifies all 5 services into a single pane of glass with live monitoring.

```bash
cp dashboard/.env.example dashboard/.env   # set service URLs/creds + NODE_EXTRA_CA_CERTS (SOC CA) + SOC_API_TOKEN
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80 &   # for embedded Grafana panels
cd dashboard && npm install && npm run dev -- --port 5173            # http://localhost:5173
```

- **Service Overview** — health + key metrics for Wazuh, Grafana, OpenCTI, TheHive, Cortex (empty-vs-zero states)
- **Live Monitoring** — embedded Grafana dashboards with theme sync
- **Wazuh Detail** — alert breakdown, agent status, CIS Benchmark SCA compliance
- **Solarized theme** — Light/Dark toggle synced across the app and embedded Grafana

## Development

npm workspaces monorepo (shared MCP lib + 3 servers + dashboard). CI mirrors these via [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

```bash
make build   # build all workspaces (shared first)
make ci      # build + typecheck + Vitest + Biome + svelte-check (mirrors GitHub Actions)
make lint    # Biome check (lint + format)
make test    # end-to-end cluster smoke test (scripts/test-flow.sh; needs a running stack)
```

Node `>=20`. Lint/format via **Biome**; manifests validated with `kubeconform`; shell with `shellcheck`; secrets scanned with `gitleaks`.

## Documentation
- [Versions & Facts (source of truth)](docs/VERSIONS.md)
- [Architecture Design](docs/architecture.md) · [Network Diagram](docs/network-diagram.md) · [Resource Requirements](docs/resource-requirements.md)
- [Integration Details](docs/integrations.md) · [MCP Server Design](docs/mcp-servers.md)
- Runbooks: [Initial Setup](docs/runbooks/initial-setup.md) · [Adding Agents](docs/runbooks/adding-agents.md) · [Incident Response](docs/runbooks/incident-response.md)
