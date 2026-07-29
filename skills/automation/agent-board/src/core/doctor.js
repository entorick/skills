import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { boardRoot, loadConfig } from './config.js';

export const AGENTS = ['codebuddy', 'claude', 'codex'];

const AGENT_CONFIG_DIRS = {
  codebuddy: '.codebuddy',
  claude: '.claude',
  codex: '.codex',
};

function which(cmd) {
  try {
    return execSync(`which ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Environment probe: node/npm, CLI agents, board dir, webhook config.
 * Each check: { name, level: 'required'|'optional', ok, detail }
 */
export function runDoctor(root = boardRoot()) {
  const checks = [];
  const add = (name, level, ok, detail) => checks.push({ name, level, ok: !!ok, detail: String(detail) });

  add('node', 'required', process.version, process.version);

  let npmVersion = null;
  try {
    npmVersion = execSync('npm -v', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch { /* not found */ }
  add('npm', 'required', npmVersion, npmVersion || 'not found');

  for (const agent of AGENTS) {
    const binPath = which(agent);
    const cfgDir = path.join(os.homedir(), AGENT_CONFIG_DIRS[agent]);
    const cfgExists = fs.existsSync(cfgDir);
    const detail = binPath ? `${binPath}${cfgExists ? ' (config dir ok)' : ' (no config dir)'}` : 'not found';
    add(`agent:${agent}`, 'optional', binPath, detail);
  }

  add('board', 'required', fs.existsSync(root), root);

  const webhook = loadConfig(root).notify.dingtalk_webhook;
  add('webhook', 'optional', webhook, webhook ? 'configured' : `not configured — edit ${path.join(root, 'config.json')}`);

  return { ok: checks.filter((c) => c.level === 'required').every((c) => c.ok), checks };
}
