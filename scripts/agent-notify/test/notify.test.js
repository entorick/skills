import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseInput, buildPayload, messageFor, loadNotify,
  extractLastReply, truncate, contentText,
} from '../notify.js';

const cfg = { dingtalk_webhook: 'https://example.com/hook', at_mobile: '13800000000', keyword: 'kw' };

function makeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-notify-tr-'));
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

test('parseInput: codebuddy/claude stdin JSON', () => {
  const input = parseInput({
    argv: ['--agent', 'codebuddy'],
    stdin: JSON.stringify({ session_id: 'abcd1234efgh', transcript_path: '/tmp/t.jsonl' }),
  });
  assert.deepEqual(input, {
    agent: 'codebuddy', session: 'abcd1234', lastReply: '', transcriptPath: '/tmp/t.jsonl', isTest: false,
  });
});

test('parseInput: codex bare JSON argv payload with last-assistant-message', () => {
  const input = parseInput({
    argv: [JSON.stringify({ 'session-id': 'xyz98765', 'last-assistant-message': '任务完成' })],
  });
  assert.equal(input.agent, 'codex');
  assert.equal(input.session, 'xyz98765');
  assert.equal(input.lastReply, '任务完成');
});

test('parseInput: opencode plugin flags', () => {
  const input = parseInput({
    argv: ['--agent', 'opencode', '--session', 'op123456'],
  });
  assert.deepEqual(input, {
    agent: 'opencode', session: 'op123456', lastReply: '', transcriptPath: null, isTest: false,
  });
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

test('messageFor: appends lastReply when provided', () => {
  const msg = messageFor({ agent: 'codebuddy', session: 'abc12345', lastReply: '搞定了' });
  assert.ok(msg.includes('\n\n搞定了'));
});

test('messageFor: reads last reply from transcript when lastReply empty', () => {
  const file = makeTranscript([
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '早期回复' }] },
    { type: 'function_call' },
    { type: 'function_call_result' },
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '最终回复' }] },
    { type: 'function_call' },
  ]);
  const msg = messageFor({ agent: 'codebuddy', session: 'abc12345', transcriptPath: file });
  assert.ok(msg.includes('最终回复'));
  assert.ok(!msg.includes('早期回复'));
});

test('messageFor: falls back to base text when no reply found', () => {
  const file = makeTranscript([
    { type: 'message', role: 'assistant', status: 'completed', content: [] },
    { type: 'function_call' },
  ]);
  const msg = messageFor({ agent: 'claude', session: 'abc12345', transcriptPath: file });
  assert.ok(!msg.includes('\n\n'));
});

test('extractLastReply: codebuddy format (top-level content)', () => {
  const file = makeTranscript([
    { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '你好' }] },
    { type: 'function_call' },
    { type: 'message', role: 'assistant', status: 'in_progress', content: [{ type: 'output_text', text: '未完成' }] },
  ]);
  assert.equal(extractLastReply(file), '你好');
});

test('extractLastReply: claude format (message.content)', () => {
  const file = makeTranscript([
    { type: 'user', message: { content: 'hi' } },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'claude 回复' }] } },
    { type: 'system' },
  ]);
  assert.equal(extractLastReply(file), 'claude 回复');
});

test('extractLastReply: returns null on missing file', () => {
  assert.equal(extractLastReply('/nonexistent/t.jsonl'), null);
});

test('truncate: caps long replies', () => {
  assert.equal(truncate('x'.repeat(300), 200).length, 201); // 200 + …
  assert.equal(truncate('short', 200), 'short');
});

test('contentText: handles string / array / nested shapes', () => {
  assert.equal(contentText('plain'), 'plain');
  assert.equal(contentText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]), 'a\nb');
  assert.equal(contentText([{ type: 'output_text', text: 'c' }]), 'c');
  assert.equal(contentText(null), '');
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
