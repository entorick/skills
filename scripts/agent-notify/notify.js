#!/usr/bin/env node
/**
 * agent-notify — DingTalk completion notifier.
 *
 * Single entry point used by every CLI agent's hook/notify mechanism. Reads the
 * DingTalk webhook from ~/agent-board/config.json (notify section) and posts a
 * one-line "session finished" message.
 *
 * Input (agent-dependent):
 *   - codebuddy / claude : Stop hook, stdin JSON {session_id, transcript_path, ...}
 *   - codex              : argv[2] JSON payload from the `notify` program
 *   - opencode           : argv flags --agent opencode --session <id> from the plugin
 *   - cli test           : --agent <name> --session <id> --test
 *
 * Hooks must never crash the host agent: every failure is swallowed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CONFIG_PATH = path.join(os.homedir(), 'agent-board', 'config.json');

/** Load just the notify section of the legacy agent-board config. */
export function loadNotify(cfgPath = CONFIG_PATH) {
  try {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const n = cfg.notify || {};
    if (!n.dingtalk_webhook) return null;
    return {
      dingtalk_webhook: n.dingtalk_webhook,
      at_mobile: n.at_mobile || '',
      keyword: n.keyword || '',
    };
  } catch {
    return null;
  }
}

/** Build the DingTalk text-message payload, honoring the security keyword. */
export function buildPayload(notify, text) {
  const content = notify.keyword && !text.includes(notify.keyword)
    ? `${notify.keyword} ${text}`
    : text;
  return {
    msgtype: 'text',
    text: { content },
    at: { atMobiles: notify.at_mobile ? [notify.at_mobile] : [], isAtAll: false },
  };
}

/** POST to the DingTalk webhook. Returns {ok, status, body} — never throws. */
export async function sendDingtalk(notify, text) {
  try {
    const res = await fetch(notify.dingtalk_webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(notify, text)),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.errcode === 0, status: res.status, body };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function shortId(id) {
  return id ? String(id).slice(0, 8) : '?';
}

/** Extract the text of a single assistant content block, whatever its shape. */
export function contentText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === 'string' ? b : b?.text || b?.content || ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Read the tail of a transcript (codebuddy/claude jsonl) and return the last
 * assistant reply text, or null.
 *
 * codebuddy: {"type":"message","role":"assistant","content":[{"type":"output_text","text":...}]}
 * claude:    {"type":"assistant","message":{"content":[{"type":"text","text":...}]}}
 *
 * Only considers completed assistant turns; scan backwards so the final reply
 * wins even if trailing function_call lines follow it.
 */
export function extractLastReply(transcriptPath, { maxLines = 60, log = () => {} } = {}) {
  if (!transcriptPath) return null;
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, 'utf8').trim().split('\n').slice(-maxLines);
  } catch (err) {
    log(`transcript unreadable: ${err.message}`);
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let d;
    try {
      d = JSON.parse(line);
    } catch { continue; }
    if (d.type === 'message' && d.role === 'assistant' && d.status === 'completed') {
      const text = contentText(d.content).trim();
      if (text) return text;
    }
    if (d.type === 'assistant' && d.message?.content) {
      const text = contentText(d.message.content).trim();
      if (text) return text;
    }
  }
  return null;
}

/** Cap the reply to fit a phone notification. */
export function truncate(text, max = 200) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * Parse the session identity from agent-specific input.
 * Returns {agent, session, transcriptPath, lastReply} or null.
 */
export function parseInput({ argv = process.argv.slice(2), stdin = '' } = {}) {
  const getFlag = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : undefined;
  };

  const agent = getFlag('--agent');
  const session = getFlag('--session');
  const isTest = argv.includes('--test');

  // codex: JSON payload passed as a bare argv position.
  for (const a of argv) {
    if (a.startsWith('{')) {
      try {
        const payload = JSON.parse(a);
        return {
          agent: agent || 'codex',
          session: shortId(payload['session_id'] || payload['session-id'] || payload['sessionID'] || payload.session || '?'),
          lastReply: truncate(String(payload['last-assistant-message'] || payload.message || '')),
          transcriptPath: null,
          isTest,
        };
      } catch { /* not json, fall through */ }
    }
  }
  // codebuddy / claude: stdin JSON.
  if (stdin) {
    try {
      const payload = JSON.parse(stdin);
      if (payload.session_id || payload.transcript_path) {
        return {
          agent: agent || 'agent',
          session: shortId(payload.session_id || '?'),
          lastReply: '',
          transcriptPath: payload.transcript_path || null,
          isTest,
        };
      }
    } catch { /* not json */ }
  }
  // opencode plugin / cli test: explicit flags.
  if (session) return { agent: agent || 'agent', session: shortId(session), lastReply: '', transcriptPath: null, isTest };

  // A bare session-id argument.
  const bare = argv.find((a) => !a.startsWith('-'));
  if (bare) return { agent: agent || 'agent', session: shortId(bare), lastReply: '', transcriptPath: null, isTest };

  return null;
}

/** Compose the notification text, appending the agent's last reply if any. */
export function messageFor({ agent, session, lastReply = '', transcriptPath = null, maxReply = 200 }, now = new Date()) {
  const t = now.toLocaleString('zh-CN', { hour12: false });
  let text = `[agent-notify] ${agent} 会话 ${session} 已结束（${t}）`;
  const reply = lastReply || extractLastReply(transcriptPath);
  const trimmed = truncate(reply, maxReply);
  if (trimmed) text += `\n\n${trimmed}`;
  return text;
}

/** One-shot notifier entry: run(), then exit. Used as hook/plugin/CLI entry. */
export async function run(argv = process.argv.slice(2), { stdin = '', cfgPath = CONFIG_PATH, logger = console } = {}) {
  const input = parseInput({ argv, stdin });
  if (!input) return { ok: false, skipped: true, reason: 'unrecognized input' };
  const notify = loadNotify(cfgPath);
  if (!notify) return { ok: false, skipped: true, reason: 'webhook not configured' };
  const text = messageFor(input);
  const result = await sendDingtalk(notify, text);
  if (result.ok) logger.log(text);
  else logger.error(`dingtalk send failed: ${JSON.stringify(result)}`);
  return result;
}

async function main() {
  let stdin = '';
  if (!process.argv.includes('--test')) {
    for await (const chunk of process.stdin) stdin += chunk;
  }
  await run(process.argv.slice(2), { stdin });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch(() => process.exit(0));
}
