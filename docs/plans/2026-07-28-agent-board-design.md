# agent-board 设计文档

日期：2026-07-28
状态：已确认（与本仓库 owner 逐节评审通过）

## 目标

一个**看板驱动**的 CLI agent 自动化工具，放进本技能仓库跨机器复用：

- 看板派发任务给 headless CLI agent（codebuddy / claude code / codex）
- 任务完成 → 钉钉通知；429/限流 → 自动退避重试
- 本地 web 控制台：环境检测、skills 安装、hooks 开关、看板视图、通知配置

参考：nimbalyst（看板驱动 agent 的理念，但不做 Electron）、local-mcp（clone 即启动的服务形态）。

## 关键决策（owner 拍板）

| 决策点 | 结论 |
|---|---|
| 看板后端 | 本地 markdown 文件（frontmatter 卡片），**不进 git**——各机器任务不同 |
| 执行模型 | 混合：守护进程自动调度 + 交互 session 的 Stop hook 辅助 |
| 任务上下文 | 全局看板 `~/agent-board/`，卡片 `cwd` 字段指定执行目录 |
| 技术栈 | Node.js 全栈（目标机器必装 CLI agent → Node 保证存在）；Fastify + React + Vite + Vitest |
| 服务形态 | `agent-board serve` 起本地 HTTP，浏览器操作；不要 Electron |

## 分层架构

```
Web 控制台（React，给人用）
  ↓ 纯转发，无业务逻辑
server.js（Fastify）
  ↓
cli.js / core/（单一事实源，agent 也可直接 CLI 调用）
  ↓
adapters（codebuddy.js / claude.js / codex.js——唯一的 agent 差异层）
notify.js / dispatcher.js / hooks/smart_stop.js
```

原则：服务挂了，CLI、hooks、看板文件全部照常可用。

## 目录布局

```
skills/automation/agent-board/        # 进 git
├── SKILL.md  package.json  config.example.json
├── src/
│   ├── core/{board,config,doctor}.js
│   ├── adapters/{index,codebuddy,claude,codex}.js
│   ├── {notify,dispatcher,cli,server}.js
│   └── hooks/smart_stop.js
├── web/（React + Vite → build 到 dist/）
└── test/（vitest）

~/agent-board/                        # 不进 git，每机一份
├── config.json  .state/
└── todo/ doing/ review/ done/ failed/
```

首次运行任何入口自动建 `~/agent-board/` 骨架 + 默认 config，并提示如何修改（webhook 等）。

## 卡片格式

```markdown
---
id: 20260728-fix-login
title: 修复登录页样式错乱
agent: codebuddy                  # 可选，缺省读 config.default_agent
cwd: ~/github/az-chatbot/aichatbot  # 必填
created: 2026-07-28T14:00:00
attempts: 0                       # dispatcher 维护
---

正文 = 给 agent 的完整 prompt。
卡片末尾维护 `## Log` 区，每次状态变化追加一行（时间、事件、耗时）。
```

## 任务流转

```
todo ──dispatcher 认领──▶ doing ──成功──▶ review ──人审通过──▶ done
                  │         │
                  │         └──重试耗尽/不可重试错误──▶ failed（钉钉 @owner）
                  └── 人可随时在 web 手动拖动任何卡片
```

`done` 只能由人点出；failed 可拖回 todo 重派。移动 = 文件 mv + frontmatter 更新 + Log 追加。

## dispatcher：429 判定与退避

- 每 10s 扫 todo/，取最早卡，校验 cwd/agent 存在后移 doing，同步执行（单卡串行）
- 结果判定三层信号：退出码 → 输出尾部 50 行匹配 `429|too many requests|rate.?limit|overloaded|529` → 其它非零
- 限流退避：30s→300s 封顶 ×5 次，±15% 抖动；识别 `resets <time>` 则精确等待
- 重试用 adapter 的续跑能力（`-c` / `resume`）发"继续"，保上下文
- attempts 写 frontmatter，崩溃重启后扫 doing/ 续跑，不丢状态

## hooks 与 dispatcher 分工（不打架）

| | dispatcher | smart_stop hook |
|---|---|---|
| 范围 | 看板发起的 headless 任务 | 人手动开的交互 session |
| 429 | 退避 + 续跑 | 解析 transcript 尾部 → `{"continue": false, "reason": "已退避，请继续"}` |
| 通知 | review / failed 时钉钉 | 交互任务正常结束钉钉（可开关） |

隔离规则：dispatcher spawn 的进程带标记（env/state 文件），hook 检测到直接放行。
`agent-board hooks enable/disable` 改写各 agent 配置（codebuddy/claude 的 settings.json，codex 的 config.toml）。

## 通知

钉钉机器人 webhook，token 存 `~/agent-board/config.json`（gitignore），支持"发测试消息"。

## doctor（环境检测）

node/npm 版本、codebuddy/claude/codex 命令与配置目录、看板目录、webhook 配置状态 → web 首页报告。

## 开放问题（实现期验证）

- CodeBuddy Stop hook 在 API 错误终止时是否触发（文档未明说）→ smart_stop 加日志，首个真实 429 验证；不触发则交互侧重试退回 tmux 方案
