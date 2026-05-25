"""DNS-over-HTTPS resolution.

When a persona sets `dns.mode: doh`, the Session resolves hostnames via a
DoH endpoint instead of the local system resolver. This avoids leaving
queries in ISP/DNS-provider logs.

Implementation: we issue an RFC 8484 GET to the DoH resolver and parse
the JSON response (RFC 8427-ish JSON format that Cloudflare and Google
both support, accessed via the `application/dns-json` content type).

The resolved IP is fed into curl_cffi via its `resolve` parameter, which
short-circuits the URL's hostname to a specific IP for that request.
"""

from __future__ import annotations

import json
import socket
import time
from dataclasses import dataclass
from typing import Optional
from urllib.request import Request, urlopen


# DoH endpoints. The mode 'doh' picks 'cloudflare' by default.
DOH_ENDPOINTS = {
    "cloudflare": "https://cloudflare-dns.com/dns-query",
    "google": "https://dns.google/resolve",
    "quad9": "https://dns.quad9.net:5053/dns-query",
}


@dataclass
class _CacheEntry:
    addrs: list[str]
    expires_at: float


class DoHResolver:
    """Resolves hostnames via a DoH endpoint. Short TTL cache to avoid
    hammering the resolver."""

    def __init__(
        self,
        endpoint: str = DOH_ENDPOINTS["cloudflare"],
        cache_ttl_s: float = 60.0,
        timeout_s: float = 5.0,
    ):
        self.endpoint = endpoint
        self.cache_ttl_s = cache_ttl_s
        self.timeout_s = timeout_s
        self._cache: dict[str, _CacheEntry] = {}

    def resolve(self, hostname: str) -> list[str]:
        """Return a list of IPv4/IPv6 addresses for hostname."""
        now = time.monotonic()
        hit = self._cache.get(hostname)
        if hit and hit.expires_at > now:
            return hit.addrs

        addrs = self._query(hostname)
        self._cache[hostname] = _CacheEntry(addrs=addrs, expires_at=now + self.cache_ttl_s)
        return addrs

    def _query(self, hostname: str) -> list[str]:
        url = f"{self.endpoint}?name={hostname}&type=A"
        req = Request(url, headers={"Accept": "application/dns-json"})
        try:
            with urlopen(req, timeout=self.timeout_s) as resp:
                body = resp.read()
        except Exception:
            return []
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return []
        addrs: list[str] = []
        for ans in data.get("Answer") or []:
            # Type 1 = A record. Type 28 = AAAA. We accept both.
            if ans.get("type") in (1, 28):
                v = ans.get("data")
                if v:
                    addrs.append(v)
        return addrs


def build_resolver(cfg: Optional[dict]) -> Optional[DoHResolver]:
    """Return a DoHResolver if the persona requested DoH, else None."""
    if not cfg:
        return None
    mode = cfg.get("mode", "system")
    if mode != "doh":
        return None
    resolver_name = cfg.get("resolver", "cloudflare")
    endpoint = DOH_ENDPOINTS.get(resolver_name)
    if not endpoint:
        raise ValueError(f"unknown DoH resolver: {resolver_name!r}")
    return DoHResolver(endpoint=endpoint, cache_ttl_s=cfg.get("cache_ttl_s", 60.0))


def system_resolves(hostname: str) -> list[str]:
    """Fallback: resolve via the OS resolver. Used for testing parity."""
    try:
        return list({info[4][0] for info in socket.getaddrinfo(hostname, None)})
    except OSError:
        return []
