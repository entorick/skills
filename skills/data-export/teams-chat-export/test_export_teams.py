"""Tests for the pure helpers in export_teams.py (no MCP server needed)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from export_teams import (dedup_key, message_markdown, parse_conversation_list,
                          parse_messages, safe_filename, write_index)

LIST_FIXTURE = """c:b6dded [group] "AI Chatbot 业务快速沟通群" · 3079 msg
c:abc123 "Li George" · 5 msg
c:zero00 "Empty Chat" · 0 msg
noise line without id
"""

MSG_FIXTURE = """viewer: me@example.com
as_of 2026-07-22
older: older:1784615658995:1784615658995
07-21 14:59 Li George> MinerU 重启好了吗
07-21 15:00   ↳> 已经好了
07-21 15:01 Zhang San> 多行消息第一行
第二行内容
"""


def test_parse_conversation_list():
    convs = parse_conversation_list(LIST_FIXTURE)
    assert len(convs) == 2  # 0-msg chat and noise are dropped
    group = convs[0]
    assert group["id"] == "c:b6dded"
    assert group["name"] == "AI Chatbot 业务快速沟通群"
    assert group["msg_count"] == 3079
    assert group["is_group"] is True
    assert convs[1]["is_group"] is False


def test_parse_conversation_list_empty():
    assert parse_conversation_list("") == []
    assert parse_conversation_list(None) == []


def test_parse_messages_basic_and_reply_folding():
    msgs, cursor = parse_messages(MSG_FIXTURE)
    assert cursor == "older:1784615658995:1784615658995"
    assert len(msgs) == 2
    assert msgs[0]["sender"] == "Li George"
    assert "↳ 已经好了" in msgs[0]["body"]  # reply folded into parent
    assert msgs[1]["body"] == "多行消息第一行\n第二行内容"


def test_parse_messages_bare_cursor_and_year_timestamp():
    text = "older:1784615658995:1784615658995\n2025-06-27 10:00 A> hi\n"
    msgs, cursor = parse_messages(text)
    assert cursor == "older:1784615658995:1784615658995"
    assert msgs[0]["timestamp"] == "2025-06-27 10:00"


def test_parse_messages_empty():
    assert parse_messages("") == ([], None)


def test_dedup_key():
    a = {"timestamp": "07-21 14:59", "sender": "Li George"}
    b = {"timestamp": "07-21 14:59", "sender": "Li George"}
    c = {"timestamp": "07-21 15:00", "sender": "Li George"}
    assert dedup_key(a) == dedup_key(b)
    assert dedup_key(a) != dedup_key(c)


def test_safe_filename():
    assert safe_filename("AI Chatbot 业务快速沟通群") == "AI_Chatbot_业务快速沟通群"
    assert safe_filename("a/b:c*d") == "a_b_c_d"
    assert safe_filename("") == ""
    assert safe_filename("", fallback_id="c:abc") == "c_abc"


def test_message_markdown_media_placeholder():
    md = message_markdown({"timestamp": "07-21 14:59", "sender": "A", "body": ""})
    assert "[图片/视频/多媒体内容]" in md
    assert "### [07-21 14:59] A" in md


def test_write_index(tmp_path):
    exported = [{
        "name": "测试群", "file": str(tmp_path / "测试群.md"), "messages": 10,
        "is_group": True, "first_ts": "01-04 10:05", "last_ts": "07-21 14:59",
    }]
    path = write_index(exported, str(tmp_path))
    content = open(path, encoding="utf-8").read()
    assert "测试群.md" in content
    assert "01-04 10:05" in content
    assert "07-21 14:59" in content
    assert "群聊" in content
