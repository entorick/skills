import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureBoard } from '../src/core/config.js';
import { runDoctor, AGENTS } from '../src/core/doctor.js';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('runDoctor', () => {
  it('returns structured checks with name/level/ok/detail', () => {
    const { checks } = runDoctor(root);
    const names = checks.map((c) => c.name);
    expect(names).toContain('node');
    expect(names).toContain('npm');
    expect(names).toContain('board');
    expect(names).toContain('webhook');
    for (const a of AGENTS) expect(names).toContain(`agent:${a}`);
    for (const c of checks) {
      expect(typeof c.ok).toBe('boolean');
      expect(typeof c.detail).toBe('string');
      expect(['required', 'optional']).toContain(c.level);
    }
  });

  it('board check flips to ok after ensureBoard', () => {
    const before = runDoctor(root).checks.find((c) => c.name === 'board');
    expect(before.ok).toBe(true); // mkdtemp created it; root exists but empty
    fs.rmSync(root, { recursive: true });
    const missing = runDoctor(root).checks.find((c) => c.name === 'board');
    expect(missing.ok).toBe(false);
    ensureBoard(root);
    const after = runDoctor(root).checks.find((c) => c.name === 'board');
    expect(after.ok).toBe(true);
  });

  it('webhook check reflects config state', () => {
    ensureBoard(root);
    expect(runDoctor(root).checks.find((c) => c.name === 'webhook').ok).toBe(false);
    fs.writeFileSync(
      path.join(root, 'config.json'),
      JSON.stringify({ notify: { dingtalk_webhook: 'https://oapi.dingtalk.com/x' } })
    );
    expect(runDoctor(root).checks.find((c) => c.name === 'webhook').ok).toBe(true);
  });
});
