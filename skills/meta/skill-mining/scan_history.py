#!/usr/bin/env python3
"""Scan local CLI-agent history into a compact markdown digest for skill mining.

Aggregates the sources an agent needs for a "what should we solidify?" review:

  1. ~/.codebuddy/history.jsonl            CodeBuddy prompt history
  2. ~/.claude/projects/*/*.jsonl          Claude Code transcripts (top level;
                                           subagent files excluded)
  3. ~/.bash_history / ~/.zsh_history      manual shell commands — consecutive
                                           retry runs (same command xN) are the
                                           strongest pain signal
  4. ~/.codebuddy/projects/*/memory/*.md   memory inventory (don't re-propose)
  5. ~/.claude/skills, ~/.codebuddy/skills installed skills (don't re-propose)

Usage:
  python3 scan_history.py                      # digest to stdout, 30-day window
  python3 scan_history.py --days 60 -o digest.md
"""
import argparse
import glob
import json
import os
import re
import sys
from datetime import datetime, timedelta

HOME = os.path.expanduser("~")
CODEBUDDY_HISTORY = os.path.join(HOME, ".codebuddy", "history.jsonl")
CLAUDE_PROJECTS = os.path.join(HOME, ".claude", "projects")
SHELL_HISTORIES = [os.path.join(HOME, ".bash_history"),
                   os.path.join(HOME, ".zsh_history")]
MEMORY_GLOB = os.path.join(HOME, ".codebuddy", "projects", "*", "memory", "*.md")
SKILL_DIRS = [os.path.join(HOME, ".claude", "skills"),
              os.path.join(HOME, ".codebuddy", "skills")]

TRUNC = 200
RETRY_THRESHOLD = 3  # consecutive repeats >= this get the pain marker


def truncate(text, limit=TRUNC):
    t = re.sub(r"\s+", " ", text).strip()
    return t if len(t) <= limit else t[:limit] + "…"


def is_prompt_text(text):
    """Keep only genuine user prompts; drop system/tool noise."""
    t = (text or "").strip()
    if not t:
        return False
    if t.startswith("<"):  # <system-reminder>, <command-*> etc.
        return False
    if t.startswith("[Request interrupted"):
        return False
    if t.startswith("Caveat:"):
        return False
    return True


def iter_codebuddy_history(path, since_dt):
    """Yield (mm-dd HH:MM, project, text) from CodeBuddy history.jsonl."""
    if not os.path.isfile(path):
        return
    since_ts = since_dt.timestamp()
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(d, dict):
                continue
            ts = d.get("timestamp", 0) / 1000
            if ts < since_ts:
                continue
            text = d.get("display") or ""
            if not is_prompt_text(text):
                continue
            proj = (d.get("project") or "").replace(HOME, "~")
            yield (datetime.fromtimestamp(ts).strftime("%m-%d %H:%M"), proj, text)


