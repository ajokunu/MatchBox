# MCP Server Design

## Overview

Three custom MCP (Model Context Protocol) servers provide Claude Code with direct access to the SOC stack. Each server is a standalone TypeScript package using `@modelcontextprotocol/sdk`.

## Architecture

```
Claude Code (macOS)
      |
      +-- wazuh-mcp -----> Wazuh Server API (https://wazuh-manager:55000)
      |                     Auth: user/password -> JWT token  [agents, rules, decoders]
      |                +--> Wazuh Indexer    (https://wazuh-indexer:9200)
      |                     Auth: Basic                       [alerts, vulnerabilities]
      |
      +-- thehive-mcp ---> TheHive REST API (http://thehive:9000/api/v1)
      |                     Auth: API key header
      |
      +-- opencti-mcp ---> OpenCTI GraphQL API (http://opencti:4000/graphql)
                            Auth: Bearer token header
```

All three servers run on the macOS host and connect to services inside the Lima VM via port forwarding or kubectl port-forward.

## wazuh-mcp

### Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `list-alerts` | List recent Wazuh alerts | `limit`, `level_min`, `agent_id`, `rule_id` |
| `get-alert` | Get full alert details | `alert_id` |
| `search-agents` | Search registered agents | `name`, `ip`, `status`, `os_platform` |
| `get-agent-info` | Get agent details + last keep-alive | `agent_id` |
| `get-vulnerabilities` | List detected vulnerabilities | `agent_id`, `severity`, `cve` |
| `get-rules` | Search active detection rules | `search`, `level`, `group` |
| `get-decoders` | Search active log decoders | `search`, `file` |

> 7 tools total (no `run-sca-scan` — SCA triggering is not implemented). See
> `docs/VERSIONS.md` for the canonical count.

### APIs Used

Two endpoints, because alerts/vulnerabilities are **not** on the Wazuh Server API:

- **Wazuh Server API** (`WAZUH_API_URL`, port 55000) — agents, rules, decoders:
  - `POST /security/user/authenticate` -> JWT token
  - `GET /agents` -> agent inventory (`search-agents`, `get-agent-info`)
  - `GET /rules` -> detection rule catalog (`get-rules`)
  - `GET /decoders` -> decoder catalog (`get-decoders`)
- **Wazuh Indexer / OpenSearch** (`WAZUH_INDEXER_URL`, port 9200, Basic auth) — alerts and
  vulnerabilities live only in the indexer, queried via `_search`:
  - `POST /wazuh-alerts-*/_search` -> alert list / single alert (`list-alerts`, `get-alert`)
  - `POST /wazuh-states-vulnerabilities-*/_search` -> vulnerabilities (`get-vulnerabilities`)

### Environment Variables
```
# Server API (agents, rules, decoders)
WAZUH_API_URL=https://localhost:55000
WAZUH_API_USER=wazuh-wui
WAZUH_API_PASSWORD=<from-k8s-secret>
WAZUH_VERIFY_SSL=false

# Indexer / OpenSearch (alerts, vulnerabilities — queried via _search)
WAZUH_INDEXER_URL=https://localhost:9200
WAZUH_INDEXER_USER=admin
WAZUH_INDEXER_PASSWORD=<from-k8s-secret>
```

## thehive-mcp

### Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `list-cases` | List open/recent cases | `status`, `severity`, `limit`, `sort` |
| `create-case` | Create a new case | `title`, `description`, `severity`, `tags` |
| `get-case` | Get case details + observables | `case_id` |
| `add-observable` | Add observable to a case | `case_id`, `data_type`, `data`, `tags` |
| `run-analyzer` | Run Cortex analyzer on observable | `observable_id`, `analyzer_id` |
| `get-analyzer-report` | Get analyzer results | `job_id` |
| `search-alerts` | Search TheHive alerts (from Wazuh) | `source`, `severity`, `limit` |
| `merge-alerts` | Merge related alerts into a case | `alert_ids`, `case_id` |

### API Endpoints Used
- `POST /api/v1/query` -> flexible search
- `POST /api/v1/case` -> create case
- `GET /api/v1/case/{id}` -> case details
- `POST /api/v1/case/{id}/observable` -> add observable
- `POST /api/v1/connector/cortex/job` -> run analyzer
- `GET /api/v1/connector/cortex/job/{id}` -> job status/results
- `POST /api/v1/alert/_merge/{id}` -> merge alerts

