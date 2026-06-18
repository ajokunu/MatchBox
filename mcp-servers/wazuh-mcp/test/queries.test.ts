import { describe, expect, it } from 'vitest';
import {
  buildGetAlertBody,
  buildListAlertsBody,
  buildVulnBody,
  isSafeWazuhSearch,
} from '../src/queries.js';

describe('wazuh list-alerts indexer _search body (Contract §3)', () => {
  it('defaults to match_all sorted by @timestamp desc', () => {
    const body = buildListAlertsBody({ limit: 20 });
    expect(body).toEqual({
      size: 20,
      sort: [{ '@timestamp': { order: 'desc' } }],
      query: { match_all: {} },
    });
  });

  it('level_min -> range rule.level >= n', () => {
    const body = buildListAlertsBody({ limit: 5, level_min: 7 });
    expect(body.query).toEqual({ bool: { must: [{ range: { 'rule.level': { gte: 7 } } }] } });
  });

  it('agent_id -> term agent.id, rule_id -> term rule.id', () => {
    const body = buildListAlertsBody({ limit: 5, agent_id: '001', rule_id: '5710' });
    expect(body.query).toEqual({
      bool: { must: [{ term: { 'agent.id': '001' } }, { term: { 'rule.id': '5710' } }] },
    });
  });

  it('keeps a level_min of 0 (no truthiness drop)', () => {
    const body = buildListAlertsBody({ limit: 5, level_min: 0 });
    expect(body.query).toEqual({ bool: { must: [{ range: { 'rule.level': { gte: 0 } } }] } });
  });
});

describe('wazuh get-alert indexer _search body', () => {
  it('matches the document _id', () => {
    expect(buildGetAlertBody('abc-123')).toEqual({ size: 1, query: { term: { _id: 'abc-123' } } });
  });
});

describe('wazuh search/group/name injection guard (finding 6)', () => {
  it('permits legitimate rule/decoder text the old whitelist rejected', () => {
    // Colons, commas-in-prose, brackets, '@', '+' all appear in real Wazuh
    // rule descriptions — the previous [\\w .\\-/]* filter wrongly blocked them.
    for (const ok of [
      'ssh authentication failure',
      'sshd: invalid user',
      'web|attack: SQLi attempt',
      'rule group: authentication_failed',
      'CVE-2024-1234 affecting nginx 1.25',
      'user@host login from 10.0.0.5',
    ]) {
      expect(isSafeWazuhSearch(ok)).toBe(true);
    }
  });

  it('rejects every Wazuh query-grammar operator (injection vectors)', () => {
    // ; , ( ) = < > ~ ! each carries structural meaning in the q/search grammar.
    for (const bad of [
      'level=10',
      'name=root;rule.id=5710',
      '(group,authentication)',
      'rule.level>5',
      'rule.level<3',
      'desc~admin',
      'status!=active',
      'a;b',
    ]) {
      expect(isSafeWazuhSearch(bad)).toBe(false);
    }
  });

  it('rejects backslash and control characters', () => {
    expect(isSafeWazuhSearch('foo\\bar')).toBe(false);
    expect(isSafeWazuhSearch('foo\nbar')).toBe(false);
    expect(isSafeWazuhSearch('foo\tbar')).toBe(false);
  });

  it('enforces the 256-char ceiling', () => {
    expect(isSafeWazuhSearch('a'.repeat(256))).toBe(true);
    expect(isSafeWazuhSearch('a'.repeat(257))).toBe(false);
  });
});

describe('wazuh get-vulnerabilities indexer _search body (Contract §3)', () => {
  it('filters by agent.id and sorts by severity desc', () => {
    const body = buildVulnBody({ agent_id: '001', limit: 10 });
    expect(body).toEqual({
      size: 10,
      sort: [{ 'vulnerability.severity': { order: 'desc' } }],
      query: { bool: { must: [{ term: { 'agent.id': '001' } }] } },
    });
  });

  it('adds the optional severity term', () => {
    const body = buildVulnBody({ agent_id: '001', severity: 'Critical', limit: 10 });
    expect((body.query as any).bool.must).toContainEqual({
      term: { 'vulnerability.severity': 'Critical' },
    });
  });
});
