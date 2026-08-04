import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseInput, buildPayload, messageFor, loadNotify } from '../notify.js';

const cfg = { dingtalk_webhook: 'https://example.com/hook', at_mobile: '13800000000', keyword: 'kw' };

test('parseInput: codebuddy/claude stdin JSON', () => {
  const input = parseInput({
    argv: ['--agent', 'codebuddy'],
    stdin: JSON.stringify({ session_id: 'abcd1234efgh', transcript_path: '/tmp/t.jsonl' }),
  });
  assert.deepEqual(input, { agent: 'codebuddy', session: 'abcd1234', isTest: false });
});

test('parseInput: codex bare JSON argv payload', () => {
  const input = parseInput({
    argv: [JSON.stringify({ 'session-id': 'xyz98765' })],
  });
  assert.equal(input.agent, 'codex');
  assert.equal(input.session, 'xyz98765');
});

test('parseInput: opencode plugin flags', () => {
  const input = parseInput({
    argv: ['--agent', 'opencode', '--session', 'op123456'],
  });
  assert.deepEqual(input, { agent: 'opencode', session: 'op123456', isTest: false });
});

test('parseInput: unrecognized input returns null', () => {
  assert.equal(parseInput({ argv: [], stdin: '' }), null);
});

test('buildPayload: injects keyword when missing', () => {
  const payload = buildPayload(cfg, '会话结束');
  assert.equal(payload.text.content, 'kw 会话结束');
  assert.deepEqual(payload.at.atMobiles, ['13800000000']);
});

test('buildPayload: does not duplicate keyword', () => {
  const payload = buildPayload(cfg, 'kw 会话结束');
  assert.equal(payload.text.content, 'kw 会话结束');
});

test('messageFor: includes agent, session id and time', () => {
  const msg = messageFor({ agent: 'claude', session: 'abc12345' }, new Date('2026-08-03T10:00:00'));
  assert.ok(msg.includes('[agent-notify]'));
  assert.ok(msg.includes('claude'));
  assert.ok(msg.includes('abc12345'));
  assert.ok(msg.includes('2026'));
});

test('loadNotify: returns null on missing/invalid file', () => {
  assert.equal(loadNotify('/nonexistent/config.json'), null);
  assert.equal(loadNotify('/tmp/no-such-file.json'), null);
});

test('loadNotify: parses notify section', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notify-'));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify({ notify: { dingtalk_webhook: 'https://h', at_mobile: '1', keyword: 'k' } }));
  assert.deepEqual(loadNotify(file), { dingtalk_webhook: 'https://h', at_mobile: '1', keyword: 'k' });
});
