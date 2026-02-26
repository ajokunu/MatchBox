# Resource Requirements — Slim Config

## Hardware: Mac Mini M4 (16GB RAM)

### System Breakdown
| Layer | RAM | Notes |
|-------|-----|-------|
| macOS system | ~4-5GB | Finder, WindowServer, kernel, background services |
| Lima VM overhead | ~500MB | VZ framework, virtiofsd, shared memory |
| **Available for k3s** | **~10GB** | Lima VM allocation |

### Per-Component Budget

| Component | Namespace | RAM Request | RAM Limit | CPU Request | CPU Limit |
|-----------|-----------|-------------|-----------|-------------|-----------|
| k3s system (kubelet, kube-proxy, CoreDNS) | kube-system | 300MB | 500MB | 0.2 | 0.5 |
| OpenSearch (1GB heap, single node) | shared | 1.5GB | 2GB | 0.5 | 1.0 |
| Redis | shared | 128MB | 256MB | 0.05 | 0.1 |
| RabbitMQ | shared | 128MB | 256MB | 0.05 | 0.1 |
| MinIO (single node) | shared | 256MB | 512MB | 0.1 | 0.25 |
| NFS Server (nfs-ganesha) | shared | 64MB | 128MB | 0.05 | 0.1 |
| Wazuh Manager | wazuh | 512MB | 1GB | 0.25 | 0.5 |
| Wazuh Dashboard | wazuh | 256MB | 512MB | 0.1 | 0.25 |
| Wazuh Agent (per node) | wazuh | 128MB | 256MB | 0.1 | 0.2 |
| TheHive | thehive | 512MB | 1GB | 0.25 | 0.5 |
| Cortex | thehive | 256MB | 512MB | 0.1 | 0.25 |
| OpenCTI Platform | opencti | 1GB | 1.5GB | 0.25 | 0.5 |
| OpenCTI Worker (x1) | opencti | 256MB | 512MB | 0.1 | 0.25 |
| Prometheus | monitoring | 256MB | 384MB | 0.1 | 0.25 |
| Grafana | monitoring | 256MB | 384MB | 0.1 | 0.25 |
| **Total Requests** | | **~5.8GB** | | **~2.3 cores** | |
| **Total Limits** | | **~9.5GB** | | **~4.5 cores** | |

### Headroom Analysis
- Total limits: 9.5GB
- VM allocation: 10GB
- Headroom: ~500MB for burst, page cache, and swap
- Swap: 4GB configured in VM as safety net

## Operating Modes

### Steady State (Always-On)
Components: k3s + OpenSearch + Wazuh + Traefik
| Component | RAM Used |
|-----------|----------|
| k3s system | ~400MB |
| OpenSearch | ~1.5GB |
| Wazuh Manager | ~700MB |
| Wazuh Dashboard | ~350MB |
| Wazuh Agent | ~150MB |
| Traefik | ~100MB |
| **Total** | **~3.2GB** |

Leaves ~6.8GB free in VM. macOS runs comfortably.

### Investigation Mode (Steady State + IR tools)
Add: TheHive + Cortex + OpenCTI
| Additional | RAM Used |
|------------|----------|
| TheHive | ~700MB |
| Cortex | ~350MB |
| OpenCTI | ~1.2GB |
| OpenCTI Worker | ~350MB |
| **Additional** | **~2.6GB** |
| **Total** | **~5.8GB** |

Leaves ~4.2GB free. Still comfortable.

### Full Load (All + monitoring + connectors)
Add: Prometheus + Grafana + active connectors
| Additional | RAM Used |
|------------|----------|
| Prometheus | ~300MB |
| Grafana | ~300MB |
| 2 Connectors | ~500MB |
| Analyzer Job | ~256MB |
| **Additional** | **~1.4GB** |
| **Total** | **~7.2GB** |

Leaves ~2.8GB free. Tight but workable with swap.

## Disk Requirements

| Component | Estimated Disk | Notes |
|-----------|---------------|-------|
| OpenSearch indices | 30-50GB | Depends on log retention policy |
| MinIO objects | 10-20GB | Artifacts, threat intel files |
| Wazuh logs | 5-10GB | Raw log storage |
| Container images | 15-20GB | All container images cached |
| Prometheus TSDB | 3-5GB | 15-day default retention |
| k3s system | 2-3GB | etcd, manifests, certificates |
| **Total** | **~65-108GB** | |

**Recommendation:** 120GB disk allocation for Lima VM provides comfortable headroom.

## Optimization Tips

1. **OpenSearch index lifecycle:** Set 7-day retention for Wazuh alerts, 30-day for threat intel
2. **Prometheus retention:** 15 days with 2-hour scrape interval for non-critical targets
3. **MinIO lifecycle:** Auto-delete artifacts older than 90 days
4. **Container image cleanup:** `crictl rmi --prune` monthly
5. **Log rotation:** Wazuh Manager archives compressed after 3 days
