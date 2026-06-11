#!/usr/bin/env python3
"""ZenTao 12.5.3 open-source API helper.

Read/write bugs on a ZenTao instance via its JSON API.
Supports creating bugs with images inline in the steps field.

Image upload limit on this server: ~10 KB per image (PHP upload_max_filesize).
Images are auto-compressed with Pillow; requires: pip install requests openpyxl pillow
"""
import argparse
import io
import json
import os
import re
import sys

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".config.json")


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
# Config / credentials
# ---------------------------------------------------------------------------

def load_config():
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}
    return {}


def save_config(url, cookie):
    cfg = {"url": url, "cookie": cookie}
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f)


def resolve_creds(args):
    cfg = load_config()
    url = (getattr(args, "url", None) or os.environ.get("ZENTAO_URL") or cfg.get("url"))
    cookie = (getattr(args, "cookie", None) or os.environ.get("ZENTAO_COOKIE") or cfg.get("cookie"))
    if not url or not cookie:
        raise RuntimeError(
            "No ZenTao host/cookie. Pass --url/--cookie with --save, "
            "or set ZENTAO_URL/ZENTAO_COOKIE env vars."
        )
    return url.rstrip("/"), cookie


# ---------------------------------------------------------------------------
# HTTP session (requests)
# ---------------------------------------------------------------------------

def make_session(cookie_str):
    try:
        import requests
    except ImportError:
        raise RuntimeError("pip install requests")
    session = requests.Session()
    for item in cookie_str.split(";"):
        item = item.strip()
        if "=" in item:
            k, v = item.split("=", 1)
            session.cookies.set(k.strip(), v.strip())
    session.headers.update({"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest"})
    return session


# ---------------------------------------------------------------------------
# Core API helpers
# ---------------------------------------------------------------------------

def _decode_envelope(raw):
    """Decode ZenTao's double-wrapped JSON envelope."""
    try:
        outer = json.loads(raw)
    except json.JSONDecodeError:
        raise RuntimeError("Non-JSON response: " + raw[:200])
    if isinstance(outer, dict) and outer.get("status") not in (None, "success"):
        raise RuntimeError("ZenTao error: " + raw[:300])
    data = outer.get("data") if isinstance(outer, dict) else outer
    if isinstance(data, str):
        try:
            data = json.loads(data)
        except json.JSONDecodeError:
            pass
    # Auth redirect detection
    if isinstance(data, dict):
        loc = data.get("locate", "")
        if "f=login" in loc or "f=deny" in loc:
            raise RuntimeError("AUTH_EXPIRED: cookie is missing or expired")
    return data


def fetch(session, base, query, timeout=30):
    sep = "&" if "?" in query else "?"
    url = base + "/index.php?" + query + sep + "t=json"
    r = session.get(url, timeout=timeout)
    r.raise_for_status()
    return _decode_envelope(r.text)


# ---------------------------------------------------------------------------
# Image helpers
# ---------------------------------------------------------------------------

def compress_image(src, max_bytes=9800):
    """Compress image file to fit within max_bytes, return (jpeg_bytes, filename)."""
    try:
        from PIL import Image as _Img
    except ImportError:
        raise RuntimeError("pip install pillow")

    img = _Img.open(src).convert("RGB")
    name = os.path.splitext(os.path.basename(src))[0] + ".jpg"

    for quality in (85, 70, 60, 50, 40, 30, 20, 15, 10, 8, 5, 2):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        if buf.tell() <= max_bytes:
            return buf.getvalue(), name

    # Still too large: shrink dimensions
    scale = 0.7
    while scale >= 0.1:
        w = max(1, int(img.width * scale))
        h = max(1, int(img.height * scale))
        small = img.resize((w, h))
        buf = io.BytesIO()
        small.save(buf, format="JPEG", quality=5, optimize=True)
        if buf.tell() <= max_bytes:
            return buf.getvalue(), name
        scale -= 0.1

    buf = io.BytesIO()
    img.resize((1, 1)).save(buf, format="JPEG", quality=1)
    return buf.getvalue(), name


