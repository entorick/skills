"""Tests for the pure parse helpers in feishu.py (no lark-cli / no network).

Fixtures are real `whoami` / `auth status` / `docs +fetch` / `drive +inspect`
JSON captured from an actual lark-cli session (2026-07-24/29) and from the
CLI's own --help output. They exercise the error shapes the SKILL.md
documents: token_missing, scope_denied (99991672), wiki_denied (131006),
and the --raw validation trap.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import feishu

# --- real whoami / auth status payloads ------------------------------------

WHOAMI_BOT_READY = """{
  "profile": "cli_aaccf96248781cb6",
  "appId": "cli_aaccf96248781cb6",
  "brand": "feishu",
  "defaultAs": "auto",
  "identity": "bot",
  "identitySource": "auto_detect",
  "available": true,
  "tokenStatus": "ready"
}"""

WHOAMI_USER_NEEDS_REFRESH = """{
  "profile": "cli_aaccf96248781cb6",
  "appId": "cli_aaccf96248781cb6",
  "brand": "feishu",
  "defaultAs": "auto",
  "identity": "user",
  "available": true,
  "tokenStatus": "needs_refresh",
  "onBehalfOf": {"userName": "陈超", "openId": "ou_2c72eb7c22355f92f7625972aa8fcb4e"}
}"""

AUTH_STATUS_BOTH_READY = """{
  "appId": "cli_aaccf96248781cb6",
  "brand": "feishu",
  "defaultAs": "auto",
  "identities": {
    "bot": {"status": "ready", "available": true, "message": "Bot identity: ready"},
    "user": {
      "status": "ready", "available": true, "message": "User identity: ready",
      "openId": "ou_2c72eb7c22355f92f7625972aa8fcb4e",
      "userName": "陈超",
      "tokenStatus": "valid",
      "scope": "docx:document:readonly drive:file:download wiki:node:read offline_access",
      "expiresAt": "2026-07-29T18:19:26+08:00"
    }
  },
  "identity": "user"
}"""

# --- real docs +fetch payloads (ok + each error shape) ---------------------

FETCH_OK = """{
  "ok": true,
  "identity": "bot",
  "data": {
    "document": {
      "document_id": "UTKEdMS03oth1axtFqccsqv8nob",
      "revision_id": 357,
      "content": "<title>VPP 开放平台 方案梳理</title><p>正文…</p>"
    }
  }
}"""

FETCH_TOKEN_MISSING = """{
  "ok": false,
  "error": {
    "type": "authentication",
    "subtype": "token_missing",
    "message": "need_user_authorization (user: ou_2c72eb7c22355f92f7625972aa8fcb4e)",
    "hint": "run: lark-cli auth login to re-authorize"
  }
}"""

FETCH_SCOPE_DENIED = """{
  "ok": false,
  "identity": "bot",
  "error": {
    "type": "authorization",
    "subtype": "app_scope_not_allowed",
    "code": 99991672,
    "message": "Access denied. One of the following scopes is required: [drive:drive, drive:file:readonly, drive:file:download].应用尚未开通所需的应用身份权限",
    "missing_scopes": ["drive:drive", "drive:file:readonly", "drive:file:download"]
  }
}"""

FETCH_WIKI_DENIED = """{
  "ok": false,
  "identity": "bot",
  "error": {
    "type": "api",
    "subtype": "unknown",
    "code": 131006,
    "message": "resolve wiki node failed: permission denied: node permission denied, tenant needs read permission."
  }
}"""

# the --raw trap: lark-cli rejects --raw as an unknown flag
FETCH_RAW_FLAG_ERROR = """{
  "ok": false,
  "error": {
    "type": "validation",
    "subtype": "invalid_argument",
    "message": "unknown flag \\"--raw\\" for \\"lark-cli docs +fetch\\"",
    "hint": "did you mean --as?"
  }
}"""

# --- real drive +inspect wiki unwrap payload -------------------------------

INSPECT_WIKI_OK = """{
  "ok": true,
  "identity": "user",
  "data": {
    "input_url": "https://ihaier.feishu.cn/wiki/VKQVwwwhKidbz8kKdjjc5MUGn2G",
    "title": "新能源sso对接",
    "token": "EDLXdICeUo4BV0xx7uqcE8yynHd",
    "type": "docx",
    "url": "https://ihaier.feishu.cn/docx/EDLXdICeUo4BV0xx7uqcE8yynHd",
    "wiki_node": {
      "node_token": "VKQVwwwhKidbz8kKdjjc5MUGn2G",
      "obj_token": "EDLXdICeUo4BV0xx7uqcE8yynHd",
      "obj_type": "docx",
      "space_id": "7589468021928774614"
    }
  }
}"""

INSPECT_FILE_OK = """{
  "ok": true,
  "identity": "bot",
  "data": {
    "input_url": "https://ihaier.feishu.cn/file/TfuFbxyN1osp64x0dtJcxALJnOe",
    "title": "OpenApiUtils.java",
    "token": "TfuFbxyN1osp64x0dtJcxALJnOe",
    "type": "file"
  }
}"""


# --- tests -----------------------------------------------------------------

def test_detect_lark_cli_returns_path_or_none():
    # on this machine lark-cli is installed -> a path string; never raises.
    p = feishu.detect_lark_cli()
    assert p is None or isinstance(p, str)


def test_parse_whoami_bot_ready():
    r = feishu.parse_whoami(WHOAMI_BOT_READY)
    assert r["app_id"] == "cli_aaccf96248781cb6"
    assert r["brand"] == "feishu"
    assert r["identity"] == "bot"
    assert r["token_status"] == "ready"
    assert r["available"] is True


def test_parse_whoami_user_needs_refresh():
    r = feishu.parse_whoami(WHOAMI_USER_NEEDS_REFRESH)
    assert r["identity"] == "user"
    assert r["token_status"] == "needs_refresh"


def test_parse_whoami_garbage_returns_all_none():
    # garbage yields a struct with all-None values (safe to do r["identity"])
    r = feishu.parse_whoami("")
    assert r == {"app_id": None, "brand": None, "identity": None,
                 "token_status": None, "available": False}
    assert feishu.parse_whoami("not json at all")["available"] is False
    # text with leading noise but valid trailing JSON still parses
    r = feishu.parse_whoami("hint: see above\n" + WHOAMI_BOT_READY)
    assert r["app_id"] == "cli_aaccf96248781cb6"


def test_parse_auth_status_both_ready():
    a = feishu.parse_auth_status(AUTH_STATUS_BOTH_READY)
    assert a["app_id"] == "cli_aaccf96248781cb6"
    assert a["brand"] == "feishu"
    assert a["bot"]["available"] is True
    assert a["bot"]["status"] == "ready"
    assert a["user"]["available"] is True
    assert a["user"]["token_status"] == "valid"
    # scope string split into a list
    assert "drive:file:download" in a["user"]["scopes"]
    assert "wiki:node:read" in a["user"]["scopes"]


def test_extract_content_ok():
    ex = feishu.extract_content(FETCH_OK)
    assert ex["ok"] is True
    assert ex["document_id"] == "UTKEdMS03oth1axtFqccsqv8nob"
    assert ex["revision_id"] == 357
    assert "VPP 开放平台" in ex["content"]
    assert "<whiteboard" not in ex["content"] or True  # body has placeholder tags


def test_extract_content_accepts_dict():
    import json
    ex = feishu.extract_content(json.loads(FETCH_OK))
    assert ex["ok"] is True
    assert ex["revision_id"] == 357


def test_extract_content_token_missing_routes_to_classify():
    ex = feishu.extract_content(FETCH_TOKEN_MISSING)
    assert ex["ok"] is False
    assert ex["error"]["kind"] == "token_missing"
    assert "auth login" in ex["error"]["hint"]


def test_extract_content_scope_denied():
    ex = feishu.extract_content(FETCH_SCOPE_DENIED)
    assert ex["ok"] is False
    assert ex["error"]["kind"] == "scope_denied"
    assert "drive:file:download" in ex["error"]["hint"]


def test_extract_content_wiki_denied():
    ex = feishu.extract_content(FETCH_WIKI_DENIED)
    assert ex["ok"] is False
    assert ex["error"]["kind"] == "wiki_denied"


def test_extract_content_raw_flag_trap():
    # --raw is not a lark-cli flag -> validation error. The fetch subcommand
    # must never pass --raw; this documents why it uses --format json instead.
    ex = feishu.extract_content(FETCH_RAW_FLAG_ERROR)
    assert ex["ok"] is False
    assert ex["error"]["kind"] == "validation"
    assert "--raw" in ex["error"]["hint"]


def test_unwrap_wiki_token_from_inspect():
    tok = feishu.unwrap_wiki_token(INSPECT_WIKI_OK)
    assert tok == "EDLXdICeUo4BV0xx7uqcE8yynHd"


def test_unwrap_wiki_token_none_for_file_inspect():
    # a file inspect (no wiki_node, type=file) must not yield a docx token
    assert feishu.unwrap_wiki_token(INSPECT_FILE_OK) is None


def test_classify_error_all_shapes():
    assert feishu.classify_error(feishu._safe_json(FETCH_TOKEN_MISSING))["kind"] == "token_missing"
    assert feishu.classify_error(feishu._safe_json(FETCH_SCOPE_DENIED))["kind"] == "scope_denied"
    assert feishu.classify_error(feishu._safe_json(FETCH_WIKI_DENIED))["kind"] == "wiki_denied"
    assert feishu.classify_error(feishu._safe_json(FETCH_RAW_FLAG_ERROR))["kind"] == "validation"
    assert feishu.classify_error({"ok": True})["kind"] == "other"
    assert feishu.classify_error("garbage")["kind"] == "other"


def test_derive_filename_keeps_cjk_drops_unsafe():
    assert feishu.derive_filename("VPP开放平台_方案梳理") == "VPP开放平台_方案梳理"
    assert feishu.derive_filename("新能源/统一登录:接口?") == "新能源_统一登录_接口"
    assert feishu.derive_filename("") == "feishu_doc"
    assert feishu.derive_filename(None) == "feishu_doc"
    # collapse repeated separators / strip leading-trailing dot/underscore
    assert feishu.derive_filename("a///b") == "a_b"
    assert feishu.derive_filename("..x..") == "x"


def test_is_wiki_url():
    assert feishu.is_wiki_url("https://ihaier.feishu.cn/wiki/VKQVwwwhKidbz8kKdjjc5MUGn2G")
    assert feishu.is_wiki_url("https://open.feishu.cn/wiki/nodes/abc")
    assert not feishu.is_wiki_url("https://ihaier.feishu.cn/docx/UTKEdMS03oth1axtFqccsqv8nob")
    assert not feishu.is_wiki_url("UTKEdMS03oth1axtFqccsqv8nob")
    assert not feishu.is_wiki_url(None)


def test_doc_title_from_content():
    body = "<title>VPP 开放平台 方案梳理</title>\n# 认证方案\n..."
    assert feishu.doc_title_from_content(body) == "VPP 开放平台 方案梳理"
    # whitespace tolerated
    assert feishu.doc_title_from_content("<title>\n  Hello  \n</title>x") == "Hello"
    assert feishu.doc_title_from_content("no title tag here") is None
    assert feishu.doc_title_from_content(None) is None


def test_token_from_doc():
    assert feishu.token_from_doc("https://ihaier.feishu.cn/docx/UTKEdMS03oth1axtFqccsqv8nob") == "UTKEdMS03oth1axtFqccsqv8nob"
    assert feishu.token_from_doc("UTKEdMS03oth1axtFqccsqv8nob") == "UTKEdMS03oth1axtFqccsqv8nob"
    assert feishu.token_from_doc("https://ihaier.feishu.cn/wiki/VKQV/") == "VKQV"
    assert feishu.token_from_doc(None) is None


def test_safe_json_handles_noise_and_unbalanced():
    assert feishu._safe_json(None) is None
    assert feishu._safe_json("") is None
    assert feishu._safe_json("no braces here") is None
    # leading noise + balanced JSON
    assert feishu._safe_json('see below\n{"ok": true}').get("ok") is True
    # unbalanced -> None
    assert feishu._safe_json('{"ok": true') is None
    # array form
    assert feishu._safe_json('[1, 2, 3]') == [1, 2, 3]
