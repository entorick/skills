#!/usr/bin/env node
/**
 * Stop hook for interactive CLI agent sessions (codebuddy / claude).
 *
 * Judges how the session ended by reading the transcript tail:
 *   - normal end        → optional dingtalk notify (notify.on_session_stop), allow stop
 *   - rate-limited (429)→ bounded backoff sleep, then {"continue": false, reason} to resume
 *   - retries exhausted → dingtalk alert, allow stop
 *
 * Sessions spawned by the dispatcher (env AGENT_BOARD_DISPATCHED=1) are left alone:
 * board tasks are managed exclusively by the dispatcher.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureBoard, loadConfig, boardRoot } from '../core/config.js';
import { isRateLimited, tail } from '../adapters/index.js';
import { sendDingtalk } from '../notify.js';
import { backoffMs } from '../dispatcher.js';

export function classifyTranscript(jsonlLines) {
  for (let i = jsonlLines.length - 1; i >= 0; i--) {
    let ev;
    try {
      ev = JSON.parse(jsonlLines[i]);
    } catch {
      continue;
    }
    if (ev.type === 'system' && ev.subtype === 'api_error') {
      return isRateLimited(JSON.stringify(ev)) ? 'rate_limited' : 'api_error';
    }
    if (ev.type === 'message' || ev.role === 'assistant') return 'normal';
  }
  return 'unknown';
}

export function decide(classification, attempts, maxAttempts) {
  if (classification !== 'rate_limited') return { action: 'allow', classification };
  if (attempts >= maxAttempts) return { action: 'allow', classification, notifyFailed: true };
  return { action: 'block', classification, attempts: attempts + 1 };
}

function stateFile(root, sessionId) {
  return path.join(root, '.state', `hook-${sessionId}.json`);
}

function readAttempts(root, sessionId) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(root, sessionId), 'utf8')).attempts || 0;
  } catch {
    return 0;
  }
}

function writeAttempts(root, sessionId, attempts) {
  fs.writeFileSync(stateFile(root, sessionId), JSON.stringify({ attempts, updated: new Date().toISOString() }));
}

function hookLog(root, line) {
  const file = path.join(root, '.state', 'hook.log');
  fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function run(input, { sleep = realSleep } = {}) {
  if (process.env.AGENT_BOARD_DISPATCHED === '1') return; // dispatcher-owned session
  const root = boardRoot();
  ensureBoard(root);
  const cfg = loadConfig(root);
  const sessionId = input.session_id || 'unknown';
  hookLog(root, `Stop fired session=${sessionId} stop_hook_active=${!!input.stop_hook_active}`);

  let lines = [];
  try {
    lines = tail(fs.readFileSync(input.transcript_path, 'utf8'), 30).split('\n');
  } catch (err) {
    hookLog(root, `transcript unreadable: ${err}`);
    return;
  }
  const classification = classifyTranscript(lines);
  hookLog(root, `classification=${classification}`);

  if (classification === 'normal') {
    if (cfg.notify.on_session_stop) {
      await sendDingtalk(cfg, `[agent-board] 交互任务结束 (session ${sessionId.slice(0, 8)})`);
    }
    return;
  }

  const attempts = readAttempts(root, sessionId);
  const d = decide(classification, attempts, cfg.retry.max_attempts);

  if (d.notifyFailed) {
    await sendDingtalk(cfg, `[agent-board] 交互 session ${sessionId.slice(0, 8)} 429 重试 ${attempts} 次仍失败，请人工介入`);
    hookLog(root, `retries exhausted (${attempts}), allowing stop`);
    return;
  }
  if (d.action !== 'block') return;

  const capMs = (cfg.hook_sleep_cap_sec ?? 60) * 1000;
  const waitMs = Math.min(backoffMs(cfg, d.attempts), capMs);
  writeAttempts(root, sessionId, d.attempts);
  hookLog(root, `blocking stop, attempt ${d.attempts}, sleep ${Math.round(waitMs / 1000)}s`);
  await sleep(waitMs);
  process.stdout.write(
    JSON.stringify({
      continue: false,
      reason: `上一个请求因限流(429)失败，已自动等待 ${Math.round(waitMs / 1000)}s。请继续刚才未完成的任务，不要重新开始。`,
    })
  );
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  let input = {};
  try {
    input = JSON.parse(raw);
  } catch { /* tolerate empty/invalid stdin */ }
  await run(input);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => process.exit(0)); // hooks must never crash the agent
}
