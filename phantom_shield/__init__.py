"""Phantom Shield Python client.

OSINT-oriented HTTPS client that wraps curl_cffi with persona-driven
configuration: TLS fingerprint impersonation, upstream proxy rotation,
DoH resolution, per-persona cookie jars, rate limiting, request jitter,
block detection, and audit logging.

Designed as a sibling to the Brave/Chromium extension. Shares the same
profile/region/resolution catalogue (profiles.json) so the two never drift.

Basic use:

    from phantom_shield import Persona, Session

    alice = Persona.load("alice")
    with Session(alice) as s:
        r = s.get("https://api.example.com")
        print(r.status_code, r.text[:200])
"""

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
)
from phantom_shield.persona import Persona
from phantom_shield.session import Session, BlockedResponse
from phantom_shield.upstream import Upstream, DirectUpstream, PoolUpstream
from phantom_shield.detectors import detect_block, BlockSignal

__version__ = "0.6.0"

__all__ = [
    "Persona",
    "Session",
    "BlockedResponse",
    "Upstream",
    "DirectUpstream",
    "PoolUpstream",
    "BlockSignal",
    "detect_block",
    "PROFILES",
    "REGIONS",
    "RESOLUTIONS",
    "WEBRTC_MODES",
    "DEFAULT_PROFILE",
    "DEFAULT_REGION",
    "find_profile",
    "find_region",
    "find_resolution",
]
