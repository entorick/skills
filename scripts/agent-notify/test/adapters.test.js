import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as jsonSettings from '../adapters/json-settings.js';
import * as codex from '../adapters/codex.js';
import * as opencode from '../adapters/opencode.js';

function makeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notify-home-'));
}

test('json-settings: enable injects Stop hook, disable removes it', () => {
  const home = makeHome();
  fs.mkdirSync(path.join(home, '.codebuddy'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codebuddy', 'settings.json'), JSON.stringify({ model: 'x' }));

  const notifyPath = '/repo/scripts/agent-notify/notify.js';
  const r1 = jsonSettings.enable(home, 'codebuddy', notifyPath);
  assert.equal(r1.changed, true);

  const settings = JSON.parse(fs.readFileSync(path.join(home, '.codebuddy', 'settings.json'), 'utf8'));
  assert.equal(settings.hooks.Stop[0].hooks[0].command, `node ${notifyPath} --agent codebuddy`);
  assert.ok(settings.model === 'x', 'existing settings preserved');

  // idempotent
  const r2 = jsonSettings.enable(home, 'codebuddy', notifyPath);
  assert.equal(r2.changed, false);

  const rd = jsonSettings.disable(home, 'codebuddy', notifyPath);
  assert.equal(rd.changed, true);
  const after = JSON.parse(fs.readFileSync(path.join(home, '.codebuddy', 'settings.json'), 'utf8'));
  assert.equal(after.hooks?.Stop, undefined);
});

test('json-settings: backup created on first change', () => {
  const home = makeHome();
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ a: 1 }));
  jsonSettings.enable(home, 'claude', '/p/notify.js');
  assert.ok(fs.existsSync(path.join(home, '.claude', 'settings.json.agent-notify.bak')));
});

test('json-settings: skips agent with no config dir', () => {
  const home = makeHome();
  const r = jsonSettings.enable(home, 'claude', '/p/notify.js');
  assert.equal(r.changed, false);
  assert.match(r.detail, /skipped/);
});

test('codex: enable appends notify= line, disable removes it', () => {
  const home = makeHome();
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  const file = path.join(home, '.codex', 'config.toml');
  fs.writeFileSync(file, 'requires_openai_auth = true\n');

  const notifyPath = '/repo/notify.js';
  const r1 = codex.enable(home, notifyPath);
  assert.equal(r1.changed, true);
  assert.ok(fs.readFileSync(file, 'utf8').includes(`notify = ["node", "${notifyPath}"]`));

  const r2 = codex.disable(home, notifyPath);
  assert.equal(r2.changed, true);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('notify'));
});

test('codex: refuses to overwrite existing notify=', () => {
  const home = makeHome();
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'config.toml'), 'notify = ["echo", "hi"]\n');
  const r = codex.enable(home, '/repo/notify.js');
  assert.equal(r.changed, false);
  assert.match(r.detail, /refusing/);
});

test('opencode: writes plugin with notify path, disable removes it', () => {
  const home = makeHome();
  fs.mkdirSync(path.join(home, '.config', 'opencode', 'plugins'), { recursive: true });
  const notifyPath = '/repo/notify.js';
  const r1 = opencode.enable(home, notifyPath);
  assert.equal(r1.changed, true);
  const file = opencode.pluginPath(home);
  assert.ok(fs.existsSync(file));
  const src = fs.readFileSync(file, 'utf8');
  assert.ok(src.includes('session.idle'));
  assert.ok(src.includes(notifyPath));

  const r2 = opencode.disable(home, notifyPath);
  assert.equal(r2.changed, true);
  assert.ok(!fs.existsSync(file));
});

test('opencode: skips when plugin dir absent', () => {
  const home = makeHome();
  const r = opencode.enable(home, '/repo/notify.js');
  assert.equal(r.changed, false);
  assert.match(r.detail, /skipped/);
});
