# Phantom Shield

A fingerprinting-defense toolkit for Brave/Chromium and the terminal. It does three things that work independently: it overrides 40 browser fingerprinting surfaces that Brave's built-in farbling leaves untouched, it drives upstream TLS/JA3 impersonation through a local mitmproxy bridge, and it ships a Python package that applies the same identity model to scripted HTTP for OSINT and research.

**Status:** v0.7.0. Brave hardening complete (40 phantoms across four tiers, 20 TLS profiles, region/resolution/WebRTC coherence). One-command bridge installer and a one-step "Phantom Browser" launcher for Linux and Windows. 59 JS unit tests, 83 Python unit tests, plus shell test harnesses for the installers.

---

## Contents

- [What it is](#what-it-is)
- [Use cases](#use-cases)
- [Architecture](#architecture)
- [Getting started](#getting-started)
- [Settings and configuration](#settings-and-configuration)
- [Python client (terminal / OSINT)](#python-client-terminal--osint)
- [Command reference](#command-reference)
- [Testing](#testing)
- [Project layout](#project-layout)
- [Security and limitations](#security-and-limitations)
- [Roadmap](#roadmap)

---

## What it is

Four pieces in one repository. The first three are independent; the fourth ties them together for convenience.

**1. JS-side phantoms (the extension).** Forty fingerprinting surfaces get prototype-level overrides at `document_start` in the page's MAIN world, before page scripts run. Examples: `navigator.getGamepads`, `navigator.connection`, `navigator.userAgentData.getHighEntropyValues`, the WebGPU adapter's vendor strings, `performance.memory`, WebHID/WebSerial/WebUSB device lists, `screen.orientation`, the WebRTC ICE candidate stream, the `FontFaceSet` iterator, and `Intl.DateTimeFormat`'s default timezone. Each phantom is individually toggleable.

**2. TLS bridge.** The extension tags every outgoing HTTPS request with `X-TLS-Impersonate: <profile>` via declarativeNetRequest. A local mitmproxy addon strips that header and re-issues the request through `curl_cffi`, so the upstream server sees a TLS ClientHello, ALPN ordering, and HTTP/2 frame sequence that match a real Chrome/Firefox/Safari/Edge/Tor build. The same rules rewrite `User-Agent` and `Accept-Language` and strip `Sec-CH-UA-*` so Brave's real platform never leaks.

**3. Python client (`phantom_shield`).** A sibling package for scripted HTTP. It reads the same profile catalogue as the extension and wraps `curl_cffi` directly (no mitmproxy needed), adding per-persona upstream proxy rotation, DNS-over-HTTPS, cookie-jar persistence, rate limiting, request jitter, anti-bot challenge detection, and JSONL audit logging. Usable as a Python API or the `phantom` CLI.

**4. Phantom Browser launcher.** A one-step wrapper that starts your installed Brave as a separate, isolated instance (its own profile, proxy, and CA trust) with the extension preloaded and a session-scoped bridge that shuts down when you close the window. It leaves your everyday Brave untouched.

The three core halves are decoupled. With the bridge off, the JS phantoms still operate; you just lose TLS-level impersonation in the browser. The Python client never touches mitmproxy.

---

## Use cases

- **Anti-bot research and red-team testing of your own systems.** See exactly what a coherent client sends, with TLS, User-Agent, UA Client Hints, navigator state, and screen state all consistent with one another. Incoherence (a Chrome JA3 with a Firefox User-Agent, or a desktop screen with a mobile profile) is the classic detection signal; this keeps every layer aligned.
- **Population blending.** Present as a common cohort (Chrome 146 on Windows, Safari on iOS) without hand-maintaining UA strings, header lists, navigator overrides, and TLS profiles in three separate places.
- **Privacy research.** A controlled environment where you can flip individual fingerprint surfaces on and off and observe the effect on a fingerprinting probe.
- **Locale and timezone control.** Appear from a different region without the lie being obvious from a `new Date().getTimezoneOffset()` or `Intl.DateTimeFormat().resolvedOptions()` check.
- **OSINT collection over hostile networks.** The Python client pulls public data through rotating upstreams and a real-browser TLS fingerprint, getting past WAFs that block default scrapers, while DoH keeps queries out of ISP logs.

If you only want "be a bit less trackable on the open web," Brave's built-in farbling plus uBlock Origin is enough. Phantom Shield exists for the cases above, where coherence and TLS-level fidelity matter.

A note on Tor: this toolkit is built for *blending into the general web population*, which is the opposite of Tor Browser's *uniform anonymity-set* model. Do not load the extension into Tor Browser (it would make you more unique, not less). The Python client's Tor support is for collection against Tor-hostile targets, not for source protection. See [`docs/`](docs/) for the longer discussion.

---

## Architecture

### Browser path (extension + bridge)

```
Brave (mitmproxy set as HTTPS proxy)
  |
  +-- popup.html / options.html ....... pick profile, region, resolution; toggle phantoms
  |        |
  |        v
  |    chrome.storage.local ........... cfg, profile, region, resolution, webrtcLeakMode, seed
  |        |
  |        +--> background.js (service worker)
  |        |       - resolves profile + region + resolution into active* keys
  |        |       - sets 4 declarativeNetRequest rules:
  |        |           X-TLS-Impersonate, User-Agent, Sec-CH-UA-* strip, Accept-Language
  |        |       - fires the bridge self-check against phantom-shield-bridge.test
  |        |
  |        +--> isolated.js (ISOLATED world)
  |                - mirrors active* keys onto <html data-phantom-shield="{...}">
  |
  +-- inject.js (MAIN world, document_start)
          - registers 40 phantoms
          - reads bridge state from the data attribute on every reconcile

(all HTTPS traffic)
          |
          v
mitmproxy --- terminates TLS with its own CA
          |
          v
bridge/addon.py (CurlCffiUpstream)
          - pops X-TLS-Impersonate
          - re-issues via curl_cffi.request(impersonate=profile)
          - JA3 / JA4 / ALPN / H2 fingerprint matches the impersonated browser
          |
          v
     origin server
```

The in-page data flow is strictly one-way: `background.js` writes storage, `isolated.js` mirrors it onto a DOM attribute, `inject.js` reads the attribute. `inject.js` never touches `chrome.*` APIs because it runs in the MAIN world, which cannot see them. That data-attribute bridge is what lets MAIN-world overrides stay in sync with extension state without a messaging round-trip.

### Launcher path

```
phantom-browser.sh / .ps1
  |
  +-- (first run) provision bridge via install.sh --no-service --no-ca
  +-- trust the mitmproxy CA in an ISOLATED store (Linux: per-instance NSS; Windows: user Root)
  +-- pick a free port (8118 -> 8119 -> 8120)
  +-- start mitmdump --set connection_strategy=lazy   [session-scoped]
  +-- launch Brave: isolated HOME + --user-data-dir + --load-extension + --proxy-server=<port>
  +-- on window close: stop the bridge, release the lock
```

The launcher owns the port end-to-end, so it passes the same value to mitmproxy and to Brave's `--proxy-server`. A busy 8118 rolls forward automatically and nothing needs configuring in the extension.

### Python path

```
phantom_shield.Session(persona)
  |
  +-- catalog.py    -> TLS profile + UA + brands from profiles.json
  +-- persona.py    -> region, upstream pool, DoH, cookies, rate, jitter, detectors, log
  +-- upstream.py   -> rotate SOCKS5/HTTP proxies (sticky / round-robin / per-request / on-failure)
  +-- dns.py        -> resolve hostnames over DoH (Cloudflare/Google/Quad9)
  +-- rate_limit.py -> token bucket;  jitter.py -> sleep between requests
  |
  v
curl_cffi.request(impersonate=profile, proxy=<chosen>, ...)
  |
  +-- detectors.py  -> scan response for Cloudflare/Akamai/PerimeterX/CAPTCHA/429/403
  +-- cookies.py    -> persist the jar per persona
  +-- logger.py     -> append one JSONL line per request
```

---

## Getting started

There are three entry points. Pick the one that matches what you want.

### A. Phantom Browser launcher (easiest, isolated)

Starts your installed Brave as a separate Phantom instance and tears the bridge down on exit. Nothing to configure, your everyday Brave is untouched.

```sh
git clone http://192.168.50.24:3000/nathan/phantom-shield-v2.git
cd phantom-shield-v2
./scripts/phantom-browser.sh          # or: npm run phantom
```

First run provisions the bridge (one-time pip install) and trusts the mitmproxy CA only inside the isolated Phantom profile. On Windows, double-click `scripts\phantom-browser.cmd`. Requires Brave already installed; pass `--brave <path>` or set `BRAVE_BIN` if it is not on `PATH`. Running as root adds `--no-sandbox` automatically (Chromium requires it) with a warning.

### B. Bridge installer + your everyday Brave

For using Phantom Shield in your normal browser. Sets up the bridge as a background service and trusts the CA system-wide.

```sh
./scripts/install.sh                   # Linux/macOS
.\scripts\install.ps1                  # Windows (elevated PowerShell)
```

Then load the extension and point Brave at the bridge:

1. Open `brave://extensions`, enable Developer mode, click **Load unpacked**, and select the repo root (where `manifest.json` lives).
2. Open the extension's options page. The bridge-setup card walks you through any step that is not green: click **Apply browser proxy**, then **Re-verify all steps**.

Installer flags: `--check`, `--port N`, `--no-ca`, `--no-service`, `--verbose`, `--help`. The installer creates a venv under `~/.local/share/phantom-shield/bridge/` (Linux), installs the CA into the OS trust store and the per-user NSS store that Chromium actually reads, and registers a systemd user unit / launchd agent / scheduled task.

### C. Python client only

```sh
pip install -e .                       # from the repo root
```

Depends on `curl_cffi` and `PyYAML`. No browser or mitmproxy involved. See [Python client](#python-client-terminal--osint).

---

## Settings and configuration

All extension settings live in the popup (compact) or the options page (full) and persist in `chrome.storage.local` across restarts. Toggling a phantom propagates to every open tab within about 50ms through a `MutationObserver` on the `data-phantom-shield` attribute, with no reload. Every selector lists its full value inline (the UA string, the locale, the dimensions) plus a one-line description of when to use it.

### TLS profiles

20 preconfigured profiles. Each carries a `curl_cffi`-supported fingerprint identifier, a matching User-Agent, a Sec-CH-UA brand list, platform/mobile flags, navigator capability hints, and a usage description.

| Family | Versions |
|---|---|
| Chrome (Windows) | 120, 131, 136, 142, 145, 146 |
| Chrome (Android) | 99, 131 |
| Edge (Windows) | 99, 101 |
| Firefox (Windows) | 133, 135, 144, 147 |
| Safari (macOS) | 18.0, 18.4, 26 |
| Safari (iOS) | 18.4, 26 |
| Tor Browser | 14.5 (Firefox 128 ESR base) |

`npm run check` verifies every profile in `profiles.js` is actually supported by the installed `curl_cffi`. The options page has a collapsible "Browse all TLS profiles" section listing every profile with its full UA and description side by side.

### Phantoms by tier

Forty surfaces, grouped by signal strength. All default on except the experimental double-noise.

- **Core (9):** gamepad, Bluetooth availability, keyboard layout, storage estimate, web locks, network information, UA-CH high-entropy, memory measurement, WebGPU adapter.
- **Tier 1 (7):** JS heap size (`performance.memory`), WebHID/WebSerial/WebUSB device lists, installed related apps, media HW decode capability, WebRTC codec list.
- **Tier 2 (7):** multi-monitor flag, virtual keyboard rect, wake lock, idle detection, compute pressure, motion/orientation sensors, accessibility media queries.
- **Tier 3 (17, coherence):** language, timezone, Intl locale coherence, screen dimensions, color depth, devicePixelRatio, screen orientation, hardware concurrency, device memory, touch points, PDF viewer flag, WebDriver flag, vendor strings, appVersion, WebRTC IP leak filter, font enumeration, and the experimental canvas/audio double-noise.

Each row in the options page names the exact API surface it covers. Disable any that breaks a site you need.

### Region

Twelve presets (US East/Central/West, UK, Germany, France, Japan, Korea, Brazil, India, Australia, Canada). A region drives, all coherently:

- `Date.prototype.getTimezoneOffset`, with DST resolved per-date via `Intl.DateTimeFormat(..., {timeZoneName:'longOffset'})`.
- `Intl.DateTimeFormat().resolvedOptions().timeZone` for formatters built without an explicit `timeZone`.
- The default locale for `Intl.Collator`, `NumberFormat`, `RelativeTimeFormat`, `PluralRules`, `ListFormat`, `Segmenter`, and `DisplayNames`.
- `navigator.language` / `navigator.languages`.
- The `Accept-Language` header on every request.

Region is orthogonal to the TLS profile, so "a US Chrome user appearing from Tokyo" is one click.

### Resolution

Eight presets across 1080p/1440p/4K and laptop desktop classes, MacBook Air/Pro logical resolutions, iPhone 390x844, and Pixel-class 412x915. Drives `screen.{width,height,availWidth,availHeight}`, `colorDepth`, `pixelDepth`, `devicePixelRatio`, and `screen.orientation`. The options page warns if you pair a mobile profile with a desktop resolution.

### WebRTC IP leak filter

Three modes (active when the Tier 3 "WebRTC IP leak" phantom is on):

- `off`: no filtering; sites can read your LAN IP via ICE host candidates.
- `mdns` (default): drops ICE candidates pointing at RFC1918, CGNAT (100.64.0.0/10), link-local, ULA, and loopback; keeps mDNS host candidates (already anonymized by Chrome) and public srflx/relay candidates. Compatible with virtually all WebRTC apps.
- `relay`: forces `iceTransportPolicy: 'relay'`, so the browser only gathers TURN-relayed candidates. Breaks peer-to-peer apps without a TURN server.

The filter rewrites `localDescription.sdp`, scrubs SDP `raddr` leakage, and intercepts both `addEventListener('icecandidate', ...)` and `pc.onicecandidate = ...`.

### Custom User-Agent override

You can override the UA per profile. If your custom UA does not match the profile's canonical UA, the options page warns you: the JA3 will look like the profile while the User-Agent says something else, which is itself an anti-bot signal. Use it deliberately.

### Canvas + audio double-noise (experimental, off by default)

Adds a second least-significant-bit perturbation layer on top of Brave's farbling for `HTMLCanvasElement.toDataURL`/`toBlob`, `CanvasRenderingContext2D.getImageData`, `WebGL{,2}RenderingContext.readPixels`, `AudioBuffer.getChannelData`, and the `AnalyserNode` frequency/time-domain getters. The seed is per-session: the same page gets stable noise within a session but a different fingerprint across sessions. Can break photo editors and some accessibility tools.

### Bridge self-check

After every rule update, `background.js` sends a HEAD request to `https://phantom-shield-bridge.test/probe`. The addon recognizes that sentinel hostname and answers with a synthetic 200 carrying `X-Phantom-Profile` and `X-Phantom-Bridge-Version`. The popup shows a colored dot: green (reachable, profile matches), yellow (reachable but the requested profile fell back to chrome146), red (unreachable). The options page shows the last error with a hint at common causes.

---

## Python client (terminal / OSINT)

```python
from phantom_shield import Persona, Session

alice = Persona.load("alice")
with Session(alice, auto_rotate=True) as s:
    r = s.get("https://api.example.com/...")
    if s.last_signals:  # a detector fired (Cloudflare, Akamai, PerimeterX, ...)
        print("blocked:", [sig.detector for sig in s.last_signals])
```

```sh
phantom get  https://target.com/api --persona alice
phantom post https://target.com/api --persona alice --json '{"q":"x"}'
phantom rotate alice                 # advance the upstream pool, keep cookies
phantom reset  alice                 # wipe cookies + reset rotation
phantom log    alice --tail 20       # recent requests from the JSONL log
phantom personas new bob --profile firefox147 --region de --tor --doh --rate 30
phantom profiles list                # browse the 20 TLS profiles
```

A persona file (`~/.phantom/personas/<name>.yaml`) declares everything that rotates together. See [`personas/example.yaml`](personas/example.yaml) and [`personas/tor.yaml`](personas/tor.yaml) for documented templates.

### What you get over raw `curl_cffi`

| Concern | Raw curl_cffi | phantom_shield |
|---|---|---|
| TLS fingerprint | `impersonate="chrome146"` | Declared in the persona |
| GeoIP evasion | Manage proxies yourself | Persona upstream pool + rotation |
| Header coherence | Set UA/Accept-Language/Sec-CH-UA by hand | Derived from profile + region |
| DNS logging | OS resolver logs queries | DoH option, cached locally |
| Cookies | One global jar | Per-persona disk-backed jar |
| Rate limiting | None | Token bucket per persona |
| Timing fingerprint | As fast as Python runs | Uniform-random jitter window |
| Block detection | Manual inspection | Cloudflare / Akamai / PerimeterX / reCAPTCHA / hCaptcha / 429 / generic-403 |
| Identity rotation/reset | Manual | `phantom rotate` / `phantom reset` |
| Audit trail | None | Per-persona JSONL log |

**Out of scope:** sourcing residential proxies (the library consumes SOCKS5/HTTP URLs; procurement is separate), solving CAPTCHAs (detection is built in, solving is your call), and browser-grade JS execution (use Playwright with curl_cffi-impersonated TLS for targets that need it).

---

## Command reference

```sh
# Phantom Browser launcher
./scripts/phantom-browser.sh [--print-cmd] [--port N] [--brave PATH]
scripts\phantom-browser.cmd            # Windows double-click wrapper

# Bridge install / uninstall
./scripts/install.sh   [--check|--port N|--no-ca|--no-service|--verbose]
./scripts/uninstall.sh [--remove-ca] [--purge]     # --purge removes the whole data dir
.\scripts\install.ps1  [-Check|-Port N|-NoCa|-NoService]
.\scripts\uninstall.ps1 [-RemoveCa] [-Purge]

# npm scripts
npm run phantom            # launch the Phantom Browser
npm run install:bridge     # = ./scripts/install.sh
npm test                   # JS unit tests (node:test + JSDOM)
npm run test:py            # Python unit tests (pytest)
npm run test:sh            # installer shell harness
npm run test:launcher      # launcher shell harness
npm run test:all           # all of the above
npm run check              # verify every TLS profile against the installed curl_cffi
npm run generate-profiles-json   # rebuild phantom_shield/profiles.json from profiles.js
```

`install.sh --check` exit codes: `0` OK, `10` needs install, `11` service down, `12` CA not trusted, `13` port conflict.

---

## Testing

```sh
npm install
npm run test:all
```

- **JS (59 tests, node:test + JSDOM):** pure helpers (`tzOffsetMinutes` with NY/London/Tokyo DST transitions, `isPrivateAddress` across RFC1918/CGNAT/link-local/IPv6, `extractAddress`/`filterSdp` WebRTC parsing, `acceptLanguage` q-values), the profile/region/resolution data tables, the bridge-setup proxy + detection logic, and the options-page OS detection.
- **Python (83 tests, pytest):** catalogue loader, persona YAML round-trip and header derivation, upstream rotation strategies, cookie persistence, DoH resolver (mocked network), token-bucket math, jitter bounds, every block detector, the JSONL logger, and the CLI parser.
- **Shell harnesses:** `tests/install/` (installer flags, idempotency, shellcheck) and `tests/launcher/` (command construction, port rollover, no-orphan teardown, single-instance lock, isolated-NSS trust).

The phantom installs themselves cannot be unit-tested headlessly (they need a real Brave). [`tests/manual-checks.md`](tests/manual-checks.md) is the smoke-test checklist, run against creepjs and amiunique.

---

## Project layout

```
# Browser extension
manifest.json              MV3 manifest (v0.7.0)
background.js              service worker: DNR rules, state resolution, bridge self-check, setup messages
bridge-setup.js            proxy config + setup-state detection (loaded by background.js)
inject.js                  MAIN-world content script: all 40 phantoms register here
isolated.js                ISOLATED-world content script: state bridge
lib.js                     pure helpers shared between extension runtime and Node tests
font-presets.js            per-platform baseline font lists
profiles.js                TLS profile + region + resolution + WebRTC mode catalogues
popup.html / popup.js      toolbar popup UI
options.html / options.js  full options page + bridge-setup card

# Bridge artifacts (provisioned into the user data dir by the installer/launcher)
bridge/addon.py            mitmproxy addon: re-issues HTTPS via curl_cffi
bridge/requirements.txt    pinned mitmproxy + curl_cffi
bridge/systemd/ , launchd/ service templates

# Python client
phantom_shield/            catalog, persona, session, upstream, cookies, dns, rate_limit,
                           jitter, detectors, logger, cli (+ profiles.json)
personas/                  documented example persona files
pyproject.toml             Python build config

# Scripts
scripts/install.sh|.ps1    bridge installer (service + CA)
scripts/uninstall.sh|.ps1  bridge uninstaller
scripts/phantom-browser.*  Phantom Browser launcher (sh / ps1 / cmd)
scripts/check-profiles.mjs , generate-profiles-json.mjs

# Shared
tests/                     node:test + JSDOM, pytest, and shell harnesses
docs/superpowers/          specs and implementation plans
```

---

## Security and limitations

- **The mitmproxy CA is powerful.** Installing it system-wide lets that key decrypt any HTTPS on the machine. The installer makes consent explicit and lets you skip it (`--no-ca`); the launcher scopes the CA to an isolated profile on Linux. The CA is generated locally and never leaves the machine. On a high-risk device, prefer the launcher's isolated trust over system-wide install.
- **TLS impersonation needs the bridge.** Without mitmproxy set as Brave's proxy and the CA trusted, the bridge does nothing; the JS phantoms still work.
- **Some vectors need engine changes the extension cannot make:** WebGL renderer variation beyond Brave's farbling, font detection via CSS `local()` measurement, and side channels that do not pass through a JS API.
- **Profiles are static curl_cffi presets** and lag real-browser releases by weeks to months. A site checking a JA3 newer than the profile will see a mismatch.
- **Mismatched custom UA is a fingerprint.** The override is permissive on purpose; the options page warns when it diverges from the profile.
- **The extension is unpacked-only** (no Web Store listing). `node_modules/`, `tests/`, `docs/`, `scripts/`, and the Python files are dev-time only and can be omitted when shipping the extension.

---

## Roadmap

- **Firefox port.** Shares the bridge and most phantoms; needs the MAIN-world script-injection workaround and Gecko-specific leak phantoms (`navigator.buildID`, `oscpu`).
- **Per-port extension wiring.** The launcher already owns the port; surfacing a non-default port through to the extension (an `X-Phantom-Port` probe header) is planned so custom-port installs need no manual proxy step.
- **macOS launcher.** Same model as Linux/Windows, using the Keychain.
- See [`docs/superpowers/`](docs/superpowers/) for the design specs and implementation plans behind the hardening pass, the plug-n-play installer, and the Phantom Browser launcher.
