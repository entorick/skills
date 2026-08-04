#!/usr/bin/env node
/**
 * agent-notify — install/remove DingTalk completion notifications for every
 * detected CLI agent tool. Zero runtime dependencies.
 *
 * Usage:
 *   node cli.js install     # detect installed agents, inject hook/notify/plugin
 *   node cli.js uninstall   # remove injected hooks (leaves manual edits alone)
 *   node cli.js status      # show what would be installed where
 *   node cli.js notify-test # send a real test DingTalk message
 *
 * Detected agents:
 *   codebuddy  ~/.codebuddy/settings.json        hooks.Stop
 *   claude     ~/.claude/settings.json           hooks.Stop
 *   codex      ~/.codex/config.toml              notify program
 *   opencode   ~/.config/opencode/plugins/       session.idle plugin
 */
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as jsonSettings from './adapters/json-settings.js';
import * as codex from './adapters/codex.js';
import * as opencode from './adapters/opencode.js';
import { CONFIG_PATH, loadNotify, messageFor, run } from './notify.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const NOTIFY_PATH = path.join(__dirname, 'notify.js');

const cmd = process.argv[2];

function log(line) {
  console.log(line);
}

function detectAll(home) {
  return {
    codebuddy: jsonSettings.detect(home).includes('codebuddy'),
    claude: jsonSettings.detect(home).includes('claude'),
    codex: codex.detect(home).includes('codex'),
    opencode: opencode.detect(home).includes('opencode'),
  };
}

function installAll(home) {
  const results = [];
  for (const agent of ['codebuddy', 'claude']) {
    if (jsonSettings.detect(home).includes(agent)) {
      results.push(jsonSettings.enable(home, agent, NOTIFY_PATH));
    } else {
      results.push({ agent, changed: false, detail: 'not installed, skipped' });
    }
  }
  results.push(codex.enable(home, NOTIFY_PATH));
  results.push(opencode.enable(home, NOTIFY_PATH));
  return results;
}

function uninstallAll(home) {
  const results = [];
  for (const agent of ['codebuddy', 'claude']) {
    results.push(jsonSettings.disable(home, agent, NOTIFY_PATH));
  }
  results.push(codex.disable(home, NOTIFY_PATH));
  results.push(opencode.disable(home, NOTIFY_PATH));
  return results;
}

function printResults(results) {
  for (const r of results) {
    log(`  ${r.changed ? 'changed' : 'skip   '}  ${r.agent}: ${r.detail}`);
  }
}

function status(home) {
  const detected = detectAll(home);
  log('Detected CLI agents:');
  for (const [agent, present] of Object.entries(detected)) {
    log(`  ${present ? 'yes' : 'no '}  ${agent}`);
  }
  const notify = loadNotify(CONFIG_PATH);
  log(`\nDingTalk config: ${notify ? 'configured' : 'MISSING (~/agent-board/config.json notify.dingtalk_webhook)'}`);
  if (notify) log(`  webhook: ${notify.dingtalk_webhook.slice(0, 60)}…\n  keyword: ${notify.keyword || '(none)'}`);
}

async function notifyTest() {
  const notify = loadNotify(CONFIG_PATH);
  if (!notify) {
    console.error('ERROR: DingTalk webhook not configured in ~/agent-board/config.json');
    process.exit(1);
  }
  const result = await run(['--agent', 'test', '--session', 'notify-test', '--test'], { cfgPath: CONFIG_PATH });
  if (!result.ok) {
    console.error(`ERROR: ${JSON.stringify(result)}`);
    process.exit(1);
  }
  log('Test message sent. Check your DingTalk.');
}

switch (cmd) {
  case 'install':
    log('agent-notify install');
    printResults(installAll(os.homedir()));
    break;
  case 'uninstall':
    log('agent-notify uninstall');
    printResults(uninstallAll(os.homedir()));
    break;
  case 'status':
    status(os.homedir());
    break;
  case 'notify-test':
    notifyTest();
    break;
  default:
    console.error('Usage: node cli.js <install|uninstall|status|notify-test>');
    process.exit(1);
}
