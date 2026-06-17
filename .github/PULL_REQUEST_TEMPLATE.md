## Summary

<!-- Brief description of what this PR does and why -->

## Changes

<!-- Bullet list of changes -->

-

## Component(s) Affected

- [ ] Wazuh (Manager/Dashboard/Agent)
- [ ] OpenCTI
- [ ] TheHive / Cortex
- [ ] Shared Infrastructure (OpenSearch/Redis/RabbitMQ/MinIO)
- [ ] Monitoring (Grafana/Prometheus)
- [ ] MCP Servers
- [ ] Dashboard
- [ ] Scripts / CI / Dev tooling
- [ ] Documentation

## Verification

CI (`.github/workflows/ci.yml`) runs automatically and gates this PR:
shellcheck, kubeconform on manifests, `helm template | kubeconform`, gitleaks,
the Node workspace build/typecheck/test matrix, and svelte-check on the dashboard.

Please confirm anything CI cannot check from the runner:

- [ ] Applied to a live cluster (`make deploy`) or N/A — manifests-only change
- [ ] `make test` (end-to-end pipeline) passes against a running stack, or N/A
- [ ] New/changed pods come up `Running` and stay healthy

<!-- Note anything reviewers should know that the automated checks don't cover. -->

## Release hygiene

- [ ] `CHANGELOG.md` updated
- [ ] No plaintext secrets/credentials added (gitleaks enforces this; real secrets go in `secrets.enc.yaml` via SOPS)
- [ ] Resource limits set on any new pods
- [ ] Container images pinned to specific tags (no `:latest`)
