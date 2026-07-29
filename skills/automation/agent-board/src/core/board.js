import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { COLUMNS } from './config.js';

export function parseCardFile(filePath) {
  const parsed = matter(fs.readFileSync(filePath, 'utf8'));
  return {
    ...parsed.data,
    body: parsed.content.trim(),
    file: filePath,
    status: path.basename(path.dirname(filePath)),
  };
}

export function listCards(root, status = null) {
  const cols = status ? [status] : COLUMNS;
  const cards = [];
  for (const col of cols) {
    const dir = path.join(root, col);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      cards.push(parseCardFile(path.join(dir, f)));
    }
  }
  return cards.sort((a, b) => String(a.created).localeCompare(String(b.created)));
}

export function getCard(root, id) {
  return listCards(root).find((c) => c.id === id) || null;
}

function slugify(title) {
  return String(title)
    .trim()
    .toLowerCase()
    .replace(/[\s/\\]+/g, '-')
    .replace(/[^\p{Letter}\p{Number}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export function addCard(root, { title, cwd, agent = null, body = '' }) {
  if (!title) throw new Error('title is required');
  if (!cwd) throw new Error('cwd is required');
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = slugify(title) || 'task';
  let id = `${ymd}-${slug}`;
  for (let n = 2; getCard(root, id); n++) id = `${ymd}-${slug}-${n}`;
  const data = { id, title, created: new Date().toISOString(), attempts: 0 };
  if (agent) data.agent = agent;
  data.cwd = cwd;
  const file = path.join(root, 'todo', `${id}.md`);
  fs.writeFileSync(file, matter.stringify(`\n${body || title}\n`, data));
  return parseCardFile(file);
}

export function appendLog(root, id, line) {
  const card = getCard(root, id);
  if (!card) throw new Error(`card not found: ${id}`);
  let content = fs.readFileSync(card.file, 'utf8').trimEnd();
  if (!content.includes('\n## Log')) content += '\n\n## Log';
  content += `\n- [${new Date().toISOString()}] ${line}\n`;
  fs.writeFileSync(card.file, content);
  return parseCardFile(card.file);
}

export function moveCard(root, id, to, note = '') {
  if (!COLUMNS.includes(to)) throw new Error(`invalid column: ${to}`);
  const card = getCard(root, id);
  if (!card) throw new Error(`card not found: ${id}`);
  if (card.status === to) return card;
  fs.renameSync(card.file, path.join(root, to, path.basename(card.file)));
  if (note) appendLog(root, id, `${card.status} → ${to}: ${note}`);
  return getCard(root, id);
}

export function updateCard(root, id, patch) {
  const card = getCard(root, id);
  if (!card) throw new Error(`card not found: ${id}`);
  const parsed = matter(fs.readFileSync(card.file, 'utf8'));
  fs.writeFileSync(card.file, matter.stringify(parsed.content, { ...parsed.data, ...patch }));
  return getCard(root, id);
}
