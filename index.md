# Skills Index

Registry of all skills maintained in this repository.

| Skill | Category | Description |
|-------|----------|-------------|
| [zentao](skills/project-management/zentao/) | project-management | ZenTao 12.5.3 API access — read/write bugs, tasks, stories via JSON API |
| [md2word](skills/document/md2word/) | document | Markdown 转 Word (.docx)：** 转真正加粗、无分隔符、原生表格、中文微软雅黑 |
| [teams-chat-export](skills/data-export/teams-chat-export/) | data-export | 导出本机 Teams 聊天记录为 markdown 全量历史（zaungast 直读本地缓存，含翻页去重与索引） |
| [skill-mining](skills/meta/skill-mining/) | meta | 定期回顾 CLI agent 工作记录，识别值得沉淀的重复手工流程（扫描摘要 + 业务耦合度裁决） |

## Categories

- **project-management** — Project tracking and issue management tools (ZenTao, etc.)
- **document** — 文档格式转换与生成（md2word 等）
- **data-export** — 本机应用数据导出与归档（Teams 聊天记录等）
- **meta** — agent 自我迭代：从工作记录中挖掘并沉淀新能力

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
