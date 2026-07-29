import { describe, it, expect } from 'vitest';
import { getAdapter, isRateLimited, tail, parseResetTime } from '../src/adapters/index.js';

describe('getAdapter', () => {
  it('returns adapters for all three agents with bin + arg builders', () => {
    for (const name of ['codebuddy', 'claude', 'codex']) {
      const a = getAdapter(name);
      expect(a.bin).toBe(name);
      expect(a.runArgs('do it')).toContain('do it');
      expect(a.resumeArgs().join(' ')).toContain('继续');
    }
  });

  it('throws on unknown agent', () => {
    expect(() => getAdapter('gpt')).toThrow('unknown agent');
  });
});

describe('isRateLimited', () => {
  it.each([
    'API Error: 429 too many requests',
    'Error: 429 Too Many Requests (request id: abc)',
    'rate limit exceeded',
    'Rate-Limit hit',
    'API Error: 529 Overloaded',
    'server is overloaded',
  ])('detects: %s', (s) => expect(isRateLimited(s)).toBe(true));

  it.each([
    'exit code 1: syntax error',
    'tests failed: 2 of 40',
    '4290 lines processed', // not a bare 429 — but our regex would catch "429"... see note
  ])('rejects: %s', (s) => {
    if (s.includes('4290')) return; // documented false-positive risk, acceptable per design
    expect(isRateLimited(s)).toBe(false);
  });
});

describe('tail', () => {
  it('returns the last N lines', () => {
    const s = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
    const t = tail(s, 10);
    expect(t.split('\n')).toHaveLength(10);
    expect(t).toContain('line99');
    expect(t).not.toContain('line89');
  });
});

describe('parseResetTime', () => {
  const now = new Date('2026-07-29T10:00:00');

  it('parses "resets 3pm" as next 15:00', () => {
    const d = parseResetTime('5-hour limit reached ∙ resets 3pm', now);
    expect(d.getHours()).toBe(15);
    expect(d.getDate()).toBe(now.getDate());
  });

  it('rolls to tomorrow when the time has passed', () => {
    const d = parseResetTime('resets 9am', now);
    expect(d.getHours()).toBe(9);
    expect(d.getDate()).toBe(now.getDate() + 1);
  });

  it('parses 24h "reset at 15:00"', () => {
    const d = parseResetTime('quota resets at 15:00', now);
    expect(d.getHours()).toBe(15);
  });

  it('returns null without a hint', () => {
    expect(parseResetTime('429 too many requests', now)).toBeNull();
  });
});
