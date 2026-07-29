import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ensureBoard, loadConfig, boardRoot } from './core/config.js';
import { listCards, moveCard, updateCard, appendLog } from './core/board.js';
import { getAdapter, isRateLimited, tail, parseResetTime } from './adapters/index.js';
import { notifyTask } from './notify.js';

export function backoffMs(cfg, attempt) {
  const seq = cfg.retry.backoff_sec;
  const base = seq[Math.min(attempt - 1, seq.length - 1)] * 1000;
  const jitter = base * cfg.retry.jitter * (Math.random() * 2 - 1);
  return Math.round(base + jitter);
}

/** Real runner: spawn the agent headless in the card's cwd. */
export function defaultRunner(adapter, args, cwd) {
  const r = spawnSync(adapter.bin, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // Marker env: smart_stop hook must stay out of dispatched sessions
    env: { ...process.env, AGENT_BOARD_DISPATCHED: '1' },
  });
  return { code: r.status ?? 1, output: `${r.stdout || ''}\n${r.stderr || ''}` };
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Claim the oldest todo card and run it to a terminal state (review/failed).
 * runner/sleep are injectable for tests. Returns { handled, result?, attempts? }.
 */
export async function processNext(root, cfg, { runner = defaultRunner, sleep = realSleep } = {}) {
  const card = listCards(root, 'todo')[0];
  if (!card) return { handled: false };

  const agentName = card.agent || cfg.default_agent;
  let adapter;
  try {
    adapter = getAdapter(agentName);
  } catch (err) {
    moveCard(root, card.id, 'failed', String(err.message || err));
    await notifyTask(cfg, card, 'failed', String(err.message || err));
    return { handled: true, result: 'failed', attempts: 0 };
  }
  if (!fs.existsSync(card.cwd)) {
    moveCard(root, card.id, 'failed', `cwd not found: ${card.cwd}`);
    await notifyTask(cfg, card, 'failed', `目录不存在: ${card.cwd}`);
    return { handled: true, result: 'failed', attempts: 0 };
  }

  moveCard(root, card.id, 'doing', `claimed (agent=${agentName})`);
  const prompt = card.body.split('\n## Log')[0].trim();
  let attempt = card.attempts || 0;

  for (;;) {
    attempt += 1;
    updateCard(root, card.id, { attempts: attempt });
    const args = attempt === 1 ? adapter.runArgs(prompt) : adapter.resumeArgs();
    const { code, output } = runner(adapter, args, card.cwd);

    if (code === 0) {
      moveCard(root, card.id, 'review', `done in ${attempt} attempt(s)`);
      await notifyTask(cfg, card, 'review');
      return { handled: true, result: 'review', attempts: attempt };
    }

    const out50 = tail(output);
    const rateLimited = isRateLimited(out50);
    const maxAttempts = rateLimited ? cfg.retry.max_attempts : 2;
    if (attempt >= maxAttempts) {
      const reason = rateLimited ? `429 重试 ${attempt} 次耗尽` : `非限流错误 (exit ${code}): ${tail(output, 5)}`;
      moveCard(root, card.id, 'failed', `${rateLimited ? 'rate-limited' : 'error'} after ${attempt} attempts`);
      await notifyTask(cfg, card, 'failed', reason);
      return { handled: true, result: 'failed', attempts: attempt };
    }

    const resetAt = rateLimited ? parseResetTime(out50) : null;
    const waitMs = resetAt
      ? Math.max(resetAt.getTime() - Date.now(), 1000) + 60_000
      : backoffMs(cfg, attempt);
    appendLog(root, card.id, `attempt ${attempt} failed (${rateLimited ? 'rate-limit' : `exit ${code}`}), retry in ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }
}

// ---------- daemon mode ----------

function acquireLock(root) {
  const lockPath = path.join(root, '.state', 'dispatcher.lock');
  if (fs.existsSync(lockPath)) {
    const pid = Number(fs.readFileSync(lockPath, 'utf8'));
    try {
      process.kill(pid, 0);
      console.error(`dispatcher already running (pid ${pid})`);
      process.exit(1);
    } catch { /* stale lock */ }
  }
  fs.writeFileSync(lockPath, String(process.pid));
  process.on('exit', () => fs.rmSync(lockPath, { force: true }));
}

export async function main({ once = false } = {}) {
  const root = boardRoot();
  ensureBoard(root);
  acquireLock(root);
  // Requeue cards orphaned in doing/ by a previous crash (attempts persist in frontmatter)
  for (const c of listCards(root, 'doing')) {
    moveCard(root, c.id, 'todo', 'dispatcher (re)start, requeue');
  }
  const pollMs = () => loadConfig(root).poll_interval_sec * 1000;
  console.log(`[dispatcher] watching ${root}/todo every ${loadConfig(root).poll_interval_sec}s`);
  for (;;) {
    try {
      const r = await processNext(root, loadConfig(root));
      if (once || !r.handled) {
        if (once) return r;
        await realSleep(pollMs());
      }
    } catch (err) {
      console.error('[dispatcher] cycle error:', err);
      if (once) throw err;
      await realSleep(pollMs());
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ once: process.argv.includes('--once') }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
