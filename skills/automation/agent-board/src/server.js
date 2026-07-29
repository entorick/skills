/**
 * Local web console: thin HTTP shell over core/. No business logic here —
 * every endpoint forwards to the same functions the CLI uses.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import matter from 'gray-matter';
import { ensureBoard, loadConfig, boardRoot, COLUMNS } from './core/config.js';
import { listCards, addCard, moveCard } from './core/board.js';
import { runDoctor } from './core/doctor.js';
import { sendDingtalk } from './notify.js';
import { enableHooks, disableHooks } from './hooks/install.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(__dirname, '..'); // skills/automation/agent-board
const REPO_ROOT = path.resolve(SKILL_DIR, '..', '..', '..');
const execFileP = promisify(execFile);

function scanSkills() {
  const skillsRoot = path.join(REPO_ROOT, 'skills');
  const out = [];
  for (const category of fs.readdirSync(skillsRoot)) {
    const catDir = path.join(skillsRoot, category);
    if (!fs.statSync(catDir).isDirectory()) continue;
    for (const name of fs.readdirSync(catDir)) {
      const skillMd = path.join(catDir, name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      try {
        const { data } = matter(fs.readFileSync(skillMd, 'utf8'));
        out.push({ category, name, description: data.description || '' });
      } catch {
        out.push({ category, name, description: '(frontmatter parse error)' });
      }
    }
  }
  return out;
}

export function buildServer() {
  const app = Fastify({ logger: false });
  const root = boardRoot();
  ensureBoard(root);

  app.get('/api/doctor', async () => runDoctor(root));

  app.get('/api/board', async () => {
    const grouped = Object.fromEntries(COLUMNS.map((c) => [c, []]));
    for (const card of listCards(root)) {
      const { body, file, ...rest } = card;
      grouped[card.status].push({ ...rest, bodyPreview: body.split('\n## Log')[0].trim().slice(0, 200) });
    }
    return grouped;
  });

  app.post('/api/cards', async (req, reply) => {
    const { title, cwd, agent, body } = req.body || {};
    try {
      const card = addCard(root, { title, cwd, agent, body });
      return { ok: true, id: card.id };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message });
    }
  });

  app.post('/api/cards/:id/move', async (req, reply) => {
    try {
      const card = moveCard(root, req.params.id, req.body?.to, req.body?.note || 'web console');
      return { ok: true, status: card.status };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message });
    }
  });

  app.get('/api/config', async () => loadConfig(root));

  app.post('/api/config', async (req, reply) => {
    const cfgPath = path.join(root, 'config.json');
    try {
      fs.writeFileSync(cfgPath, JSON.stringify(req.body, null, 2) + '\n');
      return { ok: true };
    } catch (err) {
      return reply.code(400).send({ ok: false, error: err.message });
    }
  });

  app.post('/api/notify-test', async () => sendDingtalk(loadConfig(root), '[agent-board] 测试消息：通知通道正常'));

  app.get('/api/skills', async () => scanSkills());

  app.post('/api/skills/install', async () => {
    try {
      const { stdout, stderr } = await execFileP(path.join(REPO_ROOT, 'install.sh'), [], { cwd: REPO_ROOT });
      return { ok: true, output: `${stdout}${stderr}`.trim() };
    } catch (err) {
      return { ok: false, error: String(err), output: err.stdout || '' };
    }
  });

  app.post('/api/hooks/:action', async (req, reply) => {
    const fn = req.params.action === 'enable' ? enableHooks : req.params.action === 'disable' ? disableHooks : null;
    if (!fn) return reply.code(400).send({ ok: false, error: 'action must be enable|disable' });
    return { ok: true, results: fn({ agents: req.body?.agent ? [req.body.agent] : null }) };
  });

  app.register(fastifyStatic, {
    root: path.join(SKILL_DIR, 'dist'),
    wildcard: true,
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
    return reply.sendFile('index.html');
  });

  return app;
}

export async function startServer(port = Number(process.env.AGENT_BOARD_PORT || 4789)) {
  const app = buildServer();
  await app.listen({ port, host: '127.0.0.1' });
  console.log(`agent-board console: http://127.0.0.1:${port}`);
  return app;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
