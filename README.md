# MatchBox
<img width="1232" height="928" alt="Don_The_word_MatchBox_emboldened_across_the_top_of_the_page___e31dc2d0-5ba4-4d4c-b5df-69ab3a32a1a9_2" src="https://github.com/user-attachments/assets/3f7f8695-7578-489a-bbea-2b009b827544" />


A professional-grade home SOC (Security Operations Center) running on lightweight Kubernetes, designed for the Mac Mini M4 (16GB RAM).

## What's Inside

| Component | Role | Why |
|-----------|------|-----|
| **Wazuh 4.14.3** | SIEM/XDR | Log collection, threat detection, file integrity monitoring, vulnerability scanning |
| **OpenCTI 6.9.5** | Threat Intelligence | MITRE ATT&CK mapping, IOC management, threat feed aggregation |
| **TheHive + Cortex** | Incident Response | Case management, automated analysis (VirusTotal, AbuseIPDB, etc.) |
| **Grafana** | Monitoring | SOC dashboards, cluster health, compliance visualization |
| **k3s** | Kubernetes | Lightweight orchestration for all components |
| **MCP Servers** | AI Integration | Claude Code can query alerts, cases, and threat intel directly |

## Quick Start

### Prerequisites
- macOS with Apple Silicon (M1/M2/M3/M4)
- Homebrew installed
- 16GB+ RAM (32GB recommended)
- 120GB+ free disk space

### 1. Install Dependencies
```bash
brew install lima kubectl helm
```

### 2. Start the Cluster
```bash
cd /Users/donniebot/DonnieBot/SecurityCenter
./scripts/setup-lima.sh
```

### 3. Deploy the Stack
```bash
./scripts/deploy-stack.sh
```

### 4. Access Dashboards
Add to `/etc/hosts`:
```
<lima-vm-ip>  soc.homelab.local
```

Then open:
- Wazuh: https://soc.homelab.local/wazuh
- TheHive: https://soc.homelab.local/thehive
- OpenCTI: https://soc.homelab.local/opencti
- Grafana: https://soc.homelab.local/grafana

### 5. Test the Pipeline
```bash
./scripts/test-flow.sh
```

## Resource Profile (Slim Config)

Designed for 16GB Mac Mini M4. Lima VM gets 10GB RAM.

| State | RAM Usage | What's Running |
|-------|-----------|----------------|
| Steady state | ~7.1GB | k3s, OpenSearch, Wazuh, Monitoring (always-on) |
| Investigation mode | ~10.5GB | + TheHive, Cortex, OpenCTI (on-demand) |
| Full stack | ~10.5GB | Everything, connectors scheduled via CronJobs |

## MCP Server Integration

Three custom MCP servers let Claude Code interact with the SOC:

```bash
# Query Wazuh alerts from Claude Code
"Show me all critical alerts from the last 24 hours"

# Manage TheHive cases
"Create a case for the brute force attack on 192.168.1.50"

# Search OpenCTI threat intel
"What MITRE ATT&CK techniques are associated with this IP?"
```

## Dashboard

The SOC is integrated into the DonnieBot Security Center dashboard at `http://localhost:3099`:
- **SOC tab** — Architecture, components, resource budget, MCP tools, port reference
- **Blog tab** — Medium-style article about building the home SOC

A standalone version is also available at `public/index.html`.

## Documentation
- [Architecture Design](docs/architecture.md)
- [Network Diagram](docs/network-diagram.md)
- [Resource Requirements](docs/resource-requirements.md)
- [Integration Details](docs/integrations.md)
- [MCP Server Design](docs/mcp-servers.md)
- [Runbook: Initial Setup](docs/runbooks/initial-setup.md)
- [Runbook: Adding Agents](docs/runbooks/adding-agents.md)
- [Runbook: Incident Response](docs/runbooks/incident-response.md)
