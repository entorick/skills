# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This repo manages a personal collection of Claude Code skills — markdown files that define specialized behaviors and workflows invoked via the `/skill-name` command.

## Structure

```
index.md                          # Skill registry — keep updated when adding/removing skills
skills/
  <category>/                     # Grouped by domain
    <skill-name>/
      SKILL.md                    # Skill definition (frontmatter + instructions)
      *.py / *.sh / ...          # Supporting scripts and files
      .gitignore                  # Skill-level gitignore for credentials/caches
templates/
  skill-template.md               # Starter template for new skills
```

All skills live under `skills/<category>/<skill-name>/`. Use lowercase kebab-case for all names (e.g., `project-management/zentao/`).

### Current categories

| Category | Scope |
|----------|-------|
| `project-management` | Project tracking and issue management tools |

## Skill File Format

Every skill is a markdown file with YAML frontmatter:

```markdown
---
name: skill-name
description: One-line description. Claude uses this to decide when to invoke the skill.
---

# Skill Title

Instructions...
```

- `name` must be unique across the repo.
- `description` should be specific enough that Claude can distinguish it from other skills.
- The body after the frontmatter is the full instruction set Claude follows when the skill is invoked.

## Adding a New Skill

1. Create `skills/<category>/<skill-name>/` (create the category dir if it doesn't exist yet).
2. Copy `templates/skill-template.md` to that folder as `SKILL.md`, fill in frontmatter (`name`, `description`).
3. Add any supporting files (scripts, references) alongside `SKILL.md`.
4. Add a `.gitignore` for credentials or build artifacts (e.g., `.config.json`, `__pycache__/`).
5. Update `index.md` with the new skill entry.
6. Test by copying the folder to `~/.claude/skills/<skill-name>/` and invoking `/<skill-name>`.
