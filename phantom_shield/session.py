"""Session - the integration point.

Wraps a `curl_cffi.requests.Session` and applies the persona to every
outgoing request:
  - TLS fingerprint via curl_cffi's `impersonate=` parameter
  - User-Agent and Accept-Language headers
  - Sec-CH-UA brand list (Chromium-family profiles)
  - Upstream proxy from the persona's rotation policy
  - DoH resolution if requested
  - Token-bucket rate limiting
  - Inter-request jitter
  - Block detection on every response
  - Auto-rotation on block (opt-in)
  - JSONL request logging
  - Cookie jar persistence across program runs
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

try:
    from curl_cffi import requests as cc
except ImportError as exc:  # pragma: no cover - import-time only
    raise ImportError(
        "curl_cffi is required. Install with: pip install 'phantom-shield[dev]' "
        "or pip install curl_cffi"
    ) from exc

from phantom_shield.persona import Persona
from phantom_shield.upstream import Upstream, build_upstream
from phantom_shield.cookies import CookieStore
from phantom_shield.dns import DoHResolver, build_resolver
from phantom_shield.rate_limit import TokenBucket, build_rate_limiter
from phantom_shield.jitter import Jitter, build_jitter
from phantom_shield.detectors import BlockSignal, detect_block
from phantom_shield.logger import RequestLogger, RequestLogEntry, now_ts


@dataclass
class BlockedResponse:
    """A response decorated with the block signals that fired."""

    response: Any
    signals: list[BlockSignal]

    @property
    def blocked(self) -> bool:
        return bool(self.signals)


class Session:
    """The user-facing HTTPS client.

    Usage:
        with Session(persona) as s:
            r = s.get('https://example.com')
            print(r.status_code)

    The session is single-threaded. For concurrent OSINT pulls, run
    multiple sessions in subprocesses or threads, each with their own
    persona instance.
    """

    def __init__(
        self,
        persona: Persona,
        auto_rotate: bool = False,
        timeout: float = 30.0,
        verify: bool = True,
    ):
        self.persona = persona
        self.auto_rotate = auto_rotate
        self.timeout = timeout
        self.verify = verify

        self._upstream: Upstream = build_upstream(persona.upstream)
        self._cookies = CookieStore(self._cookie_path())
        self._resolver: Optional[DoHResolver] = build_resolver(persona.dns)
        self._limiter: Optional[TokenBucket] = build_rate_limiter(persona.rate_limit)
        self._jitter: Optional[Jitter] = build_jitter(persona.jitter_ms)
        self._logger = RequestLogger(
            path=Path(persona.log["path"]).expanduser() if persona.log.get("path") else None,
            persona=persona.name,
            enabled=persona.log.get("enabled", True),
        )

        self._session: Optional[cc.Session] = None
        self._last_request_at: float = 0.0
        self._first_request: bool = True
        self.last_signals: list[BlockSignal] = []

    # ── lifecycle ─────────────────────────────────────────────────────

    def open(self) -> "Session":
        if self._session is not None:
            return self
        self._session = cc.Session(
            impersonate=self.persona.profile,
            timeout=self.timeout,
            verify=self.verify,
            default_headers=False,
        )
        # Seed cookies from disk.
        cookies = self._cookies.as_dict()
        if cookies:
            for name, value in cookies.items():
                self._session.cookies.set(name, value)
        self._logger._open()
        return self

    def close(self) -> None:
        if self._session is not None:
            self._cookies.update_from_session(self._session)
            self._cookies.save()
            self._session.close()
            self._session = None
        self._logger.close()

    def __enter__(self) -> "Session":
        return self.open()

    def __exit__(self, *exc) -> None:
        self.close()

    # ── HTTP methods ──────────────────────────────────────────────────

    def get(self, url: str, **kwargs) -> Any:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs) -> Any:
        return self.request("POST", url, **kwargs)

    def head(self, url: str, **kwargs) -> Any:
        return self.request("HEAD", url, **kwargs)

    def put(self, url: str, **kwargs) -> Any:
        return self.request("PUT", url, **kwargs)

    def delete(self, url: str, **kwargs) -> Any:
        return self.request("DELETE", url, **kwargs)

    def patch(self, url: str, **kwargs) -> Any:
        return self.request("PATCH", url, **kwargs)

    def request(self, method: str, url: str, **kwargs) -> Any:
        """Issue a request applying all persona policies.

        Honored kwargs (passed through to curl_cffi):
            params, data, json, headers (merged with persona defaults),
            allow_redirects, stream, files
        """
        if self._session is None:
            self.open()
        assert self._session is not None

        # Rate limit.
        if self._limiter:
            self._limiter.acquire()

        # Jitter (skip on first request - no preceding request to jitter from).
        if self._jitter and not self._first_request:
            self._jitter.sleep()
        self._first_request = False

        # Build the request.
        headers = self.persona.request_headers()
        custom = kwargs.pop("headers", None) or {}
        headers.update(custom)

        proxy = self._upstream.current()
        proxies = self._proxies_for(proxy) if proxy else None

        resolve = self._resolve_hint(url)

        # Issue.
        started = time.monotonic()
        ts = now_ts()
        error: Optional[str] = None
        resp = None
        body = ""
        try:
            resp = self._session.request(
                method,
                url,
                headers=headers,
                proxies=proxies,
                resolve=resolve,
                **kwargs,
            )
            body = self._read_body_safely(resp)
        except Exception as e:
            error = f"{type(e).__name__}: {e}"
        latency_ms = (time.monotonic() - started) * 1000.0

        # Detect blocks.
        signals: list[BlockSignal] = []
        if resp is not None and not error:
            detectors = self.persona.on_block.get("detectors")
            signals = detect_block(resp.status_code, dict(resp.headers), body, detectors)
        self.last_signals = signals

        # Log.
        self._logger.log(
            RequestLogEntry(
                ts=ts,
                persona=self.persona.name,
                method=method,
                url=url,
                status=resp.status_code if resp is not None else 0,
                latency_ms=latency_ms,
                upstream=proxy,
                blocked=bool(signals),
                block_signals=[{"detector": s.detector, "reason": s.reason} for s in signals],
                error=error,
                bytes_in=len(body) if body else 0,
            )
        )

        # Auto-rotate on block.
        if signals and self.auto_rotate:
            action = self.persona.on_block.get("action", "rotate_upstream")
            if action == "rotate_upstream":
                self.rotate_upstream()
            elif action == "cool_down":
                time.sleep(float(self.persona.on_block.get("cool_down_s", 60)))
            elif action == "abort":
                if resp is not None:
                    raise BlockedError(self.persona.name, signals, resp)
            # 'raise' equivalent to 'abort' for now.

        # Persist cookies on every request so a crash doesn't lose them.
        self._cookies.update_from_session(self._session)
        self._last_request_at = time.monotonic()

        if error and resp is None:
            raise RuntimeError(error)
        return resp

    # ── rotation / reset controls ─────────────────────────────────────

    def rotate_upstream(self) -> Optional[str]:
        """Force the upstream pool to advance. Cookies are kept."""
        return self._upstream.rotate()

    def reset(self) -> None:
        """Wipe cookies, reset upstream rotation."""
        self._cookies.clear()
        self._upstream.reset()
        if self._session is not None:
            self._session.cookies.clear()

    def current_upstream(self) -> Optional[str]:
        return self._upstream.current()

    # ── helpers ───────────────────────────────────────────────────────

    def _cookie_path(self) -> Optional[Path]:
        path = self.persona.cookies.get("path")
        return Path(path).expanduser() if path else None

    def _proxies_for(self, proxy: str) -> dict[str, str]:
        return {"http": proxy, "https": proxy}

    def _resolve_hint(self, url: str) -> Optional[list[str]]:
        """If DoH is configured, resolve the host and return curl-style resolve
        entries: ['host:port:ip', ...] so curl_cffi skips its own resolver."""
        if not self._resolver:
            return None
        parsed = urlparse(url)
        host = parsed.hostname
        if not host:
            return None
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        addrs = self._resolver.resolve(host)
        if not addrs:
            return None
        # Use first IPv4 if available, else first overall.
        ipv4 = next((a for a in addrs if "." in a), None)
        ip = ipv4 or addrs[0]
        return [f"{host}:{port}:{ip}"]

    @staticmethod
    def _read_body_safely(resp) -> str:
        """Read a snippet of the body for block detection without exhausting streams."""
        try:
            text = resp.text
            return text if len(text) <= 200_000 else text[:200_000]
        except Exception:
            return ""


class BlockedError(RuntimeError):
    """Raised when a request is blocked and on_block.action is 'abort'."""

    def __init__(self, persona: str, signals: list[BlockSignal], response: Any):
        self.persona = persona
        self.signals = signals
        self.response = response
        super().__init__(
            f"persona {persona!r} blocked by " + ", ".join(s.detector for s in signals)
        )
