# Implementation Contract — SOTA Hardening Pass (2026)

This file is the **single source of truth** for the parallel fix fleet. Every lane agent MUST
follow these conventions so independently-edited files stay consistent. Decisions approved by the
owner: **(1) full state-of-the-art pass · (2) Helm-canonical, delete dead raw manifests · (3) SOPS+age for secrets.**

Findings to implement: `docs/AUDIT-2026-findings.json` (206 confirmed). Filter to your lane's files.

---

## 0. Global rules for every lane agent

- **Stay in your file lane** (Section 5). Never edit a file owned by another lane. Lanes are file-disjoint.
- **Edits only.** Do NOT run `npm install`, builds, `git`, `helm`, `kubectl`, or formatters. The main loop verifies and commits. You may CREATE test/config files but never execute them.
- **Do not print secret values.** `k8s/shared/secrets.yaml` contains real creds — reference key names only.
- Fix the audit findings for your lane **and** anything else broken/inefficient you spot in-lane (report extras).
- Match existing code style. Keep diffs minimal and reviewable. Add a brief comment explaining each non-obvious change.
- Return structured output: changed files, what you did, extra issues fixed, and what you deliberately deferred.

## 1. Canonical names — secrets, certs, configmaps (DO NOT INVENT VARIANTS)

Existing K8s Secrets (keys as-is; created by SOPS-decrypted `secrets.enc.yaml`):
- `soc-shared-secrets` (ns `shared`): `opensearch-password`, `redis-password`, `rabbitmq-password`, `rabbitmq-erlang-cookie`, `minio-root-user`, `minio-root-password`
- `soc-wazuh-secrets` (ns `wazuh`): `wazuh-api-password`, `indexer-password`
- `soc-opencti-secrets` (ns `opencti`): `admin-password`, `admin-token`, `alienvault-api-key`, `abuseipdb-api-key`, `virustotal-api-key`, `health-access-key`
- `soc-thehive-secrets` (ns `thehive`): `api-key`, `play-secret`, `cortex-api-key`
- `soc-grafana-secrets` (ns `monitoring`): `admin-password`, `admin-user`

TLS/cert secrets — created by `scripts/generate-certs.sh` (openssl, 0 RAM; **canonical** cert path):
- `opensearch-certs` (ns `shared` AND `wazuh`): `esnode.pem`, `esnode-key.pem`, `root-ca.pem`, `kirk.pem`, `kirk-key.pem`
  - **Keys MUST be PKCS#8** (`openssl pkcs8 -topk8 -nocrypt`) or Wazuh's Filebeat (Go TLS) rejects them.
  - SANs on esnode: `DNS:opensearch-cluster-master.shared.svc.cluster.local,DNS:opensearch-cluster-master,DNS:localhost,IP:127.0.0.1`
  - DNs: node `CN=opensearch-node,O=MatchBox,C=US`; admin `CN=admin,O=MatchBox,C=US`
- `wazuh-dashboard-certs` (ns `wazuh`): `root-ca.pem`, `dashboard.pem`, `dashboard-key.pem`
- `opensearch-ca-cert` **ConfigMap** (ns `wazuh` and `opencti`): key `ca.crt` = the root-ca.pem (for upstream CA trust)
- `soc-auth-secret` (ns `kube-system`): key `users` = htpasswd bcrypt line(s) for Traefik basic-auth
- `soc-tls-cert` (ns `kube-system`): `kubernetes.io/tls` secret (`tls.crt`/`tls.key`) for ingress, CN `soc.homelab.local`
- `opensearch-grafana-auth` (ns `monitoring`): key `OPENSEARCH_PASSWORD` = value of `soc-shared-secrets/opensearch-password`

cert-manager is NOT used (keeps RAM at 0 for PKI). Provide it only as a documented optional upgrade if asked.

## 2. SOPS + age convention (lane: scripts owns tooling; lane k8s-rest-sec owns the secret manifest)

- Encrypted file: `k8s/shared/secrets.enc.yaml` (committable). Plain `k8s/shared/secrets.yaml` stays gitignored.
- `.sops.yaml` at repo root: `creation_rules` matching `k8s/shared/secrets.enc.yaml`, encrypt only `data` and `stringData` fields (`encrypted_regex: '^(data|stringData)$'`), recipient = age public key.
- `scripts/setup-sops.sh`: generate an age key to `${SOPS_AGE_KEY_FILE:-$HOME/.config/sops/age/keys.txt}` (OUTSIDE the repo) if absent, write its **public** recipient into `.sops.yaml`, then `sops --encrypt secrets.yaml > secrets.enc.yaml`.
- **Never generate or commit a private age key.** Agents create the tooling + docs; the owner runs `make secrets-init` to actually encrypt. Do NOT hand-encrypt in-agent (no sops binary, no key).
- `deploy-stack.sh` decrypts at apply time: `sops --decrypt k8s/shared/secrets.enc.yaml | kubectl apply -f -` (fail fast if `SOPS_AGE_KEY_FILE` missing).
- Add `secrets.yaml` (already), `*.agekey`, `keys.txt` to `.gitignore`.

## 3. Wazuh MCP endpoint fix (lane: mcp) — the critical correctness fix

