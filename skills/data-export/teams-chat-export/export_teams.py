#!/usr/bin/env python3
"""Export Teams chat history via the zaungast MCP server, with full pagination.

zaungast reads the new Microsoft Teams desktop client's local cache
(~/Library/Containers/com.microsoft.teams2/Data) directly — no API key,
no Graph, pure local read-only access. It pages through FULL history,
unlike local-mcp's teams_read_chat_messages which caps at the latest
50 messages with no pagination (verified 2026-07-21).

Prereqs:
  - New Teams desktop client (com.microsoft.teams2) logged in.
  - Cache warm-up: open each target chat in Teams and scroll up to the
    oldest date you need (Cmd+Home jumps to the first message). Chats
    never opened have empty local cache and cannot be exported.
  - Node.js >= 22.5 (brew install node@22, or a manual binary in ~/node22).

Usage:
  python3 export_teams.py --list-only                    # what's in the cache?
  python3 export_teams.py --output-dir ./chats           # export everything
  python3 export_teams.py --output-dir ./chats --only "AI Chatbot"

Outputs: one markdown per conversation plus index.md in the output dir.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime

# npm cache dirs owned by root break npx; redirect to a writable one.
ENV = os.environ.copy()
ENV['npm_config_cache'] = '/tmp/npm-zaungast'
# Prefer node@22 locations; fall back to whatever npx is on PATH.
ENV['PATH'] = '/usr/local/opt/node@22/bin:' + os.path.expanduser('~/node22/bin') \
    + ':/usr/bin:/bin:/usr/local/bin:/usr/sbin:/sbin:' + ENV.get('PATH', '')

MAX_PAGES_DEFAULT = 200
PAGE_LIMIT_DEFAULT = 100


# ---------------------------------------------------------------------------
# Pure parsing helpers (unit-tested; no server needed)
# ---------------------------------------------------------------------------

def parse_conversation_list(text):
    """Parse `list_conversations` output into structured dicts.

    Lines look like:
      c:b6dded [group] "AI Chatbot 业务快速沟通群" · 3079 msg
      c:abc123 "Li George" · 5 msg
    """
    conversations = []
    if not text:
        return conversations
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        match = re.match(r'(c:\w+)\s+(.*)', line)
        if not match:
            continue
        conv_id, rest = match.group(1), match.group(2)

        count_match = re.search(r'(\d+)\s*msg', rest)
        msg_count = int(count_match.group(1)) if count_match else 0

        name_match = re.search(r'"([^"]+)"', rest)
        if name_match:
            name = name_match.group(1)
        else:
            name = re.sub(r'\[.*?\]\s*', '', rest)
            name = re.sub(r'\s*·.*$', '', name).strip()

        if msg_count > 0 and name:
            conversations.append({
                "id": conv_id,
                "name": name,
                "msg_count": msg_count,
                "is_group": '[group]' in rest,
            })
    return conversations


def _extract_older_cursor(text):
    """Pull the pagination cursor from a response header.

    Seen in the wild as `older: older:1784615658995:1784615658995`; accept
    the bare form `older:1784615658995:1784615658995` too.
    """
    m = re.search(r'older:\s*(older:\S+)', text)
    if m:
        return m.group(1)
    m = re.search(r'\b(older:\d+:\d+)\b', text)
    return m.group(1) if m else None


def parse_messages(text):
    """Parse zaungast `read_conversation` output.

    Returns (messages, oldest_cursor_or_None). Message format:
      MM-DD HH:MM Sender Name> Message body      (year may be absent!)
      MM-DD HH:MM   ↳> Reply body                (reply, folded into prev msg)
    """
    if not text:
        return [], None

    messages = []
    current_msg = None
    oldest_cursor = _extract_older_cursor(text)

    for line in text.split("\n"):
        # Timestamp accepts both YYYY-MM-DD HH:MM and MM-DD HH:MM.
        m = re.match(r'^((?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2})\s+(.+?)>(.*)', line)
        if m:
            timestamp, sender, body = m.group(1), m.group(2).strip(), m.group(3).strip()

            if '↳' in sender:  # reply line: fold into previous message
                if current_msg:
                    if current_msg["body"]:
                        current_msg["body"] += "\n"
                    current_msg["body"] += f"  ↳ {body}"
                continue

            if current_msg:
                messages.append(current_msg)
            current_msg = {"timestamp": timestamp, "sender": sender, "body": body}
        elif current_msg and line.strip():
            stripped = line.strip()
            if stripped.startswith("viewer:") or stripped.startswith("as_of"):
                continue
            if current_msg["body"]:
                current_msg["body"] += "\n"
            current_msg["body"] += line

    if current_msg:
        messages.append(current_msg)
    return messages, oldest_cursor


def dedup_key(msg):
    """Pagination overlaps produce duplicates; this is the identity key."""
    return f"{msg['timestamp']}:{msg['sender']}"


def safe_filename(name, fallback_id=""):
    """Filesystem-safe name; keeps CJK, replaces the rest with underscores."""
    safe = re.sub(r'[^\w一-鿿-]', '_', name)
    safe = re.sub(r'_+', '_', safe).strip('_')
    if not safe:
        safe = fallback_id.replace(':', '_')
    return safe


def message_markdown(msg):
    """One message as markdown. Empty body = media that didn't come through."""
    body = msg.get("body", "").strip() or "[图片/视频/多媒体内容]"
    return f"### [{msg.get('timestamp', 'unknown')}] {msg.get('sender', 'Unknown')}\n\n{body}\n"


