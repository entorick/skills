# Skills Index

Registry of all skills maintained in this repository.

| Skill | Category | Description |
|-------|----------|-------------|
| [zentao](skills/project-management/zentao/) | project-management | ZenTao 12.5.3 API access — read/write bugs, tasks, stories via JSON API |
| [md2word](skills/document/md2word/) | document | Markdown 转 Word (.docx)：** 转真正加粗、无分隔符、原生表格、中文微软雅黑 |
| [teams-chat-export](skills/data-export/teams-chat-export/) | data-export | 导出本机 Teams 聊天记录为 markdown 全量历史（zaungast 直读本地缓存，含翻页去重与索引） |
| [skill-mining](skills/meta/skill-mining/) | meta | 定期回顾 CLI agent 工作记录，识别值得沉淀的重复手工流程（扫描摘要 + 业务耦合度裁决） |
| [self-update](skills/meta/self-update/) | meta | 从远端仓库 origin/main 拉取最新技能并重挂 symlink（git SHA 对比 + ff-only + stash 保护） |
| [feishu](skills/integration/feishu/) | integration | 通过 lark-cli 访问飞书文档/表格/Wiki/多维表格/云空间（检测+安装+导出，含 --raw/wiki-unwrap/bot权限等踩坑修复） |
| [agent-board](skills/automation/agent-board/) | automation | 看板驱动的 CLI agent 自动化：markdown 看板派发任务（codebuddy/claude/codex），429 自动重试，钉钉通知，本地 web 控制台 |
| [cloud-llm-api](skills/integration/cloud-llm-api/) | integration | 调用国内云端大模型 API（DeepSeek/GLM/Kimi/百川/Azure OpenAI）—— endpoint、模型名、认证、思考开关、温度限制、上下文上限等实测坑点，附 probe.js 一键探活 |

## Categories

- **project-management** — Project tracking and issue management tools (ZenTao, etc.)
- **document** — 文档格式转换与生成（md2word 等）
- **data-export** — 本机应用数据导出与归档（Teams 聊天记录等）
- **meta** — agent 自我迭代：从工作记录中挖掘并沉淀新能力
- **integration** — 外部平台集成：本机 CLI 工具当作 MCP 用（飞书 lark-cli 等）
- **automation** — CLI agent 编排与自动化（看板调度、通知、重试等）

## Usage

To use the skills from this repo on any machine:

1. Clone this repo: `git clone https://github.com/entorick/skills.git`
2. Install (symlinks all skills into `~/.claude/skills` and `~/.codebuddy/skills`):
   ```bash
   cd skills && ./install.sh
   ```
3. Invoke with `/<skill-name>` in your CLI agent.

Skills are symlinked, not copied — iterating a skill during a task edits the
repo directly. Run `./scripts/validate.py` before committing any change.
