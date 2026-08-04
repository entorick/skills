/**
 * Adapter for agents configured via ~/.<agent>/settings.json hooks.Stop:
 * codebuddy and claude. Injects a Stop hook that runs notify.js.
 */
import fs from 'node:fs';
import path from 'node:path';

export const JSON_AGENTS = {
  codebuddy: { dir: '.codebuddy', name: 'codebuddy' },
  claude: { dir: '.claude', name: 'claude' },
};

const MARKER = 'agent-notify';

export function settingsPath(home, agent) {
  return path.join(home, JSON_AGENTS[agent].dir, 'settings.json');
}

function backupOnce(file) {
  const bak = `${file}.${MARKER}.bak`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

/** Build the Stop-hook command that triggers notify.js. */
export function hookCommand(notifyPath, agent) {
  return `node ${notifyPath} --agent ${agent}`;
}

export function detect(home) {
  return Object.keys(JSON_AGENTS).filter((a) =>
    fs.existsSync(path.join(home, JSON_AGENTS[a].dir, 'settings.json'))
  );
}

export function enable(home, agent, notifyPath) {
  const file = settingsPath(home, agent);
  if (!fs.existsSync(path.dirname(file))) {
    return { agent, changed: false, detail: 'config dir not found, skipped' };
  }
  const settings = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const command = hookCommand(notifyPath, agent);
  const stop = settings.hooks?.Stop;
  if (Array.isArray(stop) && JSON.stringify(stop).includes(command)) {
    return { agent, changed: false, detail: 'already installed' };
  }
  backupOnce(file);
  settings.hooks = settings.hooks || {};
  settings.hooks.Stop = settings.hooks.Stop || [];
  settings.hooks.Stop.push({ hooks: [{ type: 'command', command, timeout: 30 }] });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { agent, changed: true, detail: `Stop hook → ${command}` };
}

export function disable(home, agent, notifyPath) {
  const file = settingsPath(home, agent);
  if (!fs.existsSync(file)) return { agent, changed: false, detail: 'no settings.json' };
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  const stop = settings.hooks?.Stop;
  if (!Array.isArray(stop)) return { agent, changed: false, detail: 'no Stop hooks' };
  const command = hookCommand(notifyPath, agent);
  const kept = stop.filter((entry) => !JSON.stringify(entry).includes(command));
  if (kept.length === stop.length) return { agent, changed: false, detail: 'not installed' };
  backupOnce(file);
  if (kept.length) settings.hooks.Stop = kept;
  else delete settings.hooks.Stop;
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks;
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { agent, changed: true, detail: 'Stop hook removed' };
}
