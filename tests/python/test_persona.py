from pathlib import Path

import pytest
import yaml

from phantom_shield.persona import Persona


def test_default_persona_uses_default_profile_and_region():
    p = Persona(name="anon")
    assert p.profile == "chrome146"
    assert p.region == "us-east"


def test_persona_from_dict_rejects_unknown_keys():
    with pytest.raises(ValueError) as exc:
        Persona.from_dict({"name": "x", "bogus_key": 1})
    assert "bogus_key" in str(exc.value)


def test_persona_round_trip_yaml(tmp_path: Path):
    alice = Persona(
        name="alice",
        profile="safari260",
        region="jp",
        upstream={"type": "pool", "servers": ["socks5://localhost:9050"], "rotation": "sticky-30m"},
        cookies={"path": str(tmp_path / "cookies.json")},
        rate_limit={"per_minute": 60, "burst": 10},
        jitter_ms=[100, 500],
    )
    path = alice.save(tmp_path / "alice.yaml")
    assert path.exists()

    loaded = Persona.from_path(path)
    assert loaded.name == "alice"
    assert loaded.profile == "safari260"
    assert loaded.region == "jp"
    assert loaded.upstream["rotation"] == "sticky-30m"
    assert loaded.rate_limit["per_minute"] == 60
    assert loaded.jitter_ms == [100, 500]


def test_request_headers_for_chrome_profile():
    p = Persona(name="x", profile="chrome146", region="us-east")
    h = p.request_headers()
    assert "Chrome/146" in h["User-Agent"]
    assert h["Accept-Language"] == "en-US,en;q=0.9"
    assert "Sec-CH-UA" in h
    assert h["Sec-CH-UA-Mobile"] == "?0"
    assert h["Sec-CH-UA-Platform"] == '"Windows"'


def test_request_headers_for_firefox_omits_sec_ch_ua():
    p = Persona(name="x", profile="firefox147", region="us-east")
    h = p.request_headers()
    assert "Firefox/147" in h["User-Agent"]
    assert "Sec-CH-UA" not in h


def test_request_headers_for_mobile_safari_jp():
    p = Persona(name="x", profile="safari260_ios", region="jp")
    h = p.request_headers()
    assert "iPhone" in h["User-Agent"]
    assert h["Accept-Language"] == "ja,en-US;q=0.9,en;q=0.8"
    # Safari has no Sec-CH-UA.
    assert "Sec-CH-UA" not in h


def test_extra_headers_merged():
    p = Persona(name="x", extra_headers={"X-Custom": "1", "X-API-Key": "abc"})
    h = p.request_headers()
    assert h["X-Custom"] == "1"
    assert h["X-API-Key"] == "abc"


def test_load_falls_back_to_yml_extension(tmp_path: Path):
    (tmp_path / "bob.yml").write_text(yaml.safe_dump({"name": "bob", "profile": "edge101"}))
    loaded = Persona.load("bob", search_dir=tmp_path)
    assert loaded.profile == "edge101"


def test_load_not_found(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        Persona.load("nope", search_dir=tmp_path)


def test_all_chromium_profiles_have_coherent_platform_hint():
    """Every Chromium profile's Sec-CH-UA-Platform must match its UA platform.

    Locks in the coherence the browser path was fixed to match. The Python
    client already builds hints from the profile (persona.request_headers),
    so this guards against a profile being added with a mismatched platform.
    """
    from phantom_shield.catalog import PROFILES

    token = {"Windows": "Windows", "macOS": "Macintosh",
             "iOS": "iPhone", "Android": "Android", "Linux": "Linux"}
    for prof in PROFILES:
        if not prof.get("brands"):
            continue  # non-Chromium: no Sec-CH-UA expected
        p = Persona(name="t", profile=prof["value"], region="us-east")
        h = p.request_headers()
        platform = h["Sec-CH-UA-Platform"].strip('"')
        assert platform == prof["platform"], (
            f"{prof['value']}: hint {platform!r} != profile {prof['platform']!r}")
        assert token[platform] in prof["ua"], (
            f"{prof['value']}: UA {prof['ua']!r} lacks platform token for {platform!r}")
