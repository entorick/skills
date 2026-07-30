import { describe, it, expect, vi, afterEach } from 'vitest';
import { sendDingtalk, notifyTask } from '../src/notify.js';
import { DEFAULTS } from '../src/core/config.js';

const cfg = (over = {}) => structuredClone({ ...DEFAULTS, notify: { ...DEFAULTS.notify, ...over } });

afterEach(() => vi.unstubAllGlobals());

describe('sendDingtalk', () => {
  it('skips when webhook is not configured', async () => {
    const r = await sendDingtalk(cfg(), 'hello');
    expect(r.skipped).toBe(true);
  });

  it('posts text payload with atMobiles', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ errcode: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    const c = cfg({ dingtalk_webhook: 'https://hook', at_mobile: '138' });
    const r = await sendDingtalk(c, '任务完成');
    expect(r.ok).toBe(true);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hook');
    const body = JSON.parse(opts.body);
    expect(body.text.content).toBe('任务完成');
    expect(body.at.atMobiles).toEqual(['138']);
  });

  it('reports failure on non-zero errcode', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ errcode: 310000 }) }));
    const r = await sendDingtalk(cfg({ dingtalk_webhook: 'https://hook' }), 'x');
    expect(r.ok).toBe(false);
  });

  it('prepends keyword when configured (robot keyword security)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ errcode: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    await sendDingtalk(cfg({ dingtalk_webhook: 'https://h', keyword: 'agent-board' }), '任务完成');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).text.content).toBe('agent-board 任务完成');
    // already contains keyword → not duplicated
    await sendDingtalk(cfg({ dingtalk_webhook: 'https://h', keyword: 'agent-board' }), '[agent-board] 任务完成');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).text.content).toBe('[agent-board] 任务完成');
  });
});

describe('notifyTask', () => {
  it('honors per-event switches', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ errcode: 0 }) });
    vi.stubGlobal('fetch', fetchMock);
    const card = { title: 'T' };
    await notifyTask(cfg({ dingtalk_webhook: 'https://h', on_failed: false }), card, 'failed');
    expect(fetchMock).not.toHaveBeenCalled();
    await notifyTask(cfg({ dingtalk_webhook: 'https://h', on_review: true }), card, 'review');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
