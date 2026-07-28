"""Tests for the pure helpers in scan_history.py."""
import json
import os
import sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from scan_history import (RETRY_THRESHOLD, collapse_runs, extract_claude_prompts,
                          is_prompt_text, iter_codebuddy_history, truncate)


def test_truncate():
    assert truncate("short") == "short"
    assert truncate("a" * 300).endswith("…")
    assert truncate("line1\n\nline2") == "line1 line2"


def test_is_prompt_text():
    assert is_prompt_text("帮我看一下这个 bug") is True
    assert is_prompt_text("") is False
    assert is_prompt_text("   ") is False
    assert is_prompt_text("<system-reminder>x</system-reminder>") is False
    assert is_prompt_text("[Request interrupted by user]") is False
    assert is_prompt_text("Caveat: messages below") is False


def _write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


def test_iter_codebuddy_history(tmp_path):
    now_ms = datetime.now().timestamp() * 1000
    old_ms = (datetime.now() - timedelta(days=90)).timestamp() * 1000
    p = tmp_path / "history.jsonl"
    _write_jsonl(p, [
        {"display": "新任务", "timestamp": now_ms, "project": "/x"},
        {"display": "旧任务", "timestamp": old_ms, "project": "/x"},
        {"display": "", "timestamp": now_ms, "project": "/x"},
        {"display": "<command-name>/model</command-name>", "timestamp": now_ms},
        "not json",
    ])
    # raw line "not json" breaks json.loads -> must be skipped, not crash
    with open(p, "a", encoding="utf-8") as f:
        f.write("not json\n")

    since = datetime.now() - timedelta(days=30)
    rows = list(iter_codebuddy_history(str(p), since))
    assert len(rows) == 1
    assert rows[0][2] == "新任务"


def test_extract_claude_prompts(tmp_path):
    p = tmp_path / "session.jsonl"
    _write_jsonl(p, [
        {"type": "user", "timestamp": "2026-07-08T11:31:00Z",
         "message": {"content": "导出 teams 聊天"}},
        {"type": "assistant", "message": {"content": "好的"}},
        {"type": "user", "timestamp": "2026-07-08T11:32:00Z",
         "message": {"content": [{"type": "text", "text": "继续"},
                                  {"type": "tool_result", "content": "..."}]}},
        {"type": "user", "timestamp": "2026-07-08T11:33:00Z",
         "message": {"content": [{"type": "tool_result", "content": "..."}]}},
        {"type": "user", "timestamp": "2026-07-08T11:34:00Z",
         "message": {"content": "[Request interrupted by user]"}},
    ])
    prompts = extract_claude_prompts(str(p))
    assert [t for _, t in prompts] == ["导出 teams 聊天", "继续"]
    assert prompts[0][0] == "07-08 11:31"


def test_extract_claude_prompts_max_per_file(tmp_path):
    p = tmp_path / "s.jsonl"
    _write_jsonl(p, [
        {"type": "user", "timestamp": f"2026-07-08T11:{i:02d}:00Z",
         "message": {"content": f"prompt {i}"}} for i in range(10)
    ])
    assert len(extract_claude_prompts(str(p), max_per_file=3)) == 3


def test_collapse_runs_marks_retries():
    runs = collapse_runs(["git pull", "git clone x", "git clone x",
                          "git clone x", "ls", "ls"])
    assert runs == [["git pull", 1], ["git clone x", 3], ["ls", 2]]
    assert runs[1][1] >= RETRY_THRESHOLD  # would get the ⚠ marker


def test_collapse_runs_empty():
    assert collapse_runs([]) == []
