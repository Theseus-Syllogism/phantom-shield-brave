from phantom_shield.catalog import (
    PROFILES,
    REGIONS,
    RESOLUTIONS,
    WEBRTC_MODES,
    DEFAULT_PROFILE,
    DEFAULT_REGION,
    find_profile,
    find_region,
    find_resolution,
    accept_language,
)


def test_catalog_loads_with_expected_size():
    assert len(PROFILES) >= 19
    assert len(REGIONS) == 12
    assert len(RESOLUTIONS) == 8
    assert len(WEBRTC_MODES) == 3


def test_default_profile_and_region_resolvable():
    p = find_profile(DEFAULT_PROFILE)
    assert p["value"] == DEFAULT_PROFILE
    r = find_region(DEFAULT_REGION)
    assert r["id"] == DEFAULT_REGION


def test_find_profile_falls_back_for_unknown():
    p = find_profile("definitely-not-real")
    assert p["value"] == PROFILES[0]["value"]


def test_find_region_falls_back_for_unknown():
    r = find_region("zz")
    assert r["id"] == REGIONS[0]["id"]


def test_every_profile_has_caps_block():
    for p in PROFILES:
        caps = p.get("caps")
        assert caps is not None, p["value"]
        for k in ("hwConcurrency", "deviceMemory", "maxTouchPoints", "vendor", "productSub"):
            assert k in caps, f"{p['value']} missing caps.{k}"


def test_accept_language_table():
    assert accept_language(["en-US"]) == "en-US"
    assert accept_language(["en-US", "en"]) == "en-US,en;q=0.9"
    assert accept_language(["de-DE", "de", "en"]) == "de-DE,de;q=0.9,en;q=0.8"
    assert accept_language(["ja", "en-US", "en"]) == "ja,en-US;q=0.9,en;q=0.8"
    assert accept_language([]) == "en-US,en;q=0.9"
