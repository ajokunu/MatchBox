# MatchBox SOC — developer-experience entrypoint.
#
# Thin wrappers around the real workflows (scripts/*.sh + npm workspaces) so the
# common operations are discoverable and consistent. Run `make` or `make help`
# for the menu. Targets shell out to the canonical scripts — they do not
# reimplement logic, so the scripts stay the single source of truth.

# Use bash with strict flags for every recipe (fail fast on errors/unset vars).
SHELL := bash
.SHELLFLAGS := -euo pipefail -c
.ONESHELL:
.DEFAULT_GOAL := help

# Resolve repo paths relative to this Makefile so targets work from any CWD.
ROOT_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
SCRIPTS  := $(ROOT_DIR)/scripts

.PHONY: help up down deploy teardown test lint build certs secrets-init ci

## help: list available targets
help:
	@echo "MatchBox SOC — make targets"
	@echo ""
	@grep -E '^## ' $(MAKEFILE_LIST) | sed -e 's/## //' | awk -F': ' '{ printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2 }'
	@echo ""

## up: start the Lima VM + k3s cluster (creates it on first run)
up:
	"$(SCRIPTS)/setup-lima.sh"

## down: stop the Lima VM (keeps the disk; use `teardown vm` to delete)
down:
	limactl stop k3s-soc

## build: install workspaces and build all MCP packages (shared first) + dashboard
build:
	npm ci
	# Build @matchbox/mcp-shared before its consumers so the file: dep resolves.
	npm run build --workspace @matchbox/mcp-shared
	npm run build --workspaces --if-present

## certs: generate the OpenSearch/Wazuh/Traefik TLS material (openssl, 0 RAM)
certs:
	"$(SCRIPTS)/generate-certs.sh"

## secrets-init: bootstrap SOPS+age and encrypt k8s/shared/secrets.yaml
secrets-init:
	"$(SCRIPTS)/setup-sops.sh"

## deploy: deploy the full SOC stack to k3s (make deploy COMPONENT=wazuh for one)
deploy:
	"$(SCRIPTS)/deploy-stack.sh" $(COMPONENT)

## teardown: remove SOC resources (make teardown COMPONENT=all|vm|<component>)
teardown:
	"$(SCRIPTS)/teardown.sh" $(COMPONENT)

## test: run the end-to-end pipeline test against the running cluster
test:
	"$(SCRIPTS)/test-flow.sh"

## lint: lint/format-check all TypeScript + Svelte workspaces (Biome)
lint:
	npm run lint --workspaces --if-present

## ci: run the local equivalent of CI — build, typecheck, lint, and tests
ci: build
	npm run typecheck --workspaces --if-present
	npm run lint --workspaces --if-present
	npm run test --workspaces --if-present
