# Runbook: Incident Response

## Overview
When Wazuh detects a threat (alert level 7+), the following automated pipeline kicks in:

```
Wazuh Alert -> TheHive Alert -> Analyst Triage -> Cortex Analysis -> OpenCTI Enrichment
```

This runbook covers how to handle an incident from detection to resolution.

## Phase 1: Detection (Automated)

### What happens automatically:
1. Wazuh agent detects suspicious activity
2. Wazuh Manager creates an alert and indexes it in OpenSearch
3. Alert appears on Wazuh Dashboard
4. If level >= 7, `w2thive.py` creates a TheHive alert with observables

### Where to look:
- **Wazuh Dashboard:** https://soc.homelab.local/wazuh -> Security Events
- **TheHive:** https://soc.homelab.local/thehive -> Alerts

## Phase 2: Triage

### Using TheHive UI:
1. Open TheHive: https://soc.homelab.local/thehive
2. Review new alerts in the Alert queue
3. Check severity, source, and initial observables
4. Decision: **Escalate** (create case) or **Dismiss** (false positive)

### Using Claude Code + MCP:
```
"Show me all new TheHive alerts from Wazuh"
-> thehive-mcp: search-alerts(source="Wazuh", limit=10)

"What's the full context of alert ~123?"
-> thehive-mcp: get-case(case_id="~123")
```

### Triage Criteria:
| Severity | Action | Example |
|----------|--------|---------|
| Critical (4) | Immediate investigation | Reverse shell detected |
| High (3) | Investigate within 1 hour | Brute force success after failures |
| Medium (2) | Investigate within 24 hours | Multiple failed SSH logins |
| Low (1) | Review weekly | Single failed login attempt |

## Phase 3: Investigation

### Start Investigation Tools (if not running):
```bash
# Scale up TheHive, Cortex, OpenCTI if in on-demand mode
kubectl scale deployment thehive --replicas=1 -n thehive
kubectl scale deployment cortex --replicas=1 -n thehive
kubectl scale deployment opencti --replicas=1 -n opencti
```

### Run Cortex Analyzers:
1. In TheHive case, click on an observable (IP, hash, URL)
2. Click "Run Analyzers"
3. Select relevant analyzers:
   - **IP address:** VirusTotal, AbuseIPDB, MaxMind GeoIP
   - **Hash:** VirusTotal, FileInfo
   - **URL/Domain:** VirusTotal, URLhaus
4. Wait for results (usually 10-30 seconds)

### Via Claude Code + MCP:
```
"Run VirusTotal on the suspicious IP 203.0.113.50"
-> thehive-mcp: add-observable(case_id="~456", data_type="ip", data="203.0.113.50")
-> thehive-mcp: run-analyzer(observable_id="...", analyzer_id="VirusTotal_GetReport_3_1")

"What does OpenCTI know about this IP?"
-> opencti-mcp: search-indicators(value="203.0.113.50", type="IPv4-Addr")

"What MITRE techniques are associated with brute force?"
-> opencti-mcp: get-attack-patterns(search="brute force")
```

### Check OpenCTI for Threat Context:
1. Open OpenCTI: https://soc.homelab.local/opencti
2. Search for observables (IPs, domains, hashes)
3. Check related campaigns, threat actors, and MITRE ATT&CK techniques
4. Note any TTPs (Tactics, Techniques, and Procedures)

## Phase 4: Containment

### If the threat is confirmed:

**Block IP on the host firewall:**
```bash
# On the Mac Mini
sudo pfctl -t blocked_ips -T add 203.0.113.50
```

**Isolate an agent:**
```bash
# Disconnect a compromised Wazuh agent
kubectl exec -n wazuh deployment/wazuh-manager -- \
  /var/ossec/bin/agent_control -b <agent-id>
```

**Scale down compromised workloads:**
```bash
kubectl scale deployment <compromised-app> --replicas=0 -n <namespace>
```

## Phase 5: Eradication & Recovery

1. Identify and remove the threat (malware, unauthorized access, etc.)
2. Patch the vulnerability that was exploited
3. Restore from backups if data was affected
4. Reset compromised credentials
5. Update Wazuh rules if a new detection pattern was identified

## Phase 6: Post-Incident

### Document in TheHive:
1. Add a summary task to the case
2. Document timeline of events
3. List affected systems and data
4. Note containment and eradication steps taken
5. Close the case with resolution status

### Update Detection Rules:
If the incident revealed a gap in detection:
```bash
# Edit custom rules
kubectl edit configmap wazuh-custom-rules -n wazuh
# Restart manager to reload
kubectl rollout restart statefulset wazuh-manager -n wazuh
```

### Update Threat Intel:
If new IOCs were discovered:
```
"Add indicator 203.0.113.50 to OpenCTI with tag 'incident-2024-001'"
-> opencti-mcp: (manual creation via UI)
```

## Quick Reference: Useful Commands

```bash
# Check recent Wazuh alerts
kubectl exec -n wazuh deployment/wazuh-manager -- \
  cat /var/ossec/logs/alerts/alerts.json | tail -5

# Check TheHive open cases
curl -s -H "Authorization: Bearer $THEHIVE_API_KEY" \
  http://localhost:9000/api/v1/case?range=0-5

# Check Cortex analyzer status
curl -s -H "Authorization: Bearer $CORTEX_API_KEY" \
  http://localhost:9001/api/analyzer

# View Wazuh agent logs
kubectl logs -n wazuh daemonset/wazuh-agent --tail=50

# Check OpenCTI connector status
kubectl get cronjobs -n opencti
kubectl get jobs -n opencti
```
