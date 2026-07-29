import codebuddy from './codebuddy.js';
import claude from './claude.js';
import codex from './codex.js';

const adapters = { codebuddy, claude, codex };

export function getAdapter(name) {
  const a = adapters[name];
  if (!a) throw new Error(`unknown agent: ${name} (expected one of ${Object.keys(adapters).join(', ')})`);
  return a;
}

export const RATE_LIMIT_RE = /429|too many requests|rate.?limit|overloaded|\b529\b/i;

export function isRateLimited(output) {
  return RATE_LIMIT_RE.test(output);
}

export function tail(str, lines = 50) {
  return String(str).split('\n').slice(-lines).join('\n');
}

/**
 * Parse "resets 3pm" / "reset at 15:00" style hints into the next future Date.
 * Returns null when no hint is present.
 */
export function parseResetTime(output, now = new Date()) {
  const m = String(output).match(/resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0);
  const ap = m[3]?.toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const d = new Date(now);
  d.setHours(h, min, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d;
}