def compress_image_bytes(img_bytes, max_bytes=9800):
    """Same as compress_image but takes raw bytes instead of a file path."""
    try:
        from PIL import Image as _Img
    except ImportError:
        raise RuntimeError("pip install pillow")

    img = _Img.open(io.BytesIO(img_bytes)).convert("RGB")

    for quality in (85, 70, 60, 50, 40, 30, 20, 15, 10, 8, 5, 2):
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality, optimize=True)
        if buf.tell() <= max_bytes:
            return buf.getvalue()

    scale = 0.7
    while scale >= 0.1:
        w = max(1, int(img.width * scale))
        h = max(1, int(img.height * scale))
        small = img.resize((w, h))
        buf = io.BytesIO()
        small.save(buf, format="JPEG", quality=5, optimize=True)
        if buf.tell() <= max_bytes:
            return buf.getvalue()
        scale -= 0.1

    buf = io.BytesIO()
    img.resize((1, 1)).save(buf, format="JPEG", quality=1)
    return buf.getvalue()


# ---------------------------------------------------------------------------
# kuid + inline image upload
# ---------------------------------------------------------------------------

def get_kuid(session, base, product_id, project_id):
    """GET the bug-create page and extract the KindEditor uid."""
    url = f"{base}/index.php?m=bug&f=create&productID={product_id}&projectID={project_id}"
    r = session.get(url, timeout=15)
    m = re.search(r"var kuid\s*=\s*['\"]([a-zA-Z0-9_-]+)['\"]", r.text)
    if not m:
        raise RuntimeError("Cannot extract kuid — check cookie validity")
    return m.group(1)


def upload_inline_image(session, base, img_bytes, kuid, filename="screenshot.png"):
    """Upload image via ajaxUpload; returns the relative path or None on failure.

    Returns the server-provided relative URL (e.g. /index.php?m=file&f=read&...)
    without any host prefix, so the embedded <img src> works regardless of
    which host the viewer uses to access ZenTao.

    Tries the original bytes first. Falls back to JPEG compression if rejected.
    """
    mime = "image/png" if filename.lower().endswith(".png") else "image/jpeg"
    upload_url = f"{base}/index.php?m=file&f=ajaxUpload&uid={kuid}"

    r = session.post(upload_url, files={"imgFile": (filename, io.BytesIO(img_bytes), mime)}, timeout=30)
    if r.status_code == 200:
        data = r.json()
        if data.get("error") == 0:
            return data["url"]

    # Fallback: compress and retry as JPEG
    print(f"  [warn] original upload failed (HTTP {r.status_code}), retrying with compression...")
    compressed = compress_image_bytes(img_bytes)
    fname_jpg = os.path.splitext(filename)[0] + ".jpg"
    r2 = session.post(upload_url, files={"imgFile": (fname_jpg, io.BytesIO(compressed), "image/jpeg")}, timeout=30)
    if r2.status_code == 200:
        data2 = r2.json()
        if data2.get("error") == 0:
            return data2["url"]

    print(f"  [error] upload failed even after compression")
    return None


# ---------------------------------------------------------------------------
# Bug CRUD
# ---------------------------------------------------------------------------

BUG_FIELDS = [
    "id", "title", "status", "severity", "pri", "type", "confirmed",
    "product", "project", "module", "branch", "plan", "story", "task",
    "keywords", "os", "browser", "steps",
    "openedBy", "openedDate", "assignedTo", "assignedDate",
    "resolvedBy", "resolution", "resolvedBuild", "resolvedDate", "duplicateBug",
    "closedBy", "closedDate", "lastEditedBy", "lastEditedDate", "mailto",
]


def trim_bug(view_data):
    bug = view_data.get("bug", view_data) if isinstance(view_data, dict) else {}
    out = {k: bug.get(k) for k in BUG_FIELDS if k in bug}
    products = view_data.get("products") if isinstance(view_data, dict) else None
    if isinstance(products, dict) and str(out.get("product")) in products:
        out["productName"] = products[str(out["product"])]
    for key in ("actions", "comments", "history"):
        if isinstance(view_data, dict) and key in view_data:
            out[key] = view_data[key]
    return out


