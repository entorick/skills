#!/usr/bin/env python3
"""Validate the skills repository.

Checks (run locally before committing; also runs in CI):

1. Every skills/<category>/<skill>/SKILL.md has YAML frontmatter with a
   unique `name` (matching its directory) and a specific `description`.
2. index.md stays in sync with the skills on disk (no missing/stale entries).
3. pytest passes for every skill that ships test_*.py files.

Usage: ./scripts/validate.py
Exit code 0 = all green, 1 = at least one check failed.
"""
import os
import re
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SKILLS_DIR = os.path.join(REPO_ROOT, "skills")
INDEX_MD = os.path.join(REPO_ROOT, "index.md")

MIN_DESCRIPTION_LEN = 20

failures = []


def fail(msg):
    failures.append(msg)
    print("FAIL  %s" % msg)


def ok(msg):
    print("ok    %s" % msg)


def find_skill_dirs():
    for category in sorted(os.listdir(SKILLS_DIR)):
        cat_dir = os.path.join(SKILLS_DIR, category)
        if not os.path.isdir(cat_dir):
            continue
        for name in sorted(os.listdir(cat_dir)):
            skill_dir = os.path.join(cat_dir, name)
            if os.path.isfile(os.path.join(skill_dir, "SKILL.md")):
                yield category, name, skill_dir


def parse_frontmatter(path):
    """Return dict of frontmatter keys, or None if missing/invalid."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    m = re.match(r"^---\n(.*?)\n---\n", text, re.DOTALL)
    if not m:
        return None
    data = {}
    for line in m.group(1).splitlines():
        kv = re.match(r"^(\w[\w-]*):\s*(.+)$", line)
        if kv:
            data[kv.group(1)] = kv.group(2).strip()
    return data


def check_frontmatter(skills):
    print("== SKILL.md frontmatter ==")
    seen = {}
    for category, name, skill_dir in skills:
        path = os.path.join(skill_dir, "SKILL.md")
        rel = os.path.relpath(path, REPO_ROOT)
        fm = parse_frontmatter(path)
        if fm is None:
            fail("%s: missing or malformed YAML frontmatter" % rel)
            continue
        skill_name = fm.get("name", "")
        desc = fm.get("description", "")
        if not skill_name:
            fail("%s: frontmatter missing `name`" % rel)
        elif skill_name != name:
            fail("%s: name '%s' != directory name '%s'" % (rel, skill_name, name))
        elif skill_name in seen:
            fail("%s: duplicate name '%s' (also in %s)" % (rel, skill_name, seen[skill_name]))
        else:
            seen[skill_name] = rel
        if len(desc) < MIN_DESCRIPTION_LEN:
            fail("%s: description missing or too short (< %d chars) — agents "
                 "rely on it to decide when to invoke the skill"
                 % (rel, MIN_DESCRIPTION_LEN))
    if not failures:
        ok("%d skill(s) have valid frontmatter" % len(skills))


def check_index_sync(skills):
    print("== index.md sync ==")
    if not os.path.isfile(INDEX_MD):
        fail("index.md not found")
        return
    with open(INDEX_MD, encoding="utf-8") as f:
        index = f.read()
    before = len(failures)
    for category, name, skill_dir in skills:
        link = "skills/%s/%s/" % (category, name)
        if link not in index:
            fail("index.md: missing entry linking to %s" % link)
    for m in re.finditer(r"\]\((skills/[^)]+)/\)", index):
        if not os.path.isdir(os.path.join(REPO_ROOT, m.group(1))):
            fail("index.md: stale entry %s (directory does not exist)" % m.group(1))
    if len(failures) == before:
        ok("index.md is in sync with %d skill(s) on disk" % len(skills))


def check_tests(skills):
    print("== skill tests ==")
    tested = 0
    for category, name, skill_dir in skills:
        has_tests = any(f.startswith("test_") and f.endswith(".py")
                        for f in os.listdir(skill_dir))
        if not has_tests:
            continue
        tested += 1
        r = subprocess.run(
            [PYTEST_PY, "-m", "pytest", skill_dir, "-q", "--no-header"],
            capture_output=True, text=True, cwd=REPO_ROOT)
        if r.returncode != 0:
            tail = "\n".join((r.stdout + r.stderr).splitlines()[-15:])
            fail("%s/%s: pytest failed\n%s" % (category, name, tail))
        else:
            last = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
            ok("%s/%s: %s" % (category, name, last))
    if tested == 0:
        print("      (no skills ship tests yet)")


def _find_pytest_interpreter():
    """Pick an interpreter that has pytest: prefer this one, else probe common names."""
    candidates = [sys.executable] + [
        "python3.%d" % minor for minor in range(13, 8, -1)] + ["python3"]
    for cand in candidates:
        try:
            r = subprocess.run([cand, "-c", "import pytest"],
                               capture_output=True)
            if r.returncode == 0:
                return cand
        except (OSError, subprocess.SubprocessError):
            continue
    return None


def main():
    global PYTEST_PY
    skills = list(find_skill_dirs())
    if not skills:
        fail("no skills found under %s" % SKILLS_DIR)
    check_frontmatter(skills)
    check_index_sync(skills)
    PYTEST_PY = _find_pytest_interpreter()
    if PYTEST_PY is None:
        fail("no python interpreter with pytest found "
             "(install pytest into any python3.x on PATH)")
    else:
        check_tests(skills)
    print()
    if failures:
        print("%d check(s) FAILED" % len(failures))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
