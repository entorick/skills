import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureBoard, loadConfig, COLUMNS, DEFAULTS } from '../src/core/config.js';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('ensureBoard', () => {
  it('creates all columns, .state, and default config on first run', () => {
    const r = ensureBoard(root);
    expect(r.created).toBe(false); // mkdtemp already created root
    expect(r.configCreated).toBe(true);
    for (const col of [...COLUMNS, '.state']) {
      expect(fs.statSync(path.join(root, col)).isDirectory()).toBe(true);
    }
    expect(fs.existsSync(path.join(root, 'config.json'))).toBe(true);
  });

  it('is idempotent and never overwrites an existing config', () => {
    ensureBoard(root);
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ default_agent: 'claude' }));
    const r = ensureBoard(root);
    expect(r.configCreated).toBe(false);
    expect(loadConfig(root).default_agent).toBe('claude');
  });
});

describe('loadConfig', () => {
  it('returns defaults when no config.json exists', () => {
    expect(loadConfig(root)).toEqual(DEFAULTS);
  });

  it('deep-merges user config over defaults', () => {
    fs.writeFileSync(
      path.join(root, 'config.json'),
      JSON.stringify({ retry: { max_attempts: 3 }, notify: { at_mobile: '138' } })
    );
    const cfg = loadConfig(root);
    expect(cfg.retry.max_attempts).toBe(3);
    expect(cfg.retry.backoff_sec).toEqual(DEFAULTS.retry.backoff_sec); // untouched
    expect(cfg.notify.at_mobile).toBe('138');
    expect(cfg.notify.on_failed).toBe(true); // default preserved
  });
});
