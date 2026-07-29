# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and other CLI agents
(CodeBuddy, Codex) when working in this repository.

## Repository Purpose

This repo is the owner's personal "digital twin" for AI agents: a versioned
collection of **skills** (specialized behaviors agents invoke via `/skill-name`)
that grows with every task the owner does. Other people hand work to the owner;
the CLI agent executes it through these skills first, and the owner acts as
mentor — reviewing, correcting, and approving. Every error encountered during a
task is an opportunity to iterate this repo (see "Iterating This Repo" below).

## Structure

```
install.sh                        # Symlink skills into ~/.claude/skills + ~/.codebuddy/skills
index.md                          # Skill registry — keep updated when adding/removing skills
scripts/validate.py               # Repo checks (frontmatter, index sync, pytest) — run before committing
skills/
  <category>/                     # Grouped by domain
    <skill-name>/
      SKILL.md                    # Skill definition (frontmatter + instructions)
      *.py / *.sh / ...           # Supporting scripts and files
      test_*.py                   # pytest suite (expected for script-backed skills)
      .gitignore                  # Skill-level gitignore for credentials/caches
templates/
  skill-template.md               # Starter template for new skills
.github/workflows/validate.yml    # CI: runs scripts/validate.py on every push
```

All skills live under `skills/<category>/<skill-name>/`. Use lowercase kebab-case
for all names (e.g., `project-management/zentao/`).

### Current categories

| Category | Scope |
|----------|-------|
| `project-management` | Project tracking and issue management tools |
| `document` | 文档格式转换与生成（md → docx 等） |
| `automation` | CLI agent 编排与自动化（看板调度、通知、重试；Node.js 技能见 agent-board） |

## Installing / Using Skills

Skills are installed as **symlinks**, not copies — this keeps the repo as the
single source of truth. Any change an agent makes to a skill during a task
lands directly in the repo working tree, ready to be reviewed and committed.

```bash
./install.sh           # link all skills into ~/.claude/skills and ~/.codebuddy/skills
./install.sh --remove  # unlink
```

- Idempotent: re-running skips links that are already correct.
- Never overwrites a real directory at the target — it errors and asks the
  human to move it aside first.
- On a new machine: `git clone <this-repo> && cd skills && ./install.sh`.

## Skill File Format

Every skill is a markdown file with YAML frontmatter:

```markdown
---
name: skill-name
description: One-line description. Agents use this to decide when to invoke the skill.
---

# Skill Title

Instructions...
```

- `name` must be unique across the repo and match the directory name.
- `description` must be specific enough for an agent to distinguish this skill
  from others (include trigger phrases in the user's language when relevant).
- The body after the frontmatter is the full instruction set the agent follows.
- Reference supporting scripts as "next to this SKILL.md" — do not hardcode
  tool-specific paths or env vars (the same skill must work under Claude Code,
  CodeBuddy, etc.).

## Adding a New Skill

1. Create `skills/<category>/<skill-name>/` (create the category dir if new).
2. Copy `templates/skill-template.md` to that folder as `SKILL.md`, fill in
   frontmatter (`name`, `description`).
3. Add supporting scripts alongside `SKILL.md`, plus `test_<name>.py` covering
   the behaviors the SKILL.md promises (see `skills/document/md2word/` for the
   pattern: convert a fixture, assert the documented invariants).
4. Add a `.gitignore` for credentials or build artifacts (e.g., `.config.json`,
   `__pycache__/`).
5. Update `index.md` with the new skill entry.
6. Run `./scripts/validate.py` — all checks must pass.
7. Run `./install.sh` to link it, then smoke-test by invoking `/<skill-name>`.

## Iterating This Repo (for agents)

This repo is meant to evolve through use. When you (the agent) hit friction
while using a skill — a bug in a script, a missing subcommand, instructions
that didn't match reality — **fix the skill, don't work around it**:

1. Fix the script and/or SKILL.md in this repo (skills are symlinked, so the
   fix takes effect immediately).
2. Add or update a test that would have caught the problem.
3. If the SKILL.md's promises changed (new command, changed behavior), update
   its command tables and `index.md` description.
4. Run `./scripts/validate.py` before committing — it checks frontmatter,
   index sync, and runs every skill's pytest suite. CI runs the same checks on
   push; a red CI means drift between docs, code, and tests.
5. Commit with conventional-commit style, scoped to the skill:
   `fix(zentao): ...`, `feat(md2word): ...`, `docs: ...`.
6. Leave the final review to the owner — they are the mentor and decide what
   lands on `main`.

Keep edits minimal and behavior-preserving unless the owner asked for a change.
Never commit credentials (`.config.json` and friends stay git-ignored).
