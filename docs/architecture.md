# Architecture Design & Reasoning

## Overview

The MatchBox is a home SOC built on a single Mac Mini M4 (16GB RAM) running k3s Kubernetes inside a Lima VM. It provides enterprise-grade security monitoring, threat intelligence, and incident response capabilities within home lab constraints.

## Why This Stack?

### Wazuh (SIEM/XDR) — The Eyes
**Decision:** Wazuh over Elastic SIEM, Splunk, or QRadar.
- **Open source** — no license costs, full feature access
- **All-in-one:** log collection, FIM, rootkit detection, vulnerability scanning, compliance
- **OpenSearch backend** (since 4.3.0) — avoids Elastic licensing issues
- **Kubernetes-native** — deploys with DaemonSets, has Helm chart support
- **Active community** — 20k+ GitHub stars, frequent releases
- **Agent-based** — can monitor the Mac Mini host AND k8s pods

### OpenCTI (Threat Intelligence) — The Brain
**Decision:** OpenCTI over MISP alone.
- **STIX2 native** — modern threat intel standard, better data model than MISP's custom format
- **Connector ecosystem** — 60+ connectors for MITRE ATT&CK, AlienVault, VirusTotal, etc.
- **GraphQL API** — rich querying, perfect for MCP server integration
- **Relationship mapping** — connects indicators, campaigns, threat actors, techniques
- **TheHive integration** — bidirectional enrichment via stream connectors

### TheHive + Cortex (Incident Response) — The Hands
**Decision:** TheHive over PagerDuty, Jira, or custom ticketing.
- **Purpose-built for SOC** — case management, alert triage, observable tracking
- **Cortex analyzers** — automated analysis via 100+ analyzers (VirusTotal, AbuseIPDB, etc.)
- **Wazuh integration** — alerts auto-create TheHive cases via custom integration script
- **Kubernetes job model** — Cortex launches analyzer pods on-demand, cleans up after

### k3s (Kubernetes) — The Platform
**Decision:** k3s over k0s, MicroK8s, or full K8s.
- **Lightest mainstream K8s** — ~750MB baseline, single binary
- **Built-in essentials** — Traefik ingress, local-path-provisioner, CoreDNS
- **Largest ecosystem** — most tutorials, Helm charts, and community support for security tools
- **Production-ready** — used in production by thousands of companies, not just home labs
- **CNCF certified** — real Kubernetes certification, counts as K8s experience

### Lima (VM) — The Foundation
**Decision:** Lima over Multipass, UTM, or Docker Desktop.
- **Purpose-built for macOS** — automatic file sharing, port forwarding, kubeconfig export
- **VZ framework** — Apple's native virtualization, near-native performance on M-series
- **Rosetta 2** — runs x86 containers on ARM transparently
- **Minimal overhead** — no Docker daemon, no desktop app, just a lightweight VM

## Component Architecture

```
                    +-----------------------------------------+
                    |          Mac Mini M4 (macOS)            |
                    |  RAM: 16GB | CPU: M4 | Disk: 256GB+    |
                    |                                         |
                    |  +-----------------------------------+  |
                    |  |      Lima VM (10GB RAM, 4 CPU)     |  |
                    |  |                                     |  |
                    |  |  +-------------------------------+  |  |
                    |  |  |        k3s Cluster             |  |  |
                    |  |  |                                 |  |  |
                    |  |  |  [shared namespace]             |  |  |
                    |  |  |    OpenSearch (2GB)              |  |  |
                    |  |  |    Redis (256MB)                 |  |  |
                    |  |  |    RabbitMQ (256MB)              |  |  |
                    |  |  |    MinIO (512MB)                 |  |  |
                    |  |  |    NFS Server (128MB)            |  |  |
                    |  |  |                                 |  |  |
                    |  |  |  [wazuh namespace]              |  |  |
                    |  |  |    Manager (1GB)                 |  |  |
                    |  |  |    Dashboard (512MB)             |  |  |
                    |  |  |    Agent DaemonSet               |  |  |
                    |  |  |                                 |  |  |
                    |  |  |  [thehive namespace]            |  |  |
                    |  |  |    TheHive (1GB)                 |  |  |
                    |  |  |    Cortex (512MB)                |  |  |
                    |  |  |    Analyzer Jobs (ephemeral)     |  |  |
                    |  |  |                                 |  |  |
                    |  |  |  [opencti namespace]            |  |  |
                    |  |  |    Platform (1.5GB)              |  |  |
                    |  |  |    Worker x1 (512MB)             |  |  |
                    |  |  |    Connectors (on-demand)        |  |  |
                    |  |  |                                 |  |  |
                    |  |  |  [monitoring namespace]         |  |  |
                    |  |  |    Prometheus (384MB)             |  |  |
                    |  |  |    Grafana (384MB)               |  |  |
                    |  |  |                                 |  |  |
                    |  |  |  [Traefik Ingress]              |  |  |
                    |  |  |    soc.homelab.local/*           |  |  |
                    |  |  +-------------------------------+  |  |
                    |  +-----------------------------------+  |
                    |                                         |
                    |  Claude Code + MCP Servers (macOS-side) |
                    |    wazuh-mcp -> Wazuh REST API          |
                    |    thehive-mcp -> TheHive API            |
                    |    opencti-mcp -> OpenCTI GraphQL API    |
                    +-----------------------------------------+
```

