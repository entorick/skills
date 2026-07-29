/**
 * Install/uninstall agent-board hooks into detected CLI agents' configs.
 *
 *   codebuddy → ~/.codebuddy/settings.json  (hooks.Stop, command hook)
 *   claude    → ~/.claude/settings.json     (same shape)
 *   codex     → ~/.codex/config.toml        (notify program; no Stop equivalent)
 *
 * Original config files are backed up next to themselves (*.agent-board.bak)
 * before the first modification.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const SMART_STOP = path.join(__dirname, 'smart_stop.js');
export const CODEX_NOTIFY = path.join(__dirname, 'codex_notify.js');

const JSON_AGENTS = { codebuddy: '.codebuddy', claude: '.claude' };
const MARKER = 'agent-board'; // every line/command we inject contains this

function backupOnce(file) {
  const bak = `${file}.agent-board.bak`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

// ---------- settings.json agents (codebuddy / claude) ----------

function enableJsonAgent(home, agent) {
  const file = path.join(home, JSON_AGENTS[agent], 'settings.json');
  if (!fs.existsSync(path.dirname(file))) return { agent, changed: false, detail: 'config dir not found, skipped' };
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const command = `node ${SMART_STOP}`;
  if (JSON.stringify(settings.hooks || {}).includes(SMART_STOP)) {
    return { agent, changed: false, detail: 'already installed' };
  }
  backupOnce(file);
  settings.hooks = settings.hooks || {};
  settings.hooks.Stop = settings.hooks.Stop || [];
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command, timeout: 180 }] });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { agent, changed: true, detail: `Stop hook → ${command}` };
}

function disableJsonAgent(home, agent) {
  const file = path.join(home, JSON_AGENTS[agent], 'settings.json');
  if (!fs.existsSync(file)) return { agent, changed: false, detail: 'no settings.json' };
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stop = settings.hooks?.Stop;
  if (!Array.isArray(stop)) return { agent, changed: false, detail: 'no Stop hooks' };
  const kept = stop.filter((entry) => !JSON.stringify(entry).includes(SMART_STOP));
  if (kept.length === stop.length) return { agent, changed: false, detail: 'not installed' };
  backupOnce(file);
  if (kept.length) settings.hooks.Stop = kept;
  else delete settings.hooks.Stop;
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { agent, changed: true, detail: 'Stop hook removed' };
}

// ---------- codex (config.toml notify) ----------

function codexFile(home) {
  return path.join(home, '.codex', 'config.toml');
}

function enableCodex(home) {
  const file = codexFile(home);
  if (!fs.existsSync(path.dirname(file))) return { agent: 'codex', changed: false, detail: 'config dir not found, skipped' };
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.includes(CODEX_NOTIFY)) return { agent: 'codex', changed: false, detail: 'already installed' };
  if (/^notify\s*=/m.test(text)) {
    return { agent: 'codex', changed: false, detail: 'existing notify= found, refusing to overwrite — edit config.toml manually' };
  }
  backupOnce(file);
  fs.appendFileSync(file, `\n# ${MARKER}: dingtalk notification on turn complete\nnotify = ["node", "${CODEX_NOTIFY}"]\n`);
  return { agent: 'codex', changed: true, detail: 'notify program installed (codex 无 Stop hook，仅通知)' };
}

function disableCodex(home) {
  const file = codexFile(home);
  if (!fs.existsSync(file)) return { agent: 'codex', changed: false, detail: 'no config.toml' };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const kept = lines.filter((l) => !l.includes(MARKER) && !l.includes(CODEX_NOTIFY));
  if (kept.length === lines.length) return { agent: 'codex', changed: false, detail: 'not installed' };
  backupOnce(file);
  fs.writeFileSync(file, kept.join('\n'));
  return { agent: 'codex', changed: true, detail: 'notify program removed' };
}

// ---------- public API ----------

export function enableHooks({ home = os.homedir(), agents = null } = {}) {
  const targets = agents || [...Object.keys(JSON_AGENTS), 'codex'];
  return targets.map((agent) => {
    try {
      if (agent === 'codex') return enableCodex(home);
      if (JSON_AGENTS[agent]) return enableJsonAgent(home, agent);
      return { agent, changed: false, detail: 'unsupported agent' };
    } catch (err) {
      return { agent, changed: false, detail: `error: ${err.message}` };
    }
  });
}

export function disableHooks({ home = os.homedir(), agents = null } = {}) {
  const targets = agents || [...Object.keys(JSON_AGENTS), 'codex'];
  return targets.map((agent) => {
    try {
      if (agent === 'codex') return disableCodex(home);
      if (JSON_AGENTS[agent]) return disableJsonAgent(home, agent);
      return { agent, changed: false, detail: 'unsupported agent' };
    } catch (err) {
      return { agent, changed: false, detail: `error: ${err.message}` };
    }
  });
}
