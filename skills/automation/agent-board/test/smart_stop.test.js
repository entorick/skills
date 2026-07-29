import { describe, it, expect } from 'vitest';
import { classifyTranscript, decide } from '../src/hooks/smart_stop.js';

const apiError = (msg) => JSON.stringify({ type: 'system', subtype: 'api_error', level: 'error', error: msg });
const assistantMsg = JSON.stringify({ type: 'message', role: 'assistant', content: [{ type: 'text', text: 'done' }] });
const userMsg = JSON.stringify({ type: 'message', role: 'user', content: 'hi' });

describe('classifyTranscript', () => {
  it('detects terminal 429 as rate_limited', () => {
    const lines = [userMsg, assistantMsg, apiError('429 too many requests (request id: abc)')];
    expect(classifyTranscript(lines)).toBe('rate_limited');
  });

  it('detects overloaded/529 as rate_limited', () => {
    expect(classifyTranscript([apiError('API Error: 529 Overloaded')])).toBe('rate_limited');
  });

  it('distinguishes non-rate-limit api errors', () => {
    expect(classifyTranscript([apiError('401 unauthorized')])).toBe('api_error');
  });

  it('normal end when last event is an assistant message', () => {
    expect(classifyTranscript([userMsg, assistantMsg])).toBe('normal');
  });

  it('unknown for empty or unparseable transcripts', () => {
    expect(classifyTranscript([])).toBe('unknown');
    expect(classifyTranscript(['not json', '{broken'])).toBe('unknown');
  });

  it('a 429 followed by recovery is not treated as terminal', () => {
    const lines = [apiError('429 too many requests'), assistantMsg];
    expect(classifyTranscript(lines)).toBe('normal');
  });
});

describe('decide', () => {
  it('blocks with incremented attempts while under the cap', () => {
    expect(decide('rate_limited', 0, 5)).toEqual({ action: 'block', classification: 'rate_limited', attempts: 1 });
    expect(decide('rate_limited', 4, 5)).toEqual({ action: 'block', classification: 'rate_limited', attempts: 5 });
  });

  it('allows stop + flags failure notification when exhausted', () => {
    const d = decide('rate_limited', 5, 5);
    expect(d.action).toBe('allow');
    expect(d.notifyFailed).toBe(true);
  });

  it('never blocks for non-rate-limit classifications', () => {
    for (const c of ['normal', 'api_error', 'unknown']) {
      expect(decide(c, 0, 5).action).toBe('allow');
    }
  });
});