def write_index(exported, output_dir):
    """index.md: | 文件名 | 类型 | 条数 | 最早消息 | 最晚消息 |"""
    path = os.path.join(output_dir, "index.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("# Teams 导出索引\n\n")
        f.write(f"- 导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"- 会话数: {len(exported)}\n")
        f.write(f"- 总消息数: {sum(e['messages'] for e in exported)}\n\n")
        f.write("| 文件 | 类型 | 条数 | 最早消息 | 最晚消息 |\n")
        f.write("|------|------|------|----------|----------|\n")
        for e in exported:
            kind = "群聊" if e["is_group"] else "私聊/会议"
            f.write(f"| {os.path.basename(e['file'])} | {kind} | {e['messages']} "
                    f"| {e['first_ts']} | {e['last_ts']} |\n")
        f.write("\n> 若某会话最早消息晚于预期：到 Teams 客户端打开该会话向上滚动"
                "补全本地缓存，然后重跑导出。\n")
    return path


# ---------------------------------------------------------------------------
# MCP client
# ---------------------------------------------------------------------------

class ZaungastClient:
    """Minimal stdio JSON-RPC client for the zaungast MCP server."""

    def __init__(self):
        self.proc = None
        self.msg_id = 0

    def start(self):
        print("Starting zaungast MCP server...")
        self.proc = subprocess.Popen(
            ['npx', '-y', 'zaungast'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, universal_newlines=True, env=ENV,
        )
        time.sleep(2)
        print(f"Server PID: {self.proc.pid}")

        init_resp = self._send("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "teams-chat-export", "version": "1.0"},
        })
        if init_resp:
            info = init_resp.get("result", {}).get("serverInfo", {})
            print(f"Server: {info.get('name', '?')} v{info.get('version', '?')}")
        else:
            print("WARNING: No init response received")
        self._send("notifications/initialized", is_notification=True)
        print("MCP protocol initialized.")

    def stop(self):
        if not self.proc:
            return
        try:
            self.proc.stdin.close()
        except Exception:
            pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait(timeout=3)
        print("Server stopped.")

    def _send(self, method, params=None, is_notification=False, timeout=120):
        self.msg_id += 1
        msg = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            msg["params"] = params
        if not is_notification:
            msg["id"] = self.msg_id
        try:
            self.proc.stdin.write(json.dumps(msg) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, IOError) as e:
            print(f"ERROR writing to server: {e}")
            return None
        if is_notification:
            return None

        start_time = time.time()
        while True:
            if time.time() - start_time > timeout:
                print(f"TIMEOUT waiting for response to {method} (id={self.msg_id})")
                return None
            line = self.proc.stdout.readline()
            if not line:
                if self.proc.poll() is not None:
                    print(f"Server exited with code {self.proc.returncode}")
                    return None
                time.sleep(0.1)
                continue
            line = line.strip()
            if not line:
                continue
            try:
                resp = json.loads(line)
                if resp.get("id") == self.msg_id:
                    return resp
            except json.JSONDecodeError:
                continue  # server noise leaking onto stdout

    def call_tool(self, tool_name, arguments, timeout=180):
        resp = self._send("tools/call", {"name": tool_name, "arguments": arguments},
                          timeout=timeout)
        if resp is None:
            return None, "No response"
        if "error" in resp:
            err = resp["error"]
            return None, f"Error {err.get('code')}: {err.get('message')}"
        blocks = resp.get("result", {}).get("content", [])
        if blocks:
            return blocks[0].get("text", ""), None
        return None, "No content in response"

    def list_conversations(self):
        text, err = self.call_tool("list_conversations", {}, timeout=60)
        if err:
            print(f"ERROR listing conversations: {err}")
            return []
        return parse_conversation_list(text)

    def read_conversation(self, conv_id, cursor=None, limit=PAGE_LIMIT_DEFAULT):
        args = {"conversation": conv_id, "limit": limit}
        if cursor:
            args["cursor"] = cursor
        text, err = self.call_tool("read_conversation", args, timeout=120)
        if err:
            return [], None, err
        messages, oldest_cursor = parse_messages(text)
        return messages, oldest_cursor, None

    def export_full_conversation(self, conv_id, conv_name,
                                 max_pages=MAX_PAGES_DEFAULT):
        all_messages, page_cursor, page_num, seen = [], None, 0, set()
        print(f"\n{'=' * 70}\nExporting: {conv_name} ({conv_id})\n{'=' * 70}")

        while page_num < max_pages:
            page_num += 1
            print(f"  Page {page_num}...", end="", flush=True)
            messages, next_cursor, err = self.read_conversation(
                conv_id, cursor=page_cursor)
            if err:
                print(f" ERROR: {err}")
                break
            if not messages:
                print(" (no more messages)")
                break

            page_keys = {dedup_key(m) for m in messages}
            new_keys = page_keys - seen
            if not new_keys:
                print(f" (all {len(messages)} msgs are duplicates - end of history)")
                break
            seen.update(page_keys)
            all_messages = messages + all_messages  # prepend older page
            print(f" {len(messages)} msgs ({len(new_keys)} new, "
                  f"{len(all_messages)} total)")

            if next_cursor:
                page_cursor = next_cursor
            else:
                print("  (no cursor for next page, stopping)")
                break
            time.sleep(0.3)  # be nice to the server
        return all_messages


def save_conversation_md(messages, conv_name, conv_id, output_dir):
    if not messages:
        return None, 0
    fname = safe_filename(conv_name, fallback_id=conv_id) + ".md"
    path = os.path.join(output_dir, fname)
    first_ts, last_ts = messages[0]["timestamp"], messages[-1]["timestamp"]

    with open(path, "w", encoding="utf-8") as f:
        f.write(f"# {conv_name}\n\n")
        f.write(f"- **Conversation ID:** `{conv_id}`\n")
        f.write(f"- **Exported:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"- **Total messages:** {len(messages)}\n")
        f.write(f"- **Date range:** {first_ts} to {last_ts}\n\n---\n\n")
        for msg in messages:
            f.write(message_markdown(msg) + "\n")
    return path, len(messages)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--output-dir", default="./teams_export/chats",
                    help="where to write markdown files (default %(default)s)")
    ap.add_argument("--only", default=None,
                    help="regex filter on conversation names")
    ap.add_argument("--list-only", action="store_true",
                    help="list cached conversations and exit (use this to check "
                         "cache coverage before/after scrolling in Teams)")
    ap.add_argument("--max-pages", type=int, default=MAX_PAGES_DEFAULT)
    args = ap.parse_args()

    client = ZaungastClient()
    try:
        client.start()
        conversations = client.list_conversations()
        if args.only:
            conversations = [c for c in conversations
                             if re.search(args.only, c["name"])]

        print(f"\nFound {len(conversations)} conversations with messages:")
        for i, c in enumerate(conversations, 1):
            tag = " [group]" if c["is_group"] else ""
            print(f"  {i}. {c['name']}{tag} — {c['msg_count']} msgs ({c['id']})")
        if args.list_only or not conversations:
            return

        os.makedirs(args.output_dir, exist_ok=True)
        exported = []
        for i, conv in enumerate(conversations, 1):
            print(f"\n[{i}/{len(conversations)}] ", end="")
            messages = client.export_full_conversation(
                conv["id"], conv["name"], max_pages=args.max_pages)
            if not messages:
                print(f"\n  => No messages to save for {conv['name']}")
                continue
            path, count = save_conversation_md(
                messages, conv["name"], conv["id"], args.output_dir)
            if path:
                exported.append({
                    "name": conv["name"], "file": path, "messages": count,
                    "is_group": conv["is_group"],
                    "first_ts": messages[0]["timestamp"],
                    "last_ts": messages[-1]["timestamp"],
                })
                print(f"\n  => Saved: {path} ({count} messages)")

        index_path = write_index(exported, args.output_dir)
        print("\n" + "=" * 70 + "\nEXPORT SUMMARY\n" + "=" * 70)
        print(f"Conversations exported: {len(exported)}")
        print(f"Total messages: {sum(e['messages'] for e in exported)}")
        print(f"Output: {args.output_dir} (index: {index_path})")
    except KeyboardInterrupt:
        print("\n\nInterrupted by user.")
    finally:
        client.stop()


if __name__ == "__main__":
    sys.exit(main())