def create_bug(session, base, product_id, project_id, title, steps,
               severity="3", pri="3", bug_type="codeerror", build="trunk",
               image_paths=None, image_bytes_list=None, kuid=None):
    """Create a bug, optionally embedding images inline in the steps field.

    Args:
        base:        Host used for HTTP requests (may be a direct IP).
        image_paths: File paths — uploaded inline at original quality.
        image_bytes_list: Raw bytes (e.g. from Excel) — same treatment.
        kuid: Pre-fetched KindEditor uid; fetched automatically if None.
    """
    if (image_paths or image_bytes_list) and kuid is None:
        kuid = get_kuid(session, base, product_id, project_id)

    inline_urls = []
    if image_paths:
        for path in image_paths:
            fname = os.path.basename(path)
            with open(path, "rb") as fh:
                raw = fh.read()
            url = upload_inline_image(session, base, raw, kuid, fname)
            if url:
                inline_urls.append(url)

    if image_bytes_list:
        for i, raw_bytes in enumerate(image_bytes_list):
            url = upload_inline_image(session, base, raw_bytes, kuid,
                                      f"screenshot_{i+1}.png")
            if url:
                inline_urls.append(url)

    # Append inline img tags to steps HTML
    full_steps = steps
    if inline_urls:
        img_tags = "".join(f'<p><img src="{u}" onload="setImageSize(this,0)" alt="screenshot"/></p>' for u in inline_urls)
        full_steps = steps + img_tags

    post_data = [
        ("product",       str(product_id)),
        ("module",        "0"),
        ("project",       str(project_id)),
        ("openedBuild[]", build),
        ("title",         title),
        ("severity",      str(severity)),
        ("pri",           str(pri)),
        ("type",          bug_type),
        ("os",            ""),
        ("browser",       ""),
        ("steps",         full_steps),
        ("status",        "active"),
        ("assignedTo",    ""),
        ("deadline",      ""),
        ("mailto[]",      ""),
        ("keywords",      ""),
        ("color",         ""),
    ]

    url = f"{base}/index.php?m=bug&f=create&productID={product_id}&projectID={project_id}&t=json"
    r = session.post(url, data=post_data, timeout=30)
    result = r.json()
    if result.get("result") != "success":
        raise RuntimeError("Bug creation failed: " + json.dumps(result, ensure_ascii=False))

    # Creation response has no bugID; fetch the newest bug
    r2 = session.get(
        f"{base}/index.php?m=project&f=bug&projectID={project_id}&t=json&orderBy=id_desc",
        timeout=15,
    )
    data = _decode_envelope(r2.text)
    bugs = data.get("bugs", [])
    bug_id = bugs[0]["id"] if bugs else None
    return {"result": "success", "bugID": bug_id, "inlineImages": len(inline_urls)}


def edit_bug(session, base, bug_id, product_id, project_id, title, steps,
             severity="3", pri="3", bug_type="codeerror", build="trunk",
             image_paths=None, image_bytes_list=None, kuid=None):
    """Edit an existing bug, replacing steps and optionally uploading new inline images.

    Always passes product and project to avoid clearing them.
    """
    if (image_paths or image_bytes_list) and kuid is None:
        kuid = get_kuid(session, base, product_id, project_id)

    inline_urls = []
    if image_paths:
        for path in image_paths:
            fname = os.path.basename(path)
            with open(path, "rb") as fh:
                raw = fh.read()
            url = upload_inline_image(session, base, raw, kuid, fname)
            if url:
                inline_urls.append(url)

    if image_bytes_list:
        for i, raw_bytes in enumerate(image_bytes_list):
            url = upload_inline_image(session, base, raw_bytes, kuid,
                                      f"screenshot_{i+1}.png")
            if url:
                inline_urls.append(url)

    full_steps = steps
    if inline_urls:
        img_tags = "".join(
            f'<p><img src="{u}" onload="setImageSize(this,0)" alt="screenshot"/></p>'
            for u in inline_urls
        )
        full_steps = steps + img_tags

    post_data = [
        ("product",       str(product_id)),
        ("module",        "0"),
        ("project",       str(project_id)),
        ("openedBuild[]", build),
        ("title",         title),
        ("severity",      str(severity)),
        ("pri",           str(pri)),
        ("type",          bug_type),
        ("os",            ""),
        ("browser",       ""),
        ("steps",         full_steps),
        ("status",        "active"),
        ("assignedTo",    ""),
        ("deadline",      ""),
        ("mailto[]",      ""),
        ("keywords",      ""),
        ("color",         ""),
    ]
    r = session.post(
        f"{base}/index.php?m=bug&f=edit&bugID={bug_id}&t=json",
        data=post_data, timeout=30,
    )
    outer = json.loads(r.text)
    inner = json.loads(outer["data"]) if isinstance(outer.get("data"), str) else outer.get("data", {})
    # success is indicated by a locate redirect, not result==success
    return {"result": "success", "bugID": bug_id, "inlineImages": len(inline_urls)}


# ---------------------------------------------------------------------------
# Excel extraction
# ---------------------------------------------------------------------------

