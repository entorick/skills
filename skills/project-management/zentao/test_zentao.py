import json
import pytest
import zentao


def test_auth_redirect_detected():
    body = "<html><script>self.location='/index.php?m=user&f=login&referer=Lw==';</script></html>"
    assert zentao.looks_like_auth_redirect(body) is True
    with pytest.raises(zentao.AuthExpired):
        zentao.decode_envelope(body)


def test_deny_redirect_detected():
    body = "<html><script>self.location='/index.php?m=user&f=deny&module=my';</script></html>"
    with pytest.raises(zentao.AuthExpired):
        zentao.decode_envelope(body)


def test_json_locate_redirect_detected():
    # Under &t=json, an expired cookie returns a success envelope whose decoded
    # data is {"locate": "...m=user&f=login..."} rather than the HTML bounce.
    inner = json.dumps({"locate": "https://host/index.php?m=user&f=login&t=json&referer=Lw=="})
    outer = json.dumps({"status": "success", "data": inner})
    with pytest.raises(zentao.AuthExpired):
        zentao.decode_envelope(outer)


def test_double_decode_restores_unicode():
    inner = json.dumps({"title": "你好bug", "id": "1"}, ensure_ascii=True)  # \uXXXX escapes
    outer = json.dumps({"status": "success", "data": inner})
    result = zentao.decode_envelope(outer)
    assert result["title"] == "你好bug"
    assert result["id"] == "1"


def test_non_success_status_raises():
    outer = json.dumps({"status": "fail", "message": "nope"})
    with pytest.raises(zentao.ZenTaoError):
        zentao.decode_envelope(outer)


def test_garbage_raises_zentaoerror():
    with pytest.raises(zentao.ZenTaoError):
        zentao.decode_envelope("<html>totally not json and no redirect</html>")
