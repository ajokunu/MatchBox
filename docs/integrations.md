# Integration Details

## Integration Map

```
Wazuh ----[alerts]----> TheHive ----[observables]----> Cortex
  |                        |                              |
  |                        |                              |
  v                        v                              v
OpenSearch            OpenCTI                    External APIs
(shared)          (threat context)         (VirusTotal, AbuseIPDB)
```

## 1. Wazuh --> TheHive (Alert Forwarding)

### Mechanism
Custom integration script (`w2thive.py`) triggered by Wazuh's active response system.

### How It Works
1. Wazuh Manager detects an alert at or above the configured threshold (level 7+)
2. Manager calls the integration script via `<integration>` block in `ossec.conf`
3. Script parses the Wazuh JSON alert
4. Script creates a TheHive alert via TheHive REST API (`/api/v1/alert`)
5. TheHive alert includes: title, description, severity mapping, source, observables

### Configuration (ossec.conf)
```xml
<integration>
  <name>custom-w2thive</name>
  <hook_url>http://thehive.thehive.svc.cluster.local:9000</hook_url>
  <api_key>THEHIVE_API_KEY</api_key>
  <level>7</level>
  <alert_format>json</alert_format>
</integration>
```

### Severity Mapping
| Wazuh Level | TheHive Severity |
|-------------|-----------------|
| 7-9 | Low (1) |
| 10-12 | Medium (2) |
| 13-14 | High (3) |
| 15 | Critical (4) |

### Observable Extraction
The integration script extracts observables from Wazuh alert JSON:
- `data.srcip` --> IP observable
- `data.dstip` --> IP observable
- `data.url` --> URL observable
- `data.md5` / `data.sha256` --> Hash observable
- `data.srcuser` --> Username observable

## 2. TheHive --> Cortex (Automated Analysis)

### Mechanism
TheHive submits observables to Cortex for automated analysis. Cortex launches Kubernetes Jobs.

### How It Works
1. Analyst (or auto-response rule) submits observable to Cortex
2. Cortex determines applicable analyzers based on observable data type
3. Cortex creates a Kubernetes Job for each analyzer
4. Job pod pulls analyzer Docker image, runs analysis, writes results to NFS
5. Cortex reads results from NFS and returns report to TheHive
6. TheHive attaches analyzer report to the case

### RBAC Requirements
Cortex needs a Kubernetes ServiceAccount with:
```yaml
rules:
  - apiGroups: ["batch"]
    resources: ["jobs"]
    verbs: ["create", "get", "list", "watch", "delete"]
  - apiGroups: [""]
    resources: ["pods", "pods/log"]
    verbs: ["get", "list", "watch"]
```

### Analyzer Configuration
Each analyzer is a Docker image configured in Cortex:
| Analyzer | Data Types | API Key Required | Rate Limit |
|----------|-----------|-----------------|------------|
| VirusTotal_GetReport | hash, ip, domain, url | Yes | 500/day |
| AbuseIPDB | ip | Yes | 1000/day |
| URLhaus | url, domain | No | Unlimited |
| MaxMind_GeoIP | ip | No (free DB) | Unlimited |
| FileInfo | file | No | Unlimited |

### NFS Shared Filesystem
Critical for Cortex on Kubernetes:
- Cortex pod writes job input to NFS
- Analyzer pod reads input from NFS, writes output to NFS
- Cortex pod reads output from NFS
- Without NFS, analyzer jobs fail silently

## 3. OpenCTI <--> TheHive (Bidirectional Intel)

### OpenCTI --> TheHive (Stream Connector)
1. OpenCTI stream connector monitors for new/updated indicators
2. When new threat intel matches case observables, pushes enrichment to TheHive
3. TheHive case gets updated with threat context (MITRE techniques, campaigns, etc.)

### TheHive --> OpenCTI (API Query)
1. Analyst investigating a case queries OpenCTI for IOC context
2. TheHive's OpenCTI integration calls GraphQL API
3. Returns: related indicators, threat actors, attack patterns, campaigns
4. Analyst uses context to determine scope and response actions

