#!/usr/bin/env python3
"""feishu — access Feishu (飞书) resources via lark-cli.

lark-cli (npm package @larksuite/cli) is the official CLI for the Lark/Feishu
open platform. On a machine with it installed + authenticated, it behaves like
a local Feishu MCP: read docx / wiki / sheets / base / drive resources.

This helper wraps the fragile mechanics so an agent doesn't re-trip the same
pitfalls every session:

  - doctor   detect lark-cli + report auth state (read-only, no network by default)
  - install  `npm install -g @larksuite/cli` + report the resulting binary path
  - fetch    export one Feishu doc to <name>.raw.json + <name>.md
              (uses --format json -> file then Python extract, NOT --raw —
               --raw is not a lark-cli flag and silently leaves 0-byte files)

The pure parse helpers below (parse_whoami, parse_auth_status, extract_content,
unwrap_wiki_token, classify_error, derive_filename, detect_lark_cli) have
pytest coverage and never touch the network. The subprocess runners call
lark-cli only when a subcommand is invoked.

Requirements: lark-cli on PATH (run `install` / see SKILL.md). Python 3.8+.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys

LARK_BIN = "lark-cli"          # the executable name (NOT `lark` — npx picks the wrong pkg)
LARK_NPM_PKG = "@larksuite/cli"


def _force_utf8_stdio():
    for stream in (sys.stdout, sys.stderr):
        fn = getattr(stream, "reconfigure", None)
        if fn:
            try:
                fn(encoding="utf-8")
            except (ValueError, OSError):
                pass


def _output(obj):
    print(json.dumps(obj, ensure_ascii=False, indent=2))


# ---------------------------------------------------------------------------
# Pure parse helpers (pytest-covered, no network)
# ---------------------------------------------------------------------------

def detect_lark_cli():
    """Return the lark-cli binary path, or None if not on PATH.

    Must look for `lark-cli`, not `lark` — `which lark` is empty even when
    installed, and `npx lark` pulls an unrelated `lark` package.
    """
    return shutil.which(LARK_BIN) or shutil.which(LARK_BIN + ".cmd")


def _safe_json(text):
    """Best-effort parse of text that may have leading/trailing noise.

    lark-cli --format json emits clean JSON, but `doctor`/`whoami` sometimes
    print a human line before/after. Find the first balanced JSON object.
    """
    if text is None:
        return None
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    start = text.find("{")
    if start < 0:
        start = text.find("[")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    for i in range(start, len(text)):
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c in "{[":
            depth += 1
        elif c in "}]":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start:i + 1])
                except json.JSONDecodeError:
                    return None
    return None


def parse_whoami(text):
    """Parse `lark-cli whoami` JSON -> dict of readiness signals.

    Returns a struct with all-None values on garbage (callers can safely do
    r["identity"]). Keys: app_id, brand, identity, token_status,
    available (bool). whoami only reports the *current* identity; use
    parse_auth_status for a full bot+user picture.
    """
    d = _safe_json(text) or {}
    return {
        "app_id": d.get("appId") or d.get("profile"),
        "brand": d.get("brand"),
        "identity": d.get("identity"),
        "token_status": d.get("tokenStatus"),
        "available": bool(d.get("available")),
    }


def parse_auth_status(text):
    """Parse `lark-cli auth status` JSON -> readiness of bot + user identities.

    auth_status is the richest health check: it shows BOTH identities' state,
    the user's full scope list, and token expiry. Prefer it over whoami for
    diagnosis. Returns {} on garbage.
    """
    d = _safe_json(text) or {}
    out = {"app_id": d.get("appId"), "brand": d.get("brand"),
           "identity": d.get("identity")}
    ids = d.get("identities") or {}
    for who in ("bot", "user"):
        blk = ids.get(who) or {}
        out[who] = {
            "available": bool(blk.get("available")),
            "status": blk.get("status"),
            "token_status": blk.get("tokenStatus"),
            "message": blk.get("message"),
        }
    user_blk = ids.get("user") or {}
    if user_blk.get("scope"):
        out["user"]["scopes"] = user_blk["scope"].split()
    return out


def extract_content(raw):
    """Pull the doc body out of a `docs +fetch --format json` response.

    `raw` is either the parsed dict or the raw JSON text. Returns
    {ok, content, document_id, revision_id} or {ok:False, error:...}.

    The body lives at data.document.content. This is the proven save pattern:
    redirect `--format json` to <name>.raw.json, then extract here — do NOT
    pass --raw (it is not a lark-cli flag) or pipe content through the prompt.
    """
    if isinstance(raw, str):
        raw = _safe_json(raw) or {}
    if not isinstance(raw, dict):
        return {"ok": False, "error": "non-JSON or non-object response"}
    # lark-cli errors carry ok:false; route them to classify_error for a hint.
    if raw.get("ok") is False:
        return {"ok": False, "error": classify_error(raw)}
    doc = (((raw.get("data") or {}).get("document")) or {})
    return {
        "ok": True,
        "content": doc.get("content"),
        "document_id": doc.get("document_id"),
        "revision_id": doc.get("revision_id"),
    }


def unwrap_wiki_token(inspect_json):
    """Extract the unwrapped docx token from a `drive +inspect` wiki response.

    For a wiki URL, drive +inspect returns the underlying docx token under
    data.wiki_node.obj_token (and logs "Wiki unwrapped to docx: <token>").
    Returns the token string, or None if the response isn't a wiki unwrap.
    """
    if isinstance(inspect_json, str):
        inspect_json = _safe_json(inspect_json) or {}
    if not isinstance(inspect_json, dict):
        return None
    data = inspect_json.get("data") or {}
    node = data.get("wiki_node") or {}
    token = node.get("obj_token")
    if token and node.get("obj_type") in ("docx", "doc"):
        return token
    # some versions surface it as the top-level resolved token for wiki urls
    return data.get("token") if data.get("type") == "wiki" else token


def classify_error(resp):
    """Map a failed lark-cli JSON response to an actionable hint.

    resp is the parsed response dict (ok:false). Returns
    {kind, hint} where kind is one of:
      token_missing   -> run `lark-cli auth login`
      scope_denied    -> switch --as user / apply scopes in developer console
      wiki_denied     -> wiki node; use --as user + drive +inspect first
      validation      -> bad flag/arg (e.g. the --raw trap)
      other           -> unknown
    """
    if not isinstance(resp, dict):
        return {"kind": "other", "hint": "non-JSON response"}
    if resp.get("ok") is not False:
        return {"kind": "other", "hint": "not an error response"}
    err = resp.get("error") or {}
    etype = err.get("type") or ""
    subtype = err.get("subtype") or ""
    code = err.get("code")
    msg = err.get("message") or err.get("hint") or ""
    scopes = err.get("missing_scopes") or err.get("params") or []

    if etype == "validation" or subtype == "invalid_argument":
        return {"kind": "validation", "hint": msg or "bad flag — --raw is not a lark-cli flag"}
    if subtype == "token_missing" or etype == "authentication" or "need_user_authorization" in msg:
        return {"kind": "token_missing",
                "hint": "run `lark-cli auth login` (user OAuth), then retry"}
    if code in (99991672,) or "scope" in (subtype or "").lower() or "app_scope_not_allowed" in subtype:
        sc = ", ".join(scopes) if isinstance(scopes, list) else ""
        return {"kind": "scope_denied",
                "hint": "switch --as user, or apply scopes at the Feishu developer console"
                        + (f" (missing: {sc})" if sc else "")}
    if code in (131006,) or "wiki" in msg.lower():
        return {"kind": "wiki_denied",
                "hint": "wiki node — use `lark-cli drive +inspect --url <wiki> --as user` to unwrap the docx token, then docs +fetch that token"}
    return {"kind": "other", "hint": msg or f"code={code} type={etype}"}


def derive_filename(title, fallback="feishu_doc"):
    """Turn a doc title into a filesystem-safe base name (keep CJK).

    Mirrors teams-chat-export's safe_filename: replace path separators and
    other unsafe chars with _, collapse repeats, keep letters/CJK/digits/-_.
    """
    if not title:
        return fallback
    name = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", str(title)).strip()
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r"_+", "_", name).strip("_.")
    return name or fallback


def is_wiki_url(s):
    """True if s looks like a Feishu wiki URL (needs drive +inspect unwrap)."""
    if not s:
        return False
    return "/wiki/" in s


def doc_title_from_content(content):
    """Pull the <title>…</title> out of a fetched doc body, if present.

    docs +fetch does NOT return a separate title field — the title is the
    first <title> tag inside data.document.content. Returns None if absent.
    """
    if not content:
        return None
    m = re.search(r"<title>(.*?)</title>", content, re.DOTALL)
    return m.group(1).strip() if m else None


def token_from_doc(doc):
    """The docx token from a URL or bare token (last path segment)."""
    if not doc:
        return None
    seg = doc.rstrip("/").split("/")[-1]
    return seg or None


# ---------------------------------------------------------------------------
# subprocess runners (call lark-cli — only on real invocation)
# ---------------------------------------------------------------------------

def _resolve_exe(name):
    """Resolve a bare command name to a real executable path on PATH.

    On Windows, node/npm shims ship as `.CMD`; subprocess.run([name, ...])
    does NOT do PATHEXT resolution, so passing "npm"/"lark-cli" bare fails with
    FileNotFoundError. Resolve via shutil.which (honours PATHEXT) and, if still
    a bare path without an extension on win32, append .CMD/.cmd.
    """
    p = shutil.which(name)
    if p:
        return p
    if sys.platform.startswith("win"):
        for ext in (".CMD", ".cmd", ".exe", ".bat"):
            p = shutil.which(name + ext)
            if p:
                return p
    return name  # last resort: let subprocess try (and report its own error)


def _run(cmd, capture=True, check=False, stdin_data=None):
    """Run a command; return CompletedProcess. text=True so JSON parses clean.

    Resolves cmd[0] via PATH/PATHEXT first (Windows .CMD shims). Uses
    shell=True only on Windows where the resolved target is a .CMD/.bat
    shim (those need the shell to launch node).
    """
    exe = _resolve_exe(cmd[0])
    use_shell = False
    if sys.platform.startswith("win") and exe.lower().endswith((".cmd", ".bat")):
        use_shell = True
    full = [exe] + cmd[1:] if not use_shell else " ".join(_quote(c) for c in [exe] + cmd[1:])
    return subprocess.run(
        full,
        capture_output=capture,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=check,
        input=stdin_data,
        shell=use_shell,
    )


def _quote(s):
    s = str(s)
    if not s or any(ch in s for ch in " \t\""):
        return '"' + s.replace('"', '\\"') + '"'
    return s


def _lark(args, as_user=None, extra=None):
    """Invoke lark-cli <args> with optional --as user|bot. Returns CompletedProcess."""
    cmd = [LARK_BIN] + list(args)
    if as_user:
        cmd += ["--as", as_user]
    if extra:
        cmd += list(extra)
    return _run(cmd)


def cmd_doctor(args):
    """Detect lark-cli and report install + auth state. Read-only."""
    bin_path = detect_lark_cli()
    report = {"installed": bool(bin_path), "bin_path": bin_path}

    if not bin_path:
        report["next_step"] = (
            "lark-cli not found on PATH. Run: python feishu.py install "
            "(needs npm + Node). Then bind app creds per SKILL.md: "
            "`lark-cli config init --app-id <ID> --app-secret-stdin --brand feishu` "
            "and `lark-cli auth login`."
        )
        _output(report)
        return 0

    # version + npm package (cheap, no auth)
    ver = _run([LARK_BIN, "--version"])
    report["version"] = (ver.stdout or "").strip() or None
    npm = _run(["npm", "ls", "-g", "--depth=0"])
    m = re.search(r"@larksuite/cli@(\S+)", npm.stdout or "")
    report["npm_package"] = "@larksuite/cli@" + m.group(1) if m else None

    # auth state (read-only)
    who = _lark(["whoami"])
    report["whoami"] = parse_whoami(who.stdout)
    st = _lark(["auth", "status"])
    report["auth_status"] = parse_auth_status(st.stdout)

    # actionable readiness verdict
    a = report["auth_status"]
    bot_ok = (a.get("bot") or {}).get("available")
    user_ok = (a.get("user") or {}).get("available")
    user_ts = (a.get("user") or {}).get("token_status")
    if bot_ok and user_ok:
        report["ready"] = True
        report["next_step"] = "ready: bot + user both available. `python feishu.py fetch --doc <URL> --output-dir <dir>` to export."
    elif bot_ok:
        report["ready"] = "partial"
        report["next_step"] = (
            "bot ready but user not usable (token %s). For wiki/drive/private docs run "
            "`lark-cli auth login` (interactive OAuth, opens browser)." % user_ts
        )
    else:
        report["ready"] = False
        report["next_step"] = (
            "app/creds not bound or tokens invalid. Bind: "
            "`lark-cli config init --app-id <ID> --app-secret-stdin --brand feishu`; "
            "then `lark-cli auth login`."
        )

    # optional smoke fetch (network — only when --smoke-doc given)
    if args.smoke_doc:
        ident = "user" if (user_ok and not bot_ok) else "bot"
        r = _lark(["docs", "+fetch", "--doc", args.smoke_doc,
                   "--doc-format", "markdown", "--format", "json"], as_user=ident)
        ex = extract_content(r.stdout or "")
        report["smoke"] = {"as": ident, "ok": ex.get("ok"),
                           "content_len": len(ex.get("content") or "")}
        if not ex.get("ok"):
            report["smoke"]["error"] = classify_error(
                _safe_json(r.stdout or "") or {"ok": False})

    _output(report)
    return 0


def cmd_install(args):
    """Install lark-cli globally via npm. Does NOT bind app creds or auth (see SKILL.md)."""
    if detect_lark_cli() and not args.force:
        _output({"already_installed": True, "bin_path": detect_lark_cli(),
                  "note": "use --force to reinstall; bind app creds per SKILL.md"})
        return 0
    r = _run(["npm", "install", "-g", LARK_NPM_PKG])
    ok = r.returncode == 0
    prefix = _run(["npm", "config", "get", "prefix"])
    report = {"ok": ok, "stdout_tail": (r.stdout or "")[-400:],
              "stderr_tail": (r.stderr or "")[-400:],
              "npm_prefix": (prefix.stdout or "").strip()}
    # detect after install
    p = detect_lark_cli()
    report["bin_path"] = p
    report["next_step"] = (
        "installed. Next (manual, see SKILL.md):\n"
        "  1) `lark-cli config init --app-id <APP_ID> --app-secret-stdin --brand feishu`\n"
        "  2) `lark-cli auth login`  (interactive OAuth — opens browser)\n"
        "  3) `python feishu.py doctor` to confirm ready"
    ) if p else "install reported success but lark-cli not on PATH — check npm prefix is on PATH: " + report["npm_prefix"]
    _output(report)
    return 0 if ok else 1


def _resolve_doc_token(doc, as_user):
    """If doc is a wiki URL, unwrap to the docx token via drive +inspect.

    bot almost always lacks wiki-node read (code 131006); force --as user here.
    Returns (token, note).
    """
    if not is_wiki_url(doc):
        return doc, None
    ident = "user" if as_user != "bot" else "user"  # wiki needs user
    r = _lark(["drive", "+inspect", "--url", doc], as_user=ident)
    tok = unwrap_wiki_token(r.stdout or "")
    if tok:
        return tok, "wiki unwrapped to docx token via drive +inspect --as user"
    err = classify_error(_safe_json(r.stdout or "") or {"ok": False})
    return None, "wiki unwrap failed: %s — %s" % (err.get("kind"), err.get("hint"))


def cmd_fetch(args):
    """Export one Feishu doc to <name>.raw.json + <name>.md.

    Pattern (proven, sidesteps the --raw trap):
      lark-cli docs +fetch --doc <X> --doc-format markdown --as <bot|user> --format json
        > <name>.raw.json
      python json.load -> data.document.content -> <name>.md
    """
    if not detect_lark_cli():
        _output({"ok": False, "error": "lark-cli not on PATH; run `python feishu.py install` first"})
        return 1
    out_dir = os.path.abspath(args.output_dir)
    os.makedirs(out_dir, exist_ok=True)

    token, note = _resolve_doc_token(args.doc, args.as_identity)
    if not token:
        _output({"ok": False, "wiki_url": args.doc, "note": note})
        return 1

    cmd = ["docs", "+fetch", "--doc", token,
           "--doc-format", args.doc_format, "--format", "json"]
    for flag, val in (("--scope", args.scope), ("--start-block-id", args.start_block_id),
                      ("--end-block-id", args.end_block_id), ("--detail", args.detail),
                      ("--max-depth", args.max_depth), ("--keyword", args.keyword)):
        if val is not None:
            cmd += [flag, str(val)]
    r = _lark(cmd, as_user=args.as_identity)

    raw = _safe_json(r.stdout or "") or {}
    doc_obj = (raw.get("data") or {}).get("document") or {}
    content = doc_obj.get("content") or ""
    base = args.name or derive_filename(
        doc_obj.get("title") or doc_title_from_content(content)
        or token_from_doc(token) or "feishu_doc")
    raw_path = os.path.join(out_dir, base + ".raw.json")
    md_path = os.path.join(out_dir, base + ".md")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(raw, f, ensure_ascii=False, indent=2)

    ex = extract_content(raw)
    if not ex.get("ok"):
        err = ex.get("error") or classify_error(raw)
        _output({"ok": False, "raw_path": raw_path, "error": err,
                 "wiki_note": note, "tried_as": args.as_identity})
        return 1
    content = ex.get("content") or ""
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(content)
    _output({"ok": True, "raw_path": raw_path, "md_path": md_path,
             "document_id": ex.get("document_id"), "revision_id": ex.get("revision_id"),
             "content_len": len(content), "wiki_note": note, "as": args.as_identity})
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser():
    ap = argparse.ArgumentParser(
        prog="feishu.py",
        description="Access Feishu via lark-cli (detect / install / fetch).",
        formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="command", required=True)

    d = sub.add_parser("doctor", help="detect lark-cli + report auth state (read-only)")
    d.add_argument("--smoke-doc", help="optional: fetch this doc URL/token to confirm read access (network)")
    d.set_defaults(func=cmd_doctor)

    i = sub.add_parser("install", help="npm install -g @larksuite/cli (no creds/auth)")
    i.add_argument("--force", action="store_true", help="reinstall even if already present")
    i.set_defaults(func=cmd_install)

    f = sub.add_parser("fetch", help="export one Feishu doc to .raw.json + .md")
    f.add_argument("--doc", required=True, help="doc URL or token (wiki URLs auto-unwrapped)")
    f.add_argument("--output-dir", required=True, help="where to write the .raw.json + .md")
    f.add_argument("--name", help="base filename (default: derived from doc title)")
    f.add_argument("--as", dest="as_identity", default="bot",
                   choices=("bot", "user"), help="identity (default bot; use user for wiki/private)")
    f.add_argument("--doc-format", default="markdown", choices=("markdown", "xml"))
    f.add_argument("--scope", help="read scope: full|outline|section|range|keyword")
    f.add_argument("--start-block-id")
    f.add_argument("--end-block-id")
    f.add_argument("--detail", choices=("simple", "with-ids", "full"))
    f.add_argument("--max-depth")
    f.add_argument("--keyword")
    f.set_defaults(func=cmd_fetch)
    return ap


def main(argv=None):
    _force_utf8_stdio()
    args = build_parser().parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
