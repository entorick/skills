import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureBoard, loadConfig, DEFAULTS } from '../src/core/config.js';
import { addCard, getCard, moveCard } from '../src/core/board.js';
import { processNext, backoffMs } from '../src/dispatcher.js';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
  ensureBoard(root);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const cfg = (over = {}) => {
  const c = structuredClone(DEFAULTS);
  c.retry.max_attempts = 3;
  return { ...c, ...over };
};
const noSleep = async () => {};
const mkRunner = (script) => {
  const calls = [];
  let i = 0;
  const runner = (adapter, args, cwd) => {
    calls.push({ adapter: adapter.name, args, cwd });
    return script[Math.min(i++, script.length - 1)];
  };
  return { runner, calls };
};

describe('processNext', () => {
  it('returns handled=false when todo is empty', async () => {
    const r = await processNext(root, cfg());
    expect(r.handled).toBe(false);
  });

  it('success: todo → doing → review in one attempt', async () => {
    const card = addCard(root, { title: 'ok task', cwd: '/tmp', body: 'do it' });
    const { runner, calls } = mkRunner([{ code: 0, output: 'done' }]);
    const r = await processNext(root, cfg(), { runner, sleep: noSleep });
    expect(r.result).toBe('review');
    expect(r.attempts).toBe(1);
    expect(getCard(root, card.id).status).toBe('review');
    expect(calls[0].cwd).toBe('/tmp');
    expect(calls[0].args).toContain('do it'); // body used as prompt
  });

  it('429 then success: retries with resume args and backoff', async () => {
    const card = addCard(root, { title: 'flaky', cwd: '/tmp' });
    const { runner, calls } = mkRunner([
      { code: 1, output: 'API Error: 429 too many requests' },
      { code: 0, output: 'ok' },
    ]);
    const waits = [];
    const r = await processNext(root, cfg(), { runner, sleep: async (ms) => waits.push(ms) });
    expect(r.result).toBe('review');
    expect(r.attempts).toBe(2);
    expect(getCard(root, card.id).attempts).toBe(2);
    expect(calls[1].args.join(' ')).toContain('继续'); // resume, not fresh prompt
    expect(waits).toHaveLength(1);
    expect(waits[0]).toBeGreaterThan(0);
    expect(getCard(root, card.id).body).toContain('rate-limit');
  });

  it('429 exhaustion: → failed after max_attempts', async () => {
    const card = addCard(root, { title: 'always limited', cwd: '/tmp' });
    const { runner } = mkRunner([{ code: 1, output: '429 too many requests' }]);
    const r = await processNext(root, cfg(), { runner, sleep: noSleep });
    expect(r.result).toBe('failed');
    expect(r.attempts).toBe(3); // cfg.retry.max_attempts
    expect(getCard(root, card.id).status).toBe('failed');
  });

  it('non-rate-limit error: at most 2 attempts then failed', async () => {
    const card = addCard(root, { title: 'broken', cwd: '/tmp' });
    const { runner, calls } = mkRunner([{ code: 1, output: 'syntax error near line 3' }]);
    const r = await processNext(root, cfg(), { runner, sleep: noSleep });
    expect(r.result).toBe('failed');
    expect(calls).toHaveLength(2);
  });

  it('missing cwd: straight to failed without running', async () => {
    const card = addCard(root, { title: 'no dir', cwd: '/nonexistent-dir-xyz' });
    const { runner, calls } = mkRunner([{ code: 0, output: '' }]);
    const r = await processNext(root, cfg(), { runner, sleep: noSleep });
    expect(r.result).toBe('failed');
    expect(calls).toHaveLength(0);
    expect(getCard(root, card.id).body).toContain('cwd not found');
  });

  it('unknown agent: straight to failed', async () => {
    const card = addCard(root, { title: 'bad agent', cwd: '/tmp', agent: 'gpt' });
    const r = await processNext(root, cfg(), { runner: mkRunner([]).runner, sleep: noSleep });
    expect(r.result).toBe('failed');
    expect(getCard(root, card.id).status).toBe('failed');
  });

  it('resumes from persisted attempts after restart (requeue flow)', async () => {
    const card = addCard(root, { title: 'resumable', cwd: '/tmp' });
    moveCard(root, card.id, 'doing', 'claimed');
    // simulate crash: attempts persisted at 2
    const { updateCard } = await import('../src/core/board.js');
    updateCard(root, card.id, { attempts: 2 });
    moveCard(root, card.id, 'todo', 'dispatcher restart, requeue');
    const { runner } = mkRunner([{ code: 1, output: '429 too many requests' }]);
    const r = await processNext(root, cfg(), { runner, sleep: noSleep });
    expect(r.result).toBe('failed'); // attempt 3 = max
    expect(r.attempts).toBe(3);
  });
});

describe('backoffMs', () => {
  it('follows configured sequence and caps at the last value', () => {
    const c = cfg();
    c.retry.jitter = 0;
    expect(backoffMs(c, 1)).toBe(30_000);
    expect(backoffMs(c, 2)).toBe(60_000);
    expect(backoffMs(c, 5)).toBe(300_000);
    expect(backoffMs(c, 99)).toBe(300_000);
  });

  it('applies jitter within ±15%', () => {
    const c = cfg();
    for (let i = 0; i < 50; i++) {
      const v = backoffMs(c, 1);
      expect(v).toBeGreaterThanOrEqual(30_000 * 0.85);
      expect(v).toBeLessThanOrEqual(30_000 * 1.15);
    }
  });
});