The Server API (`WAZUH_API_URL`, :55000) is correct for `/agents`, `/agents/{id}`, `/rules`, `/decoders` — keep those.
It has **no** `/alerts`, `/alerts/{id}`, `/vulnerability/{id}`. Re-point those at the **Indexer**:
- New env: `WAZUH_INDEXER_URL` (default `https://localhost:9200`), `WAZUH_INDEXER_USER` (default `admin`), `WAZUH_INDEXER_PASSWORD`.
- `list-alerts`/`get-alert` → `POST {indexer}/wazuh-alerts-*/_search` (Basic auth) with a query DSL built from filters (level_min → `range rule.level >= n`, agent_id → `term agent.id`, rule_id → `term rule.id`, sort `@timestamp desc`, size=limit). `get-alert` → `_search` with `term _id`.
- `get-vulnerabilities` → `POST {indexer}/wazuh-states-vulnerabilities-*/_search` filtered by `agent.id` (+ optional severity).
- Add a tiny indexer client (Basic auth, reuse `fetchWithRetry`). Add Vitest contract tests asserting the request URL/body shape (no live cluster needed).

## 4. Dashboard TLS + auth fix (lane: dashboard)

- Delete `process.env.NODE_TLS_REJECT_UNAUTHORIZED='0'` from `vite.config.ts`; remove the line from `.env` and `.env.example`.
- Trust the SOC CA instead: read `NODE_EXTRA_CA_CERTS` (path to `root-ca.pem`) — document it; for per-fetch use a scoped `undici.Agent({connect:{ca}})` only on credentialed upstream calls. Never disable verification globally.
- Add `src/hooks.server.ts` enforcing auth on `/api/*` (shared bearer token from `SOC_API_TOKEN` env at minimum; 401 otherwise). Add a same-origin check.
- Move every hardcoded `localhost:3000/9000/9001/4000/5601` into `PUBLIC_*` env via `src/lib/config.ts`.

## 5. File lanes (disjoint — your write boundary)

| Lane | Owns (write only here) |
|---|---|
| **mcp** | `mcp-servers/**`, `.claude/settings.json`, NEW root `package.json` (npm workspaces: shared,wazuh-mcp,thehive-mcp,opencti-mcp,dashboard; scripts `build`/`test`/`lint`/`typecheck` via `--workspaces`) |
| **dashboard** | `dashboard/**` |
| **k8s-wazuh** | `k8s/wazuh/**`, `k8s/shared/opensearch.yaml`, `k8s/shared/opensearch-ca-cert.yaml`, `k8s/storage/**` |
| **k8s-rest-sec** | `k8s/thehive/**`, `k8s/opencti/**`, `k8s/monitoring/**`, `k8s/shared/{redis,rabbitmq,rabbitmq-deployment,minio,secrets,secrets.yaml.example}.yaml`, NEW `k8s/shared/secrets.enc.yaml`, `k8s/ingress/**`, `k8s/network-policies.yaml`, `k8s/namespaces.yaml` |
| **scripts** | `scripts/**`, `lima/**`, NEW `.sops.yaml`, `.gitignore`, root `.env.example` |
| **docs** | `*.md` (incl. `README.md`, `CLAUDE.md`), `docs/**` — EXCEPT do not write the new CHANGELOG release entry (synthesis compiles it). Fix existing drift only. |
| **ci-dx** | `.github/**`, NEW `Makefile`, `.nvmrc`, `biome.json`, `.editorconfig` (do NOT touch root `package.json` — mcp owns it; reference its script names) |

## 6. Helm-canonical cleanup (lane: k8s-rest-sec)

Delete the dead raw manifests that diverge from the wired Helm path: `k8s/thehive/deployment.yaml`,
`k8s/thehive/cortex/deployment.yaml` (if present), `k8s/opencti/deployment.yaml`,
`k8s/shared/rabbitmq-deployment.yaml`, and the empty `k8s/wazuh/indexer/` dir. The Helm values files become
the source of truth. On the Helm path fix: OpenCTI/TheHive/Cortex → `https://...:9200` + CA mount
(`opensearch-ca-cert` ConfigMap) + ES creds from `soc-shared-secrets`; OpenCTI inject `admin-token`;
pin all chart `--version`s and OpenCTI platform/worker image tag to one minor aligned with connectors.

## 7. Hardening baselines (k8s lanes)

- Namespace PSS labels: `restricted` for `shared`/`opencti`/`thehive`/`monitoring`; `privileged` only for `wazuh` (agent needs it).
- securityContext baseline where feasible: `seccompProfile: RuntimeDefault`, `capabilities.drop:[ALL]`, `runAsNonRoot:true`. Wazuh agent: replace `privileged:true` with scoped caps (`DAC_READ_SEARCH`), narrow hostPath from `/` to inspected dirs, keep what FIM/rootcheck truly need.
- Remove `optional:true` from the 4 Wazuh credential `secretKeyRef`s (fail closed).
- NetworkPolicy: add a rule admitting the node/host source (ipBlock) on 1514/1515 so `hostNetwork` agents can reach the manager.
- Persist `/var/ossec/etc` (or at least `client.keys`) on a PVC so agent identities survive restarts.

## 8. CHANGELOG / versions

Single version source going forward: `1.6.0` for this pass. Each lane reports its CHANGELOG bullets in its
structured result; the synthesis step compiles the `## [1.6.0]` entry. Docs lane fixes version drift to a
`docs/VERSIONS.md` table it creates (OpenCTI version, ports, NetworkPolicy count = actual, Wazuh 4.14.3).
