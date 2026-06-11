---
name: zentao
description: Use when the user wants bug, task, story, or other content from a ZenTao 12.5.3 open-source instance (e.g. "查一下禅道的bug", "get ZenTao bug 12345", or gives a reverse-proxy ZenTao URL + cookie). Requires a host and session cookie supplied by the user.
allowed-tools: Bash(python:*)
---

# ZenTao 12.5.3 API access

Read content from a ZenTao 12.5.3 open-source instance via its JSON API. The helper
`zentao.py` handles the fragile mechanics (double-JSON-decode, unicode unescape,
cookie-expiry detection, UTF-8 output) and caches credentials so you pass them only once.

## Credential rule (REQUIRED)

ZenTao needs a host (reverse-proxy address) and a live session cookie. If neither a cached
config nor env vars are available — or any command exits with `AUTH_EXPIRED` (exit code 2) —
**STOP and ask the user** for the host and cookie. Never invent, guess, or reuse a stale
cookie. Save what they give you with `--save` so later commands in the session reuse it.

To get the cookie, the user copies it from a logged-in browser session (DevTools → Network →
any request → `Cookie` request header, or run `document.cookie` in the console). It includes
`zentaosid=…` plus `za`/`zp` fields.

## First-time setup (run once, after the user provides creds)

```bash
python ~/.claude/skills/zentao/zentao.py \
  --url "http://HOST:PORT" \
  --cookie "zentaosid=...; lang=zh-cn; za=...; zp=..." \
  --save products
```

After `--save`, later commands need no creds (use the full path to `zentao.py` when not
running from the skill dir):

## Commands

| Command | What it returns |
|---|---|
| `python zentao.py my-bugs` | bugs assigned to / opened by the logged-in user |
| `python zentao.py bug <id>` | one bug, trimmed to useful fields (`--raw` for full payload) |
| `python zentao.py product-bugs <productID>` | bug list for a product |
| `python zentao.py products` | product id → name map |
| `python zentao.py get "m=X&f=Y&..."` | generic passthrough for any endpoint |

`bug <id>` returns: id, title, status, severity, pri, type, confirmed, product (+ resolved
productName), project, module, branch, plan, story, task, keywords, os, browser, steps,
openedBy/Date, assignedTo/Date, resolvedBy/resolution/resolvedBuild/resolvedDate,
duplicateBug, closedBy/Date, lastEditedBy/Date, mailto, and `actions` (history). Use `--raw`
for everything ZenTao returns.

## Generic passthrough (tasks, stories, anything else)

ZenTao routing is GET-mode: every endpoint is `index.php?m=<module>&f=<method>&<params>`.
The helper appends `&t=json` automatically. Examples:

```bash
python zentao.py get "m=task&f=view&taskID=123"
python zentao.py get "m=story&f=view&storyID=456"
python zentao.py get "m=bug&f=browse&productID=118"
python zentao.py get "m=project&f=task&projectID=852"
```

## Exit codes

- `0` success
- `1` ERROR — no creds, bad host, HTTP error, or non-success envelope
- `2` AUTH_EXPIRED — cookie missing/expired; **ask the user for a fresh one**

## Notes

- The response envelope is double-wrapped (`{"status":"success","data":"<json-string>"}`);
  the helper decodes both layers and restores `\uXXXX` Chinese text.
- Under `&t=json`, an expired cookie returns a success envelope whose decoded data is
  `{"locate": "...m=user&f=login..."}` (not an HTML redirect). The helper detects both and
  raises AUTH_EXPIRED.
- `.config.json` (cached creds) is git-ignored — it holds a live session token.
- Credentials can also be supplied via `ZENTAO_URL` / `ZENTAO_COOKIE` env vars.
- ZenTao version assumed: **12.5.3 open-source**. Endpoint module/method names follow that
  version's scheme.
- Inline image URLs embedded in bug steps use **relative paths** (e.g. `/index.php?m=file&f=read&t=png&fileID=123`)
  without any host prefix, so they work correctly regardless of which host/network the viewer uses.
