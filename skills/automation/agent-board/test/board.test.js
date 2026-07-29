import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ensureBoard } from '../src/core/config.js';
import { addCard, getCard, listCards, moveCard, appendLog, updateCard } from '../src/core/board.js';

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-test-'));
  ensureBoard(root);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('addCard', () => {
  it('creates a markdown card in todo/ with frontmatter', () => {
    const card = addCard(root, { title: 'Fix login', cwd: '/tmp/repo', agent: 'claude' });
    expect(card.status).toBe('todo');
    expect(card.title).toBe('Fix login');
    expect(card.agent).toBe('claude');
    expect(card.cwd).toBe('/tmp/repo');
    expect(card.attempts).toBe(0);
    expect(fs.existsSync(path.join(root, 'todo', path.basename(card.file)))).toBe(true);
  });

  it('requires title and cwd', () => {
    expect(() => addCard(root, { cwd: '/x' })).toThrow('title');
    expect(() => addCard(root, { title: 'x' })).toThrow('cwd');
  });

  it('generates unique ids for duplicate titles', () => {
    const a = addCard(root, { title: 'Same', cwd: '/x' });
    const b = addCard(root, { title: 'Same', cwd: '/x' });
    expect(a.id).not.toBe(b.id);
  });

  it('defaults body to title', () => {
    const card = addCard(root, { title: 'Do thing', cwd: '/x' });
    expect(card.body).toContain('Do thing');
  });
});

describe('moveCard', () => {
  it('moves the file and logs the transition', () => {
    const card = addCard(root, { title: 'Move me', cwd: '/x' });
    const moved = moveCard(root, card.id, 'doing', 'claimed by dispatcher');
    expect(moved.status).toBe('doing');
    expect(fs.existsSync(path.join(root, 'doing', `${card.id}.md`))).toBe(true);
    expect(fs.existsSync(path.join(root, 'todo', `${card.id}.md`))).toBe(false);
    expect(getCard(root, card.id).body).toContain('claimed by dispatcher');
  });

  it('rejects invalid columns and unknown ids', () => {
    const card = addCard(root, { title: 'X', cwd: '/x' });
    expect(() => moveCard(root, card.id, 'nope')).toThrow('invalid column');
    expect(() => moveCard(root, 'ghost', 'done')).toThrow('not found');
  });
});

describe('listCards / appendLog / updateCard', () => {
  it('lists cards sorted by created and filters by status', () => {
    addCard(root, { title: 'A', cwd: '/x' });
    const b = addCard(root, { title: 'B', cwd: '/x' });
    moveCard(root, b.id, 'done');
    expect(listCards(root)).toHaveLength(2);
    expect(listCards(root, 'done')).toHaveLength(1);
    expect(listCards(root, 'done')[0].title).toBe('B');
  });

  it('appendLog creates ## Log section and appends entries', () => {
    const card = addCard(root, { title: 'Log test', cwd: '/x' });
    appendLog(root, card.id, 'first');
    appendLog(root, card.id, 'second');
    const body = getCard(root, card.id).body;
    expect(body).toContain('## Log');
    expect(body.indexOf('first')).toBeLessThan(body.indexOf('second'));
  });

  it('updateCard patches frontmatter without touching body', () => {
    const card = addCard(root, { title: 'Patch', cwd: '/x', body: 'keep this body' });
    updateCard(root, card.id, { attempts: 3 });
    const updated = getCard(root, card.id);
    expect(updated.attempts).toBe(3);
    expect(updated.body).toContain('keep this body');
  });
});
