# mitmproxy addon - re-issue upstream requests via curl_cffi so the TLS
# ClientHello matches a real Chrome/Firefox/Safari (JA3/JA4 + HTTP/2 fingerprint).
#
# Pipeline:
#   Brave  →  mitmproxy (terminates TLS with our CA)  →  curl_cffi (impersonates)  →  origin
#
# Per-request profile selection:
#   - Phantom Shield extension sets the request header X-TLS-Impersonate: <profile>
#   - This addon pops the header, validates against curl_cffi's BrowserType enum,
#     and uses the value as the impersonate kwarg for the upstream request.
#   - Absent / invalid / unknown → falls back to DEFAULT_IMPERSONATE.

import logging

import curl_cffi
from curl_cffi import requests as cc
from curl_cffi.requests import BrowserType
from mitmproxy import http

DEFAULT_IMPERSONATE = "chrome146"

PROBE_HOST = "phantom-shield-bridge.test"
BRIDGE_VERSION = "phantom-shield-bridge/0.7"

VALID_PROFILES = {b.value for b in BrowserType}

HOP_BY_HOP = frozenset({
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade",
    "accept-encoding",  # curl_cffi sets to match the impersonated profile
})

CONTROL_HEADER = "X-TLS-Impersonate"


class CurlCffiUpstream:
    def __init__(self):
        self.log = logging.getLogger("tls-mitm")

    def request(self, flow: http.HTTPFlow) -> None:
        req = flow.request

        if req.host == PROBE_HOST:
            profile = req.headers.pop(CONTROL_HEADER, "").strip() or DEFAULT_IMPERSONATE
            supported = profile in VALID_PROFILES
            flow.response = http.Response.make(
                200, b"",
                {
                    "X-Phantom-Profile": profile if supported else DEFAULT_IMPERSONATE,
                    "X-Phantom-Bridge-Version": BRIDGE_VERSION,
                    "X-Phantom-Supported": "1" if supported else "0",
                    "Cache-Control": "no-store",
                },
            )
            return

        if req.scheme != "https":
            return

        # Pull and validate the per-request profile selector.
        profile = req.headers.pop(CONTROL_HEADER, "").strip() or DEFAULT_IMPERSONATE
        if profile not in VALID_PROFILES:
            self.log.warning(
                "unknown profile %r from extension, falling back to %s",
                profile, DEFAULT_IMPERSONATE,
            )
            profile = DEFAULT_IMPERSONATE

        headers = {k: v for k, v in req.headers.items() if k.lower() not in HOP_BY_HOP}

        try:
            r = cc.request(
                method=req.method,
                url=req.url,
                headers=headers,
                data=req.raw_content,
                impersonate=profile,
                allow_redirects=False,
                verify=True,
                timeout=30,
                http_version=curl_cffi.CurlHttpVersion.V2TLS,
            )
        except Exception as e:
            self.log.warning("curl_cffi failure for %s (%s): %s", req.url, profile, e)
            flow.response = http.Response.make(
                502,
                f"tls-mitm upstream error: {e}".encode(),
                {"content-type": "text/plain"},
            )
            return

        # mitmproxy 12 requires bytes for header tuples.
        resp_headers = [
            (k.encode("latin-1"), v.encode("latin-1"))
            for k, v in r.headers.multi_items()
            if k.lower() not in HOP_BY_HOP
        ]
        # Echo the active profile - useful for smoke testing.
        resp_headers.append((b"X-Phantom-Profile", profile.encode("ascii")))

        flow.response = http.Response.make(r.status_code, r.content, resp_headers)


addons = [CurlCffiUpstream()]