### Configuration
TheHive needs OpenCTI API URL and token in its application.conf:
```
cortex {
  servers = [
    {
      name = "Cortex"
      url = "http://cortex.thehive.svc.cluster.local:9001"
      auth { type = "bearer"; key = "CORTEX_API_KEY" }
    }
  ]
}
```

## 4. OpenCTI Connectors (Threat Feeds)

### MITRE ATT&CK Connector
- **Type:** external-import
- **Schedule:** Weekly (data changes infrequently)
- **Data:** Techniques, tactics, groups, software, mitigations
- **No API key required** — pulls from public STIX repository

### AlienVault OTX Connector
- **Type:** external-import
- **Schedule:** Daily (nightly CronJob)
- **Data:** Pulses containing indicators (IPs, domains, hashes, URLs)
- **API key:** Free tier, 10k requests/hour
- **Config:** Set `OTX_API_KEY` in connector Secret

### AbuseIPDB Connector
- **Type:** external-import
- **Schedule:** Daily (nightly CronJob)
- **Data:** Reported malicious IP addresses with confidence scores
- **API key:** Free tier, 1000 requests/day
- **Config:** Set `ABUSEIPDB_API_KEY` in connector Secret

### VirusTotal Connector
- **Type:** internal-enrichment
- **Schedule:** On-demand (triggered by new observables)
- **Data:** File reputation, IP reputation, domain reputation, URL scanning
- **API key:** Free tier, 500 requests/day
- **Config:** Set `VIRUSTOTAL_API_KEY` in connector Secret

## 5. Wazuh --> OpenSearch (Log Indexing)

### Mechanism
Wazuh Manager writes alerts and monitoring data to OpenSearch via its built-in output module.

### Index Patterns
- `wazuh-alerts-4.x-*` — Alert events (one index per day)
- `wazuh-monitoring-*` — Agent status monitoring
- `wazuh-statistics-*` — Manager performance stats

### Configuration
In Wazuh Manager's `ossec.conf`, the `<indexer>` block points to the shared OpenSearch:
```xml
<indexer>
  <enabled>yes</enabled>
  <hosts>
    <host>https://opensearch.shared.svc.cluster.local:9200</host>
  </hosts>
  <ssl>
    <certificate_authorities>/etc/ssl/certs/opensearch-ca.pem</certificate_authorities>
  </ssl>
</indexer>
```

## 6. Grafana --> Prometheus / OpenSearch (Monitoring)

### Prometheus Data Source
- Cluster metrics (CPU, memory, disk per namespace/pod)
- Wazuh Manager metrics (if metrics endpoint enabled)
- Custom SOC metrics (alert counts, case counts)

### OpenSearch Data Source
- Direct query to Wazuh alert indices for dashboard visualizations
- Community dashboards (IDs: 21565, 22448, 22449, 22450, 22451, 22453)
- Custom SOC overview dashboard

## Integration Health Checks

### Verify Wazuh --> TheHive
```bash
# Trigger a test alert on Wazuh
/var/ossec/bin/wazuh-logtest  # submit a test log

# Check TheHive for new alert
curl -H "Authorization: Bearer $THEHIVE_API_KEY" \
  http://thehive:9000/api/v1/alert?range=0-5&sort=-createdAt
```

### Verify TheHive --> Cortex
```bash
# Check Cortex status from TheHive
curl -H "Authorization: Bearer $CORTEX_API_KEY" \
  http://cortex:9001/api/analyzer

# Submit test observable
curl -XPOST -H "Authorization: Bearer $THEHIVE_API_KEY" \
  http://thehive:9000/api/v1/case/{id}/observable \
  -d '{"dataType":"ip","data":"8.8.8.8"}'
```

### Verify OpenCTI Feeds
```bash
# Check connector status
curl -H "Authorization: Bearer $OPENCTI_TOKEN" \
  http://opencti:4000/graphql \
  -d '{"query":"{ connectors { id name active } }"}'
```
