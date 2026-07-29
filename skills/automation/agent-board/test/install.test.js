import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { enableHooks, disableHooks, SMART_STOP, CODEX_NOTIFY } from '../src/hooks/install.js';

let home;
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-home-'));
  fs.mkdirSync(path.join(home, '.codebuddy'), { recursive: true });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codebuddy', 'settings.json'), JSON.stringify({ model: 'kimi-k3-2' }, null, 2));
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ includeCoAuthoredBy: false }));
});
afterEach(() => {
  fs.rmSync(home, { recursive: true, force: true });
});

const readSettings = (agent) => JSON.parse(fs.readFileSync(path.join(home, agent, 'settings.json'), 'utf8'));

describe('enableHooks (settings.json agents)', () => {
  it('adds a Stop command hook while preserving existing settings', () => {
    const [r] = enableHooks({ home, agents: ['codebuddy'] });
    expect(r.changed).toBe(true);
    const s = readSettings('.codebuddy');
    expect(s.model).toBe('kimi-k3-2'); // preserved
    const cmd = s.hooks.Stop[0].hooks[0];
    expect(cmd.type).toBe('command');
    expect(cmd.command).toContain('smart_stop.js');
  });

  it('is idempotent', () => {
    enableHooks({ home, agents: ['claude'] });
    const [r2] = enableHooks({ home, agents: ['claude'] });
    expect(r2.changed).toBe(false);
    expect(readSettings('.claude').hooks.Stop).toHaveLength(1);
  });

  it('backs up the original file before first modification', () => {
    enableHooks({ home, agents: ['codebuddy'] });
    const bak = path.join(home, '.codebuddy', 'settings.json.agent-board.bak');
    expect(fs.existsSync(bak)).toBe(true);
    expect(JSON.parse(fs.readFileSync(bak, 'utf8'))).toEqual({ model: 'kimi-k3-2' });
  });

  it('skips agents whose config dir is missing', () => {
    fs.rmSync(path.join(home, '.claude'), { recursive: true });
    const [r] = enableHooks({ home, agents: ['claude'] });
    expect(r.changed).toBe(false);
    expect(r.detail).toContain('skipped');
  });
});

describe('disableHooks (settings.json agents)', () => {
  it('removes only our hook and cleans up empty structures', () => {
    enableHooks({ home, agents: ['codebuddy'] });
    const [r] = disableHooks({ home, agents: ['codebuddy'] });
    expect(r.changed).toBe(true);
    const s = readSettings('.codebuddy');
    expect(s.hooks).toBeUndefined();
    expect(s.model).toBe('kimi-k3-2');
  });

  it('keeps unrelated Stop hooks', () => {
    const file = path.join(home, '.claude', 'settings.json');
    const s = readSettings('.claude');
    s.hooks = { Stop: [{ hooks: [{ type: 'command', command: 'echo other' }] }] };
    fs.writeFileSync(file, JSON.stringify(s));
    enableHooks({ home, agents: ['claude'] });
    disableHooks({ home, agents: ['claude'] });
    const after = readSettings('.claude');
    expect(after.hooks.Stop).toHaveLength(1);
    expect(after.hooks.Stop[0].hooks[0].command).toBe('echo other');
  });
});

describe('codex (config.toml notify)', () => {
  it('appends a notify line and removes it cleanly', () => {
    const file = path.join(home, '.codex', 'config.toml');
    fs.writeFileSync(file, 'model = "gpt-5"\n');
    const [en] = enableHooks({ home, agents: ['codex'] });
    expect(en.changed).toBe(true);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('model = "gpt-5"');
    expect(text).toContain(CODEX_NOTIFY);
    const [dis] = disableHooks({ home, agents: ['codex'] });
    expect(dis.changed).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).not.toContain(CODEX_NOTIFY);
  });

  it('refuses to overwrite an existing notify= setting', () => {
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'notify = ["say", "hi"]\n');
    const [r] = enableHooks({ home, agents: ['codex'] });
    expect(r.changed).toBe(false);
    expect(r.detail).toContain('refusing');
  });
});
