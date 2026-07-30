#!/usr/bin/env node
import { Command } from 'commander';
import { ensureBoard, loadConfig, boardRoot, COLUMNS } from './core/config.js';
import { listCards, addCard, moveCard } from './core/board.js';
import { runDoctor } from './core/doctor.js';

const program = new Command();
program.name('agent-board').description('Kanban-driven CLI agent automation').version('0.1.0');

program
  .command('init')
  .description('Create ~/agent-board skeleton and default config (idempotent)')
  .action(() => {
    const { root, created, configCreated, configPath } = ensureBoard();
    console.log(`board root: ${root} ${created ? '(created)' : '(already exists)'}`);
    if (configCreated) {
      console.log(`default config written: ${configPath}`);
      console.log('\n下一步：编辑 config.json ——');
      console.log('  1. notify.dingtalk_webhook: 钉钉机器人 webhook（钉钉群 → 机器人 → webhook）');
      console.log('  2. notify.at_mobile: 需要 @ 的手机号');
      console.log('  3. default_agent: codebuddy / claude / codex');
    } else {
      console.log('config exists, untouched');
    }
  });

program
  .command('doctor')
  .description('Probe environment: node/npm, CLI agents, board, webhook')
  .action(() => {
    const { ok, checks } = runDoctor();
    for (const c of checks) {
      const mark = c.ok ? '✓' : c.level === 'required' ? '✗' : '·';
      console.log(`${mark} ${c.name.padEnd(18)} ${c.detail}`);
    }
    console.log(ok ? '\nrequired checks passed' : '\nREQUIRED CHECKS FAILED');
    if (!ok) process.exitCode = 1;
  });

program
  .command('ls')
  .description('List cards, optionally filtered by column')
  .argument('[status]', `one of ${COLUMNS.join('|')}`)
  .action((status) => {
    const root = boardRoot();
    const cards = listCards(root, status || null);
    if (cards.length === 0) return console.log('(no cards)');
    for (const c of cards) {
      console.log(`${c.status.padEnd(7)} ${c.id}  ${c.title}${c.attempts ? `  (attempts: ${c.attempts})` : ''}`);
    }
  });

program
  .command('add')
  .description('Add a card to todo/')
  .requiredOption('-t, --title <title>')
  .requiredOption('--cwd <dir>', 'working directory for the agent')
  .option('--agent <agent>', 'codebuddy|claude|codex (default from config)')
  .option('-m, --message <body>', 'prompt body (default: title)')
  .action((opts) => {
    ensureBoard();
    const card = addCard(boardRoot(), {
      title: opts.title,
      cwd: opts.cwd,
      agent: opts.agent,
      body: opts.message,
    });
    console.log(`added: ${card.id} → todo/`);
  });

program
  .command('move')
  .description('Move a card between columns')
  .argument('<id>')
  .argument('<status>', `one of ${COLUMNS.join('|')}`)
  .option('-n, --note <note>', 'log note')
  .action((id, status, opts) => {
    const card = moveCard(boardRoot(), id, status, opts.note || 'manual move');
    console.log(`moved: ${card.id} → ${card.status}`);
  });

program
  .command('config')
  .description('Print effective config (defaults merged with config.json)')
  .action(() => console.log(JSON.stringify(loadConfig(), null, 2)));

program
  .command('notify-test')
  .description('Send a test DingTalk message using ~/agent-board/config.json')
  .action(async () => {
    const { sendDingtalk } = await import('./notify.js');
    const r = await sendDingtalk(loadConfig(), '[agent-board] 测试消息：通知通道正常');
    if (r.skipped) {
      console.log(`skipped: ${r.reason}`);
      console.log('编辑 config.json 的 notify.dingtalk_webhook 后重试');
      process.exitCode = 1;
    } else {
      console.log(r.ok ? 'sent ✓' : `failed: ${JSON.stringify(r)}`);
      if (!r.ok) process.exitCode = 1;
    }
  });

program
  .command('dispatch')
  .description('Run the dispatcher daemon (polls todo/, executes cards)')
  .option('--once', 'process at most one card then exit')
  .action(async (opts) => {
    const { main } = await import('./dispatcher.js');
    await main({ once: opts.once });
  });

program
  .command('serve')
  .description('Start the web console (default http://127.0.0.1:4789)')
  .option('-p, --port <port>', 'listen port', '4789')
  .action(async (opts) => {
    const { startServer } = await import('./server.js');
    await startServer(Number(opts.port));
  });

const hooksCmd = program.command('hooks').description('Manage Stop/notify hooks in detected agents');

hooksCmd
  .command('enable')
  .description('Install smart_stop (codebuddy/claude) and notify (codex) hooks')
  .option('--agent <agent>', 'only this agent (codebuddy|claude|codex)')
  .action(async (opts) => {
    const { enableHooks } = await import('./hooks/install.js');
    for (const r of enableHooks({ agents: opts.agent ? [opts.agent] : null })) {
      console.log(`${r.changed ? '✓' : '·'} ${r.agent}: ${r.detail}`);
    }
  });

hooksCmd
  .command('disable')
  .description('Remove agent-board hooks from agent configs')
  .option('--agent <agent>', 'only this agent (codebuddy|claude|codex)')
  .action(async (opts) => {
    const { disableHooks } = await import('./hooks/install.js');
    for (const r of disableHooks({ agents: opts.agent ? [opts.agent] : null })) {
      console.log(`${r.changed ? '✓' : '·'} ${r.agent}: ${r.detail}`);
    }
  });

program.parse();