def extract_claude_prompts(path, max_per_file=None):
    """Parse one Claude Code transcript -> [(mm-dd HH:MM, text)].

    Transcript lines are JSON; user turns have type=user and message.content
    as either a string or a list of content blocks. tool_result blocks carry
    no text and are filtered out naturally.
    """
    prompts = []
    with open(path, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(d, dict):
                continue
            if d.get("type") != "user":
                continue
            content = (d.get("message") or {}).get("content")
            if isinstance(content, str):
                text = content
            elif isinstance(content, list):
                text = "".join(c.get("text", "") for c in content
                               if isinstance(c, dict) and c.get("type") == "text")
            else:
                continue
            if not is_prompt_text(text):
                continue
            ts = (d.get("timestamp") or "")[5:16].replace("T", " ")
            prompts.append((ts, text))
            if max_per_file and len(prompts) >= max_per_file:
                break
    return prompts


def iter_claude_projects(root, since_dt, max_per_file):
    """Yield (project, session_id, prompts) for transcripts modified in window."""
    if not os.path.isdir(root):
        return
    since_ts = since_dt.timestamp()
    for path in sorted(glob.glob(os.path.join(root, "*", "*.jsonl"))):
        if os.path.getmtime(path) < since_ts:
            continue
        project = os.path.basename(os.path.dirname(path))
        prompts = extract_claude_prompts(path, max_per_file)
        if prompts:
            yield (project, os.path.basename(path)[:8], prompts)


def read_shell_history(path, max_lines):
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8", errors="replace") as fh:
        lines = [ln.strip() for ln in fh if ln.strip()]
    return lines[-max_lines:]


def collapse_runs(cmds):
    """Collapse consecutive identical commands -> [[cmd, count], ...].

    count >= RETRY_THRESHOLD marks a retry pattern: a human fighting the
    same failing command over and over — prime automation candidate.
    """
    runs = []
    for c in cmds:
        if runs and runs[-1][0] == c:
            runs[-1][1] += 1
        else:
            runs.append([c, 1])
    return runs


def memory_inventory():
    out = []
    for p in sorted(glob.glob(MEMORY_GLOB)):
        proj = os.path.basename(os.path.dirname(os.path.dirname(p)))
        out.append(f"{proj}/{os.path.basename(p)}")
    return out


def installed_skills():
    out = {}
    for d in SKILL_DIRS:
        if os.path.isdir(d):
            label = os.path.basename(os.path.dirname(d))  # .claude / .codebuddy
            out[label] = sorted(os.listdir(d))
    return out


def build_digest(days, max_per_file, shell_max):
    since = datetime.now() - timedelta(days=days)
    now = datetime.now()
    cb = list(iter_codebuddy_history(CODEBUDDY_HISTORY, since))
    claude = list(iter_claude_projects(CLAUDE_PROJECTS, since, max_per_file))

    parts = [
        "# 工作记录扫描摘要\n",
        f"- 时间窗: {since:%Y-%m-%d} → {now:%Y-%m-%d}（{days} 天）",
        f"- 生成时间: {now:%Y-%m-%d %H:%M}\n",
        "## 数据源概况\n",
        f"- CodeBuddy prompts: {len(cb)} 条",
        f"- Claude Code 会话: {len(claude)} 个（每个最多取前 {max_per_file} 条 prompt）\n",
        f"## CodeBuddy prompts（{len(cb)} 条）\n",
    ]
    for ts, proj, text in cb:
        parts.append(f"- `{ts}` [{proj}] {truncate(text)}")

    parts.append("\n## Claude Code prompts（按项目/会话）\n")
    for project, sid, prompts in claude:
        parts.append(f"### {project} / {sid}（{len(prompts)} 条）\n")
        for ts, text in prompts:
            parts.append(f"- `{ts}` {truncate(text)}")

    parts.append(f"\n## shell 手工命令（⚠×N，N≥{RETRY_THRESHOLD} = 连续重试，最强痛点信号）\n")
    for hist in SHELL_HISTORIES:
        if not os.path.isfile(hist):
            continue
        cmds = read_shell_history(hist, shell_max)
        runs = collapse_runs(cmds)
        parts.append(f"### {hist.replace(HOME, '~')}"
                     f"（最近 {len(cmds)} 条，去重后 {len(runs)} 条）\n")
        for cmd, n in runs:
            mark = f" ⚠ ×{n}" if n >= RETRY_THRESHOLD else (f" ×{n}" if n > 1 else "")
            parts.append(f"- `{truncate(cmd, 120)}`{mark}")

    parts.append("\n## memory 已沉淀（避免重复提议）\n")
    parts += [f"- {m}" for m in memory_inventory()]

    parts.append("\n## 已安装 skills（避免重复提议）\n")
    for label, skills in installed_skills().items():
        parts.append(f"- {label}: {', '.join(skills)}")

    return "\n".join(parts) + "\n"


def main():
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--days", type=int, default=30,
                    help="history window in days (default %(default)s)")
    ap.add_argument("--max-per-file", type=int, default=40,
                    help="max prompts to take per Claude transcript "
                         "(default %(default)s)")
    ap.add_argument("--shell-max", type=int, default=300,
                    help="max lines to read per shell history (default %(default)s)")
    ap.add_argument("-o", "--output", default=None,
                    help="write digest here instead of stdout")
    args = ap.parse_args()

    digest = build_digest(args.days, args.max_per_file, args.shell_max)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(digest)
        print(f"digest written: {args.output} ({len(digest)} chars)")
    else:
        sys.stdout.write(digest)


if __name__ == "__main__":
    main()
