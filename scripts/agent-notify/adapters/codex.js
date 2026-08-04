/**
 * Adapter for codex (~/.codex/config.toml). Codex has no Stop hook; it calls a
 * `notify` program with a JSON payload when a turn finishes. We append one.
 */
import fs from 'node:fs';
import path from 'node:path';

const MARKER = 'agent-notify';

export function codexFile(home) {
  return path.join(home, '.codex', 'config.toml');
}

export function detect(home) {
  return fs.existsSync(path.dirname(codexFile(home))) ? ['codex'] : [];
}

function backupOnce(file) {
  const bak = `${file}.${MARKER}.bak`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

export function enable(home, notifyPath) {
  const file = codexFile(home);
  if (!fs.existsSync(path.dirname(file))) {
    return { agent: 'codex', changed: false, detail: 'config dir not found, skipped' };
  }
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.includes(notifyPath)) return { agent: 'codex', changed: false, detail: 'already installed' };
  if (/^notify\s*=/m.test(text)) {
    return { agent: 'codex', changed: false, detail: 'existing notify= found, refusing to overwrite — edit config.toml manually' };
  }
  backupOnce(file);
  fs.appendFileSync(
    file,
    `\n# ${MARKER}: dingtalk notification on turn complete\nnotify = ["node", "${notifyPath}"]\n`
  );
  return { agent: 'codex', changed: true, detail: 'notify program installed' };
}

export function disable(home, notifyPath) {
  const file = codexFile(home);
  if (!fs.existsSync(file)) return { agent: 'codex', changed: false, detail: 'no config.toml' };
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const kept = lines.filter((l) => !l.includes(MARKER) && !l.includes(notifyPath));
  if (kept.length === lines.length) return { agent: 'codex', changed: false, detail: 'not installed' };
  backupOnce(file);
  fs.writeFileSync(file, kept.join('\n'));
  return { agent: 'codex', changed: true, detail: 'notify program removed' };
}
