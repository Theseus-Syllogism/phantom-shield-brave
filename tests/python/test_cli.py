"""Tests for the CLI argument parser and the non-network-dependent commands."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from phantom_shield.cli import build_parser, cmd_personas_new, cmd_personas_list, cmd_profiles_list, cmd_profiles_show, _parse_kv_list


def test_parser_get_minimal():
    p = build_parser()
    ns = p.parse_args(["get", "https://example.com"])
    assert ns.cmd == "get"
    assert ns.url == "https://example.com"


def test_parser_post_with_json():
    p = build_parser()
    ns = p.parse_args(["post", "https://x.com", "--json", '{"a":1}'])
    assert ns.json == '{"a":1}'


def test_parse_kv_list_supports_both_styles():
    assert _parse_kv_list(["a:1", "b=2"]) == {"a": "1", "b": "2"}


def test_parse_kv_list_rejects_unparseable():
    with pytest.raises(SystemExit):
        _parse_kv_list(["nobang"])


def test_profiles_list_runs(capsys):
    class _Args: pass
    rc = cmd_profiles_list(_Args())
    captured = capsys.readouterr()
    assert rc == 0
    assert "chrome146" in captured.out
    # At least one mobile profile listed.
    assert any("mobile" in line for line in captured.out.splitlines())


def test_profiles_show_known(capsys):
    class _Args: pass
    a = _Args()
    a.value = "chrome146"
    rc = cmd_profiles_show(a)
    captured = capsys.readouterr()
    assert rc == 0
    assert "Chrome 146" in captured.out
    assert "user-agent" in captured.out


def test_profiles_show_unknown_warns(capsys):
    class _Args: pass
    a = _Args()
    a.value = "not-a-profile"
    rc = cmd_profiles_show(a)
    captured = capsys.readouterr()
    assert rc == 1
    assert "unknown profile" in captured.err


def test_personas_new_writes_file(tmp_path: Path, monkeypatch, capsys):
    monkeypatch.setenv("PHANTOM_PERSONA_DIR", str(tmp_path))
    # Re-import to pick up the new env var.
    import importlib
    import phantom_shield.persona as pp
    importlib.reload(pp)
    import phantom_shield.cli as cli
    importlib.reload(cli)

    class _Args: pass
    a = _Args()
    a.name = "testpersona"
    a.profile = "chrome146"
    a.region = "us-east"
    a.upstream = ["socks5://127.0.0.1:9050"]
    a.rotation = "sticky-1h"
    a.tor = False
    a.doh = True
    a.rate = 30
    a.jitter = [100, 500]

    rc = cli.cmd_personas_new(a)
    captured = capsys.readouterr()
    assert rc == 0
    target = tmp_path / "testpersona.yaml"
    assert target.exists()
    content = target.read_text()
    assert "chrome146" in content
    assert "socks5://127.0.0.1:9050" in content
