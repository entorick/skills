# Skills Index

Registry of all skills maintained in this repository.

| Skill | Category | Description |
|-------|----------|-------------|
| [zentao](skills/project-management/zentao/) | project-management | ZenTao 12.5.3 API access — read/write bugs, tasks, stories via JSON API |

## Categories

- **project-management** — Project tracking and issue management tools (ZenTao, etc.)

## Usage

To use a skill from this repo on another machine:

1. Clone this repo: `git clone https://github.com/entorick/skills.git`
2. Copy the desired skill folder to `~/.claude/skills/`:
   ```bash
   cp -r skills/<category>/<skill-name> ~/.claude/skills/<skill-name>
   ```
3. Invoke with `/<skill-name>` in Claude Code.
