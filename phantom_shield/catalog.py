"""Loads the shared profiles.json catalogue and exposes lookup helpers.

profiles.json is generated from profiles.js by scripts/generate-profiles-json.mjs
so the JS extension and this Python package never drift.
"""

from __future__ import annotations

import json
from importlib.resources import files
from typing import Any


def _load() -> dict[str, Any]:
    path = files("phantom_shield").joinpath("profiles.json")
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


_DATA = _load()

PROFILES: list[dict[str, Any]] = _DATA["profiles"]
REGIONS: list[dict[str, Any]] = _DATA["regions"]
RESOLUTIONS: list[dict[str, Any]] = _DATA["resolutions"]
WEBRTC_MODES: list[dict[str, Any]] = _DATA["webrtc_modes"]
DEFAULT_PROFILE: str = _DATA["default_profile"]
DEFAULT_REGION: str = _DATA["default_region"]


def find_profile(value: str) -> dict[str, Any]:
    """Return the profile dict for `value`, or the default if unknown."""
    for p in PROFILES:
        if p["value"] == value:
            return p
    return PROFILES[0]


def find_region(id_: str) -> dict[str, Any]:
    """Return the region dict for `id_`, or the default if unknown."""
    for r in REGIONS:
        if r["id"] == id_:
            return r
    return REGIONS[0]


def find_resolution(id_: str) -> dict[str, Any]:
    """Return the resolution dict for `id_`, or the default if unknown."""
    for r in RESOLUTIONS:
        if r["id"] == id_:
            return r
    return RESOLUTIONS[0]


def accept_language(languages: list[str]) -> str:
    """Build an Accept-Language header value matching Chrome's q-value convention."""
    if not languages:
        return "en-US,en;q=0.9"
    parts: list[str] = []
    for i, lang in enumerate(languages):
        if i == 0:
            parts.append(lang)
        else:
            q = max(0.1, round(1 - i * 0.1, 1))
            parts.append(f"{lang};q={q}")
    return ",".join(parts)
