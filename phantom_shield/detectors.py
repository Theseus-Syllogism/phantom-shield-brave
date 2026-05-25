"""Anti-bot challenge / block detection.

Each detector inspects an HTTP response and decides whether the request
was blocked or challenged. The Session collects all positive signals
(a response can match multiple detectors) and exposes them as a
BlockSignal list.

Detectors are heuristic; they aim for low false-positive rate on a real
200-OK content page and high recall on known challenge pages.

A response is considered blocked when at least one detector fires.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Optional


@dataclass
class BlockSignal:
    detector: str
    reason: str
    status: int


# A detector takes (response_status, response_headers, response_body_text)
# and returns a BlockSignal or None.
Detector = Callable[[int, dict, str], Optional[BlockSignal]]


def _h(headers: dict, name: str) -> str:
    """Case-insensitive header lookup."""
    name_lower = name.lower()
    for k, v in headers.items():
        if k.lower() == name_lower:
            return str(v)
    return ""


def cloudflare(status: int, headers: dict, body: str) -> Optional[BlockSignal]:
    cf_ray = _h(headers, "cf-ray")
    cf_mitigated = _h(headers, "cf-mitigated")
    if cf_mitigated:
        return BlockSignal("cloudflare", f"cf-mitigated: {cf_mitigated}", status)
    if status in (403, 503) and cf_ray:
        if "checking your browser" in body.lower() or "challenge-platform" in body.lower():
            return BlockSignal("cloudflare", "challenge page", status)
        if "attention required" in body.lower():
            return BlockSignal("cloudflare", "attention required", status)
    if "__cf_chl_" in body:
        return BlockSignal("cloudflare", "challenge token in body", status)
    return None


def akamai(status: int, headers: dict, body: str) -> Optional[BlockSignal]:
    if "akam-x" in str(headers).lower() or _h(headers, "x-akamai-request-id"):
        if status in (403, 429):
            return BlockSignal("akamai", "Akamai-served block", status)
    if "akam" in body.lower() and "reference number" in body.lower():
        return BlockSignal("akamai", "reference-number page", status)
    return None


def perimeterx(status: int, headers: dict, body: str) -> Optional[BlockSignal]:
    if _h(headers, "x-px-block") or _h(headers, "px-block"):
        return BlockSignal("perimeterx", "x-px-block header", status)
    if "px-captcha" in body or "_pxhd" in body or "perimeterx.net" in body:
        return BlockSignal("perimeterx", "px markers in body", status)
    return None


def recaptcha(status: int, headers: dict, body: str) -> Optional[BlockSignal]:
    has_marker = (
        "google.com/recaptcha" in body
        or "grecaptcha" in body
        or "g-recaptcha" in body
    )
    if not has_marker:
        return None
    # Distinguish "page uses recaptcha somewhere" vs "this IS a recaptcha challenge".
    # If the response is a hard block status, or the recaptcha widget appears
    # without a server-side /api/siteverify endpoint (which is the legitimate
    # server flow), treat it as a challenge.
    if status in (403, 429) or "/api/siteverify" not in body:
        return BlockSignal("recaptcha", "challenge page", status)
    return None


def hcaptcha(status: int, headers: dict, body: str) -> Optional[BlockSignal]:
    if "hcaptcha.com" in body or "h-captcha" in body:
        if status in (403, 429) or 'class="h-captcha"' in body:
            return BlockSignal("hcaptcha", "challenge page", status)
    return None


def rate_limited(status: int, headers: dict, body: str) -> Optional[BlockSignal]:
    if status == 429:
        retry_after = _h(headers, "retry-after")
        msg = f"HTTP 429 (retry-after: {retry_after})" if retry_after else "HTTP 429"
        return BlockSignal("rate_limit", msg, status)
    return None


_FORBIDDEN_RE = re.compile(r"\b(access denied|forbidden|blocked|not authorized)\b", re.I)


def generic_403(status: int, headers: dict, body: str) -> Optional[BlockSignal]:
    if status == 403 and _FORBIDDEN_RE.search(body[:2000]):
        return BlockSignal("generic_403", "403 with denial keyword", status)
    return None


ALL_DETECTORS: dict[str, Detector] = {
    "cloudflare": cloudflare,
    "akamai": akamai,
    "perimeterx": perimeterx,
    "recaptcha": recaptcha,
    "hcaptcha": hcaptcha,
    "rate_limit": rate_limited,
    "generic_403": generic_403,
}


def detect_block(
    status: int,
    headers: dict,
    body: str,
    detectors: Optional[list[str]] = None,
) -> list[BlockSignal]:
    """Run the requested detectors over a response. Returns all signals."""
    selected = ALL_DETECTORS if not detectors else {n: ALL_DETECTORS[n] for n in detectors if n in ALL_DETECTORS}
    signals: list[BlockSignal] = []
    for fn in selected.values():
        sig = fn(status, headers, body)
        if sig:
            signals.append(sig)
    return signals
