#!/usr/bin/env node
/**
 * Codex `notify` program: called with a JSON payload when a turn completes.
 * Codex has no Stop-hook equivalent (cannot block/resume), so this only
 * forwards a dingtalk notification. Installed via `agent-board hooks enable`.
 */
import { pathToFileURL } from 'node:url';
import { ensureBoard, loadConfig, boardRoot } from '../core/config.js';
import { sendDingtalk } from '../notify.js';

export async function run(payload) {
  const root = boardRoot();
  ensureBoard(root);
  const cfg = loadConfig(root);
  if (!cfg.notify.on_session_stop) return;
  const msg = String(payload?.['last-assistant-message'] || payload?.message || '').slice(0, 200);
  await sendDingtalk(cfg, `[agent-board] codex 回合结束${msg ? `\n${msg}` : ''}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let payload = {};
  try {
    payload = JSON.parse(process.argv[2] || '{}');
  } catch { /* tolerate */ }
  run(payload).catch(() => process.exit(0));
}
