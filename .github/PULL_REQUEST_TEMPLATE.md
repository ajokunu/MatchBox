## Summary

<!-- Brief description of what this PR does -->

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
- [ ] Scripts
- [ ] Documentation

## Testing

<!-- How was this tested? -->

- [ ] `./scripts/test-flow.sh` passes
- [ ] `kubectl get pods --all-namespaces` — all pods Running
- [ ] MCP servers build cleanly (`npm run build`)

## Checklist

- [ ] Changes logged in `CHANGELOG.md`
- [ ] No secrets or credentials in code
- [ ] Resource limits set on new pods
- [ ] Container images pinned to specific tags