### Environment Variables
```
THEHIVE_URL=http://localhost:9000
THEHIVE_API_KEY=<from-k8s-secret>
```

## opencti-mcp

### Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `search-indicators` | Search threat indicators (IOCs) | `value`, `type`, `limit` |
| `get-indicator` | Get indicator details + relationships | `indicator_id` |
| `search-reports` | Search threat reports | `search`, `report_type`, `limit` |
| `get-attack-patterns` | List MITRE ATT&CK techniques | `search`, `tactic`, `limit` |
| `enrich-observable` | Request enrichment for an observable | `value`, `type` |
| `get-relationships` | Get entity relationships | `entity_id`, `relationship_type` |

### GraphQL Queries Used
```graphql
# Search indicators
query SearchIndicators($search: String, $first: Int) {
  stixCyberObservables(search: $search, first: $first) {
    edges { node { id observable_value entity_type } }
  }
}

# Get attack patterns
query GetAttackPatterns($search: String) {
  attackPatterns(search: $search) {
    edges { node { id name x_mitre_id description kill_chain_phases { phase_name } } }
  }
}
```

### Environment Variables
```
OPENCTI_URL=http://localhost:4000
OPENCTI_TOKEN=<from-k8s-secret>
```

## Package Structure (Each Server)

Each server is a single-file TypeScript package; shared HTTP/formatting helpers were
extracted into the `@matchbox/mcp-shared` package (CHANGELOG 1.4.0).

```
{server}-mcp/
  package.json
  tsconfig.json
  src/
    index.ts        # Entire server: client + tool registration + handlers
  README.md

mcp-servers/shared/   # @matchbox/mcp-shared — fetchWithRetry(), formatResponse(),
                      # RETRYABLE_CODES, REQUEST_TIMEOUT_MS, MAX_RESPONSE_CHARS
```

### Dependencies (shared across all three)
```json
{
  "dependencies": {
    "@matchbox/mcp-shared": "file:../shared",
    "@modelcontextprotocol/sdk": "^1.9.0",
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0"
  }
}
```

## Registration

In `.claude/settings.json`:
```json
{
  "mcpServers": {
    "wazuh": {
      "command": "npx",
      "args": ["tsx", "mcp-servers/wazuh-mcp/src/index.ts"],
      "env": {
        "WAZUH_API_URL": "https://localhost:55000",
        "WAZUH_API_USER": "wazuh-wui",
        "WAZUH_INDEXER_URL": "https://localhost:9200",
        "WAZUH_INDEXER_USER": "admin"
      }
    },
    "thehive": {
      "command": "npx",
      "args": ["tsx", "mcp-servers/thehive-mcp/src/index.ts"],
      "env": {
        "THEHIVE_URL": "http://localhost:9000"
      }
    },
    "opencti": {
      "command": "npx",
      "args": ["tsx", "mcp-servers/opencti-mcp/src/index.ts"],
      "env": {
        "OPENCTI_URL": "http://localhost:4000"
      }
    }
  }
}
```

Sensitive values (passwords, API keys) should be set in the shell environment, not in settings.json.

## Also Install: kubectl-mcp-server

For general Kubernetes cluster management:
```bash
npm install -g kubectl-mcp-server
```

Add to global Claude Code MCP config for cross-project k8s access.

## Usage Examples

### Triage an Alert
```
"Show me the latest critical Wazuh alerts"
-> wazuh-mcp: list-alerts(level_min=12, limit=10)

"Create a case for the brute force alert on 192.168.1.50"
-> thehive-mcp: create-case(title="Brute Force Attack - 192.168.1.50", severity=3)

"Add the attacking IP as an observable and run VirusTotal"
-> thehive-mcp: add-observable(case_id=..., data_type="ip", data="192.168.1.50")
-> thehive-mcp: run-analyzer(observable_id=..., analyzer_id="VirusTotal_GetReport_3_1")
```

### Research a Threat
```
"What MITRE techniques involve lateral movement?"
-> opencti-mcp: get-attack-patterns(tactic="lateral-movement")

"Search for any indicators related to this IP in our threat intel"
-> opencti-mcp: search-indicators(value="203.0.113.50", type="IPv4-Addr")

"Show me the relationships for this threat actor"
-> opencti-mcp: get-relationships(entity_id=..., relationship_type="uses")
```
