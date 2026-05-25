import json
from pathlib import Path

from phantom_shield.cookies import CookieStore


class _FakeCookie:
    def __init__(self, name, value, domain=".example.com", path="/", secure=True):
        self.name = name
        self.value = value
        self.domain = domain
        self.path = path
        self.secure = secure
        self.expires = None


class _FakeSession:
    def __init__(self, cookies):
        self.cookies = cookies


def test_empty_store_with_no_path():
    s = CookieStore(None)
    assert s.as_dict() == {}


def test_load_from_existing_file(tmp_path: Path):
    p = tmp_path / "c.json"
    p.write_text(json.dumps([{"name": "sid", "value": "abc", "domain": ".x.com", "path": "/"}]))
    s = CookieStore(p)
    assert s.as_dict() == {"sid": "abc"}


def test_save_creates_parent_dir(tmp_path: Path):
    p = tmp_path / "deep" / "nest" / "c.json"
    s = CookieStore(p)
    s._cookies = [{"name": "sid", "value": "v", "domain": ".x", "path": "/"}]
    s.save()
    assert p.exists()
    loaded = json.loads(p.read_text())
    assert loaded[0]["name"] == "sid"


def test_update_from_session_captures_jar(tmp_path: Path):
    p = tmp_path / "c.json"
    s = CookieStore(p)
    session = _FakeSession([_FakeCookie("a", "1"), _FakeCookie("b", "2")])
    s.update_from_session(session)
    s.save()
    loaded = json.loads(p.read_text())
    names = {c["name"] for c in loaded}
    assert names == {"a", "b"}


def test_clear_removes_file(tmp_path: Path):
    p = tmp_path / "c.json"
    p.write_text("[]")
    s = CookieStore(p)
    s._cookies = [{"name": "x", "value": "y"}]
    s.clear()
    assert s._cookies == []
    assert not p.exists()


def test_malformed_file_yields_empty(tmp_path: Path):
    p = tmp_path / "c.json"
    p.write_text("garbage{")
    s = CookieStore(p)
    assert s.as_dict() == {}
