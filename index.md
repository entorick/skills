# Skills Index

Registry of all skills maintained in this repository.

| Skill | Category | Description |
|-------|----------|-------------|
| [zentao](skills/project-management/zentao/) | project-management | ZenTao 12.5.3 API access — read/write bugs, tasks, stories via JSON API |
| [md2word](skills/document/md2word/) | document | Markdown 转 Word (.docx)：** 转真正加粗、无分隔符、原生表格、中文微软雅黑 |

## Categories

- **project-management** — Project tracking and issue management tools (ZenTao, etc.)
- **document** — 文档格式转换与生成（md2word 等）

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