def extract_excel_images(excel_path, sheet_name):
    """Return {row_1indexed: [bytes, ...]} mapping from an openpyxl worksheet.

    Uses ws._images (internal openpyxl attribute) to get original image bytes
    without re-encoding, preserving full quality.
    """
    try:
        import openpyxl
    except ImportError:
        raise RuntimeError("pip install openpyxl")

    wb = openpyxl.load_workbook(excel_path, data_only=True)
    ws = wb[sheet_name]
    image_map = {}
    for img in ws._images:
        anchor = img.anchor
        if not hasattr(anchor, "_from"):
            continue
        row = anchor._from.row + 1  # 1-indexed
        img.ref.seek(0)
        image_map.setdefault(row, []).append(img.ref.read())
    return image_map


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv=None):
    _force_utf8_stdio()
    p = argparse.ArgumentParser(description="ZenTao 12.5.3 API helper")
    p.add_argument("--url",        help="ZenTao base URL, e.g. http://172.16.1.250:8087")
    p.add_argument("--cookie",     help="Session cookie string")
    p.add_argument("--save",       action="store_true", help="Cache --url/--cookie for reuse")
    sub_kwargs = {"dest": "cmd"}
    if sys.version_info >= (3, 7):
        sub_kwargs["required"] = True
    sub = p.add_subparsers(**sub_kwargs)

    # --- read commands ---
    sub.add_parser("my-bugs", help="Bugs for the logged-in user")

    b = sub.add_parser("bug", help="Bug detail")
    b.add_argument("id")
    b.add_argument("--raw", action="store_true")

    pb = sub.add_parser("product-bugs", help="Bug list for a product")
    pb.add_argument("productID")

    sub.add_parser("products", help="Product id→name map")

    g = sub.add_parser("get", help="Generic GET passthrough")
    g.add_argument("query", help='e.g. "m=task&f=view&taskID=1"')

    # --- create-bug ---
    cb = sub.add_parser("create-bug", help="Create a bug with optional inline images")
    cb.add_argument("--product",  required=True)
    cb.add_argument("--project",  required=True)
    cb.add_argument("--title",    required=True)
    cb.add_argument("--steps",    default="")
    cb.add_argument("--severity", default="3")
    cb.add_argument("--pri",      default="3")
    cb.add_argument("--type",     default="codeerror", dest="bug_type")
    cb.add_argument("--build",    default="trunk")
    cb.add_argument("--images",   nargs="*", default=[], metavar="FILE",
                    help="Image paths — uploaded inline in steps at original quality")

    # --- edit-bug ---
    eb = sub.add_parser("edit-bug", help="Edit an existing bug (always preserves product/project)")
    eb.add_argument("--id",       required=True, dest="bug_id")
    eb.add_argument("--product",  required=True)
    eb.add_argument("--project",  required=True)
    eb.add_argument("--title",    required=True)
    eb.add_argument("--steps",    default="")
    eb.add_argument("--severity", default="3")
    eb.add_argument("--pri",      default="3")
    eb.add_argument("--type",     default="codeerror", dest="bug_type")
    eb.add_argument("--build",    default="trunk")
    eb.add_argument("--images",   nargs="*", default=[], metavar="FILE",
                    help="Image paths — uploaded inline in steps at original quality")

    args = p.parse_args(argv)

    try:
        url, cookie = resolve_creds(args)
        if args.save:
            save_config(url, cookie)

        session = make_session(cookie)

        if args.cmd == "my-bugs":
            _output(fetch(session, url, "m=my&f=bug"))

        elif args.cmd == "bug":
            data = fetch(session, url, f"m=bug&f=view&bugID={args.id}")
            _output(data if args.raw else trim_bug(data))

        elif args.cmd == "product-bugs":
            _output(fetch(session, url, f"m=bug&f=browse&productID={args.productID}"))

        elif args.cmd == "products":
            _output(fetch(session, url, "m=product&f=all"))

        elif args.cmd == "get":
            _output(fetch(session, url, args.query))

        elif args.cmd == "create-bug":
            result = create_bug(
                session, url,
                product_id=args.product,
                project_id=args.project,
                title=args.title,
                steps=args.steps,
                severity=args.severity,
                pri=args.pri,
                bug_type=args.bug_type,
                build=args.build,
                image_paths=args.images or [],
            )
            _output(result)

        elif args.cmd == "edit-bug":
            result = edit_bug(
                session, url,
                bug_id=args.bug_id,
                product_id=args.product,
                project_id=args.project,
                title=args.title,
                steps=args.steps,
                severity=args.severity,
                pri=args.pri,
                bug_type=args.bug_type,
                build=args.build,
                image_paths=args.images or [],
            )
            _output(result)

    except RuntimeError as e:
        msg = str(e)
        if msg.startswith("AUTH_EXPIRED"):
            print("AUTH_EXPIRED: " + msg, file=sys.stderr)
            return 2
        print("ERROR: " + msg, file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
