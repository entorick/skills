/** DingTalk robot notification. Webhook lives in ~/agent-board/config.json (gitignored). */
export async function sendDingtalk(cfg, text) {
  const url = cfg?.notify?.dingtalk_webhook;
  if (!url) return { ok: false, skipped: true, reason: 'webhook not configured' };
  const payload = {
    msgtype: 'text',
    text: { content: text },
    at: { atMobiles: cfg.notify.at_mobile ? [cfg.notify.at_mobile] : [], isAtAll: false },
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok && body.errcode === 0, status: res.status, body };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

const EVENT_LABEL = { review: '执行完成，待审核', failed: '执行失败' };

/** Notify about a board task event, honoring per-event switches in config. */
export function notifyTask(cfg, card, event, extra = '') {
  if (cfg.notify[`on_${event}`] === false) {
    return { ok: false, skipped: true, reason: `notify.on_${event} disabled` };
  }
  const text = [`[agent-board] 任务「${card.title}」${EVENT_LABEL[event] || event}`, extra]
    .filter(Boolean)
    .join('\n');
  return sendDingtalk(cfg, text);
}
