# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This repo manages a personal collection of Claude Code skills — markdown files that define specialized behaviors and workflows invoked via the `/skill-name` command.

## Structure

```
skills/          # All skill files live here
  <category>/    # Group by domain when the collection grows (e.g., devops/, frontend/, workflow/)
  *.md           # Individual skill files
templates/       # Templates for creating new skills
```

Skills can be placed directly in `skills/` or grouped into subdirectories by category. Use lowercase kebab-case for all file and directory names (e.g., `code-review.md`, `feature-dev/`).

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

1. Copy `templates/skill-template.md` to `skills/<name>.md` (or `skills/<category>/<name>.md`).
2. Fill in the frontmatter (`name`, `description`).
3. Write clear, actionable instructions in the body.
4. Test by invoking it with `/<name>` in a Claude Code session that has access to this repo's skills.