## Data Flow Architecture

### 1. Log Ingestion Pipeline
```
Endpoints/Containers --> Wazuh Agent (DaemonSet)
                              |
                              | TCP:1514 (syslog)
                              v
                        Wazuh Manager
                              |
                    +---------+---------+
                    |                   |
                    v                   v
              OpenSearch           TheHive
           (index + store)    (alert -> case)
                    |
                    v
            Wazuh Dashboard
           (visualize + query)
```

### 2. Threat Intelligence Pipeline
```
External Sources:
  MITRE ATT&CK ---+
  AlienVault OTX --+--> OpenCTI Connectors --> OpenCTI Platform
  AbuseIPDB -------+         (CronJobs)              |
  VirusTotal ------+                                  |
                                                       |
                                              +--------+--------+
                                              |                 |
                                              v                 v
                                         OpenSearch        TheHive
                                       (STIX storage)  (case enrichment)
```

### 3. Incident Response Pipeline
```
Wazuh Alert (level 7+)
        |
        | custom-w2thive.py
        v
  TheHive Alert --> Auto-create Case
        |
        | Submit observables
        v
  Cortex Analyzers (K8s Jobs)
    - VirusTotal
    - AbuseIPDB
    - URLhaus
    - MaxMind GeoIP
        |
        | Results
        v
  TheHive Case (enriched)
        |
        | Query OpenCTI
        v
  Threat Context (MITRE ATT&CK mapping, related campaigns)
```

## Shared vs Dedicated Services

### Why Shared OpenSearch?
On 16GB hardware, running separate Elasticsearch/OpenSearch instances for Wazuh, TheHive, and OpenCTI would consume 6-12GB RAM. Instead, we run ONE OpenSearch cluster with index-per-service isolation:

- `wazuh-alerts-*` — Wazuh alert indices
- `wazuh-monitoring-*` — Wazuh agent monitoring
- `opencti-*` — OpenCTI STIX data
- `thehive-*` — TheHive case data (if using ES backend)

**Trade-off:** Shared failure domain. If OpenSearch crashes, everything goes down. Acceptable for home lab; in production you'd separate them.

### Why Shared MinIO?
Same reasoning — one S3-compatible storage layer with bucket-per-service:
- `opencti-bucket` — OpenCTI file storage
- `thehive-bucket` — TheHive artifacts
- `cortex-bucket` — Cortex job data

## Phased Startup Strategy

Not all components run 24/7. This is critical for 16GB hardware.

### Tier 1: Always On (~6-7GB)
- k3s system services
- OpenSearch
- Wazuh Manager + Dashboard + Agents
- Traefik ingress

**Purpose:** Continuous security monitoring. Logs are always being collected and analyzed.

### Tier 2: On-Demand (~2-3GB additional)
- TheHive + Cortex (start when investigating an alert)
- OpenCTI platform (start when researching threats)

**Purpose:** Investigation tools. Start them when you need to triage an alert or research a threat.

### Tier 3: Scheduled (CronJobs, brief spikes)
- OpenCTI connectors (MITRE, OTX, AbuseIPDB) — run nightly
- VirusTotal enrichment — triggered on new observables only

**Purpose:** Keep threat intel fresh without running connectors 24/7.

## Security Considerations

### Network Isolation
- All internal services (OpenSearch, Redis, RabbitMQ, MinIO) use ClusterIP — no external exposure
- Only web UIs and Wazuh agent port are exposed via Traefik/NodePort
- Traefik BasicAuth middleware provides an additional authentication layer

### Secrets Management
- Kubernetes Secrets for all API keys, passwords, and tokens
- `.env.example` files document required variables without exposing values
- Never commit secrets to git — `.gitignore` enforces this

### RBAC
- Cortex gets a dedicated ServiceAccount with minimal permissions (create/manage Jobs only)
- Each namespace has its own service accounts
- No cluster-admin bindings for application workloads
