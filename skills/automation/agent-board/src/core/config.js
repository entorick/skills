import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE_CONFIG = path.join(__dirname, '..', '..', 'config.example.json');

export const COLUMNS = ['todo', 'doing', 'review', 'done', 'failed'];

export function boardRoot() {
  return process.env.AGENT_BOARD_HOME || path.join(os.homedir(), 'agent-board');
}

export const DEFAULTS = {
  default_agent: 'codebuddy',
  poll_interval_sec: 10,
  retry: { max_attempts: 5, backoff_sec: [30, 60, 120, 240, 300], jitter: 0.15 },
  notify: {
    dingtalk_webhook: '',
    at_mobile: '',
    on_review: true,
    on_failed: true,
    on_session_stop: false,
  },
};

function deepMerge(base, override) {
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof base[k] === 'object') {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

/** Create ~/agent-board skeleton + default config on first run. Idempotent. */
export function ensureBoard(root = boardRoot()) {
  const created = !fs.existsSync(root);
  for (const d of [...COLUMNS, '.state']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  const cfgPath = path.join(root, 'config.json');
  let configCreated = false;
  if (!fs.existsSync(cfgPath)) {
    fs.copyFileSync(EXAMPLE_CONFIG, cfgPath);
    configCreated = true;
  }
  return { root, created, configCreated, configPath: cfgPath };
}

export function loadConfig(root = boardRoot()) {
  const cfgPath = path.join(root, 'config.json');
  let user = {};
  if (fs.existsSync(cfgPath)) {
    user = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  }
  return deepMerge(structuredClone(DEFAULTS), user);
}
