import json

import pytest

import zentao


def _wrap(data):
    """Build ZenTao's double-wrapped envelope: {"status":"success","data":"<json-string>"}."""
    return json.dumps({"status": "success", "data": json.dumps(data)})


def test_json_locate_login_raises_auth_expired():
    # Under &t=json, an expired cookie returns a success envelope whose decoded
    # data is {"locate": "...m=user&f=login..."} rather than the HTML bounce.
    body = _wrap({"locate": "https://host/index.php?m=user&f=login&t=json&referer=Lw=="})
    with pytest.raises(RuntimeError, match="AUTH_EXPIRED"):
        zentao._decode_envelope(body)


def test_json_locate_deny_raises_auth_expired():
    body = _wrap({"locate": "https://host/index.php?m=user&f=deny&module=my"})
    with pytest.raises(RuntimeError, match="AUTH_EXPIRED"):
        zentao._decode_envelope(body)


def test_double_decode_restores_unicode():
    inner = json.dumps({"title": "你好bug", "id": "1"}, ensure_ascii=True)  # \uXXXX escapes
    outer = json.dumps({"status": "success", "data": inner})
    result = zentao._decode_envelope(outer)
    assert result["title"] == "你好bug"
    assert result["id"] == "1"


def test_non_success_status_raises():
    body = json.dumps({"status": "fail", "message": "nope"})
    with pytest.raises(RuntimeError, match="ZenTao error"):
        zentao._decode_envelope(body)


def test_garbage_raises_non_json():
    with pytest.raises(RuntimeError, match="Non-JSON response"):
        zentao._decode_envelope("<html>totally not json</html>")


def test_plain_string_data_passes_through():
    body = json.dumps({"status": "success", "data": "plain text, not json"})
    assert zentao._decode_envelope(body) == "plain text, not json"


class _FakeResponse:
    text = json.dumps({"status": "success", "data": "{}"})

    def raise_for_status(self):
        pass


class _FakeSession:
    def __init__(self):
        self.url = None

    def get(self, url, timeout=None):
        self.url = url
        return _FakeResponse()


def test_fetch_url_always_uses_ampersand_separator():
    # Regression: the old code used "?" before t=json when the query had no
    # "?", producing "...bugID=67106?t=json" → ZenTao returned "Bad Request!".
    session = _FakeSession()
    zentao.fetch(session, "https://host", "m=bug&f=view&bugID=67106")
    assert session.url == "https://host/index.php?m=bug&f=view&bugID=67106&t=json"


def test_fetch_url_strips_leading_question_mark():
    session = _FakeSession()
    zentao.fetch(session, "https://host", "?m=bug&f=view&bugID=1")
    assert session.url == "https://host/index.php?m=bug&f=view&bugID=1&t=json"
