---
name: agent-board
description: 看板驱动的 CLI agent 自动化：markdown 看板派发任务给 codebuddy/claude/codex，429 自动退避重试，钉钉完成/失败通知，本地 web 控制台（环境检测、技能安装、hooks 开关）。触发词：看板、agent-board、派任务给 agent、429 自动重试、任务完成通知。
---

# agent-board

看板驱动的 CLI agent 自动化工具。设计文档：`docs/plans/2026-07-28-agent-board-design.md`（仓库根）。

## 概念

- **看板**在 `~/agent-board/`（不进 git，每机一份）：`todo/ doing/ review/ done/ failed/` 五列，任务 = 带 frontmatter 的 md 卡片
- **代码**在本目录（进 git，跨机器复用），Node.js，CLI 是单一事实源，web 只是壳
- **done 只能由人审点出**；failed 可拖回 todo 重派

## 首次使用（新机器）

```bash
cd skills/automation/agent-board
npm install && npm run build   # 构建 web 控制台（doctor 会检测 node/npm）
npm link                       # 注册 agent-board 命令（可选，也可直接 node src/cli.js）
agent-board init               # 建 ~/agent-board/ 骨架 + 默认 config
agent-board doctor             # 环境体检：node/npm、三个 CLI agent、看板、webhook
```

然后编辑 `~/agent-board/config.json`：填 `notify.dingtalk_webhook`、`at_mobile`，跑 `agent-board notify-test` 验证。

## 日常命令

| 命令 | 作用 |
|---|---|
| `agent-board add -t "标题" --cwd <目录> [--agent x] [-m prompt]` | 投任务到 todo |
| `agent-board ls [status]` / `move <id> <status>` | 看 / 移卡片 |
| `agent-board dispatch` | 守护进程：轮询 todo → headless 执行 → 429 退避续跑 → 移 review/failed + 钉钉 |
| `agent-board dispatch --once` | 只处理一张卡（调试） |
| `agent-board hooks enable/disable` | 给检测到的 agent 装/卸 Stop hook（交互 session 的 429 重试+通知） |
| `agent-board serve` | web 控制台 http://127.0.0.1:4789（看板拖拽、doctor、技能、设置） |

## 给 agent 的指引

- 用户说"派个任务 / 加到看板"→ `agent-board add`（`--cwd` 必填，prompt 写清楚验收标准）
- 用户问"看板/任务状态"→ `agent-board ls`
- 任务完成或失败后卡片在 review/failed，**提醒用户去 web 控制台或钉钉处理**，不要自动移 done
- 配置文件 `~/agent-board/config.json` 含 webhook token，**永不提交**；改配置用 `agent-board config` 查看生效值

## 测试

`npm test`（vitest，63 例）。仓库级 `./scripts/validate.py` 会自动发现并运行。
