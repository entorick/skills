---
name: zentao
description: Use when the user wants bug, task, story, or other content from a ZenTao 12.5.3 open-source instance (e.g. "查一下禅道的bug", "get ZenTao bug 12345", or gives a ZenTao URL). Logs in automatically with the user's account/password — no manual cookie copying needed.
allowed-tools: Bash(python:*)
---

# ZenTao 12.5.3 API access

Read and write content on a ZenTao 12.5.3 open-source instance via its JSON API. The helper
`zentao.py` handles the fragile mechanics (login, double-JSON-decode, unicode unescape,
cookie-expiry detection + automatic re-login, UTF-8 output) and caches credentials so you
pass them only once.

## Credential rule (REQUIRED)

ZenTao needs a host (base URL) plus the user's **account and password**. The helper logs in
through the web form itself and caches the resulting session cookie — the user never copies
cookies by hand.

- If the cached config has account/password, everything is automatic: the helper logs in on
  first use and re-logs-in transparently whenever the session expires.
- If no cached config exists, **STOP and ask the user** for the ZenTao host, account, and
  password, then run the `login` command below. Never invent or guess credentials.
- If any command exits with `AUTH_EXPIRED` (exit code 2) even after the automatic re-login
  attempt (i.e. the account has no password cached — legacy cookie-only config), ask the
  user for their account/password and run `login`.

## First-time setup (run once, after the user provides creds)

```bash
python ~/.codebuddy/skills/zentao/zentao.py \
  --url "http://HOST:PORT" \
  --account "USERNAME" --password "PASSWORD" \
  login
```

This logs in, verifies the session, and caches host + account + password + cookie in
`.config.json` (git-ignored). After that, later commands need no creds (use the full path
to `zentao.py` when not running from the skill dir):

## Commands

| Command | What it returns |
|---|---|
| `python zentao.py login` | log in with cached/`--account` creds; refreshes the cached cookie |
| `python zentao.py my-bugs` | bugs assigned to / opened by the logged-in user |
| `python zentao.py bug <id>` | one bug, trimmed to useful fields (`--raw` for full payload) |
| `python zentao.py product-bugs <productID>` | bug list for a product |
| `python zentao.py products` | product id → name map |
| `python zentao.py get "m=X&f=Y&..."` | generic passthrough for any endpoint |
| `python zentao.py create-bug --product <id> --project <id> --title "..." [--steps ...] [--images f.png ...]` | create a bug, optionally with inline images |
| `python zentao.py edit-bug --id <id> --product <id> --project <id> --title "..." [--steps ...] [--images f.png ...]` | edit an existing bug (product/project always preserved) |
| `python zentao.py resolve-bug --id <id> --resolution <code> [--comment ...]` | resolve a bug (active → resolved); returns confirmed status/resolution/resolvedBy |
| `python zentao.py close-bug --id <id> [--comment ...]` | close a resolved bug (resolved → closed); returns confirmed status/closedBy |

`bug <id>` returns: id, title, status, severity, pri, type, confirmed, product (+ resolved
productName), project, module, branch, plan, story, task, keywords, os, browser, steps,
openedBy/Date, assignedTo/Date, resolvedBy/resolution/resolvedBuild/resolvedDate,
duplicateBug, closedBy/Date, lastEditedBy/Date, mailto, and `actions` (history). Use `--raw`
for everything ZenTao returns.

## Creating / editing bugs

Both commands require `--product`, `--project`, and `--title`. Optional flags:
`--steps` (repro steps HTML/text), `--severity` (default 3), `--pri` (default 3),
`--type` (default `codeerror`), `--build` (default `trunk`), and `--images` — local
image files uploaded and embedded inline in the steps at original quality.

```bash
python zentao.py create-bug --product 118 --project 852 \
  --title "登录页验证码不刷新" --steps "1. 打开登录页 2. ..." \
  --severity 2 --images screenshot1.png screenshot2.png
```

`edit-bug` takes the same flags plus `--id`; it re-fetches the bug first and always
preserves its current product/project association.

## Resolving / closing bugs

`resolve-bug` POSTs to `m=bug&f=resolve&bugID=<id>` and re-fetches the bug to confirm.
`--resolution` is required and must be one of:

| code | meaning |
|---|---|
| `resolved` | 已解决 (also pass `--build`, default `trunk`) |
| `duplicate` | 重复Bug (also pass `--duplicate-bug <bugID>`) |
| `notrepro` | 无法重现 |
| `postpone` | 延期处理 |
| `willnotfix` | 不予解决 |
| `bydesign` | 设计如此 |
| `tostory` | 转为需求 |

`--comment` becomes the resolution note in the bug's history. Example:

```bash
python zentao.py resolve-bug --id 67109 --resolution notrepro \
  --comment "不复现: 2026-07-20 复现脚本已验证当前代码正确处理"
```

`close-bug` POSTs to `m=bug&f=close&bugID=<id>` (only `--comment` is accepted). A bug must
already be resolved before it can be closed. Both commands need a live cookie (same
auth/`AUTH_EXPIRED` rules as the read commands).

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
- `1` ERROR — no creds, bad host, HTTP error, login failure, or non-success envelope
- `2` AUTH_EXPIRED — session expired **and** automatic re-login was impossible (no
  account/password cached); ask the user for account/password and run `login`

## Notes

- Login flow: the helper GETs `m=user&f=login` to obtain a fresh session plus the hidden
  `verifyRand` field, then POSTs the form with `keepLogin` so the server also issues the
  long-lived `za`/`zp` cookies. The resulting cookie string is cached in `.config.json`.
- When a request hits an expired session, the helper automatically re-logs-in with the
  cached account/password and retries the command once — invisible to the caller.
- The response envelope is double-wrapped (`{"status":"success","data":"<json-string>"}`);
  the helper decodes both layers and restores `\uXXXX` Chinese text.
- Under `&t=json`, an expired cookie returns a success envelope whose decoded data is
  `{"locate": "...m=user&f=login..."}` (not an HTML redirect). The helper detects both and
  raises AUTH_EXPIRED.
- `.config.json` (cached creds) is git-ignored — it holds the account password and a live
  session token.
- Credentials can also be supplied via env vars: `ZENTAO_URL`, `ZENTAO_ACCOUNT`,
  `ZENTAO_PASSWORD` (legacy: `ZENTAO_COOKIE`).
- ZenTao version assumed: **12.5.3 open-source**. Endpoint module/method names follow that
  version's scheme.
- Inline image URLs embedded in bug steps use **relative paths** (e.g. `/index.php?m=file&f=read&t=png&fileID=123`)
  without any host prefix, so they work correctly regardless of which host/network the viewer uses.
