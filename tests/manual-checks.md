# Manual verification checklist

Automated tests (`npm test`, `npm run check`) only cover pure helpers and data tables. The phantoms themselves and the bridge self-check require a real browser + running mitmproxy. Use this checklist after loading the extension into Brave.

## Setup

1. `brave://extensions` → Developer mode → Load unpacked → `/opt/phantom-shield`
2. Ensure mitmproxy is running with the updated `/opt/tls-mitm/addon.py` (sentinel host handler was added - **restart mitmproxy if you haven't yet; the probe host changed from `.invalid` → `.test` in v0.7 and the version-bump won't take effect until restart**)
3. mitmproxy must be configured as Brave's HTTP/HTTPS proxy (system proxy or via `--proxy-server=…` flag), and its CA must be installed in the OS trust store. Without this, the bridge self-check will show red ("unreachable").

## 1. Tier 3 coherence - Chrome on Windows profile

Profile: `chrome146`. Region: `us-east`. Resolution: `desktop-1080p`. Visit https://abrahamjuliot.github.io/creepjs/.

| Field | Expected |
|---|---|
| `navigator.userAgent` | Chrome 146 Windows UA |
| `navigator.language` | `en-US` |
| `navigator.languages` | `["en-US","en"]` |
| `Intl.DateTimeFormat().resolvedOptions().timeZone` | `America/New_York` |
| `new Date().getTimezoneOffset()` | 240 (summer) or 300 (winter) |
| `screen.width × screen.height` | `1920 × 1080` |
| `screen.colorDepth` | 24 |
| `window.devicePixelRatio` | 1 |
| `navigator.hardwareConcurrency` | 8 |
| `navigator.deviceMemory` | 8 |
| `navigator.maxTouchPoints` | 0 |
| `navigator.webdriver` | `false` |
| `navigator.vendor` | `Google Inc.` |
| `navigator.productSub` | `20030107` |
| WebRTC private IPs (connectivity section) | none visible |
| Font list | matches Windows baseline (~60 entries) |

Record results below with date.

## 2. Tier 3 coherence - Safari iOS

Profile: `safari260_ios`. Region: `jp`. Resolution: `iphone-390`.

| Field | Expected |
|---|---|
| UA | Safari iOS 26 |
| `navigator.platform` | `iPhone` |
| `screen.width × screen.height` | `390 × 844` |
| `screen.orientation.type` | `portrait-primary` |
| `Intl.DateTimeFormat().resolvedOptions().timeZone` | `Asia/Tokyo` |
| `navigator.maxTouchPoints` | 5 |
| `navigator.vendor` | `Apple Computer, Inc.` |
| `Accept-Language` header (Network panel) | `ja,en-US;q=0.9,en;q=0.8` |

## 3. Double-noise determinism

1. Enable `double-noise` in popup → reload tab.
2. Open creepjs, note the canvas hash.
3. Reload - hash should stay stable (same session = same seed).
4. Clear extension storage (devtools → Application → Extensions → clear storage). Reload extension. Visit creepjs again. Hash should now differ (new seed).

## 4. Bridge failure mode

1. Stop mitmproxy.
2. Options page → "Re-check now". Card turns red within 5s.
3. Popup badge: red dot, tooltip shows error.
4. Restart mitmproxy. Re-check. Card + dot turn green within 5s.

## Recorded results

### YYYY-MM-DD - checks 1 and 2

(record observations here)

### YYYY-MM-DD - check 3 (double-noise)

(record observations here)

### YYYY-MM-DD - check 4 (bridge failure)

(record observations here)

## Plug-n-play setup (v0.7.0)

### Fresh Linux VM (Ubuntu 22.04 + Brave)

1. `git clone ... && cd phantom-shield-v2`
2. `./scripts/install.sh --check; echo $?` -> expect `10` (needs install)
3. `./scripts/install.sh` -> enter sudo password when prompted, smoke test passes
4. `./scripts/install.sh --check; echo $?` -> expect `0`
5. Load extension into Brave, open options, click "Apply browser proxy"
6. Setup card collapses, the existing bridge dot turns green

### Idempotency

7. `./scripts/install.sh` (second run) -> every ensure_* says "already ...", exit 0
8. `systemctl --user stop phantom-shield-bridge.service`
9. `./scripts/install.sh --check; echo $?` -> expect `11` (service down)
10. `./scripts/install.sh` -> restarts the service, exit 0

### Uninstall

11. `./scripts/uninstall.sh --remove-ca`
12. `./scripts/install.sh --check; echo $?` -> expect `10`
13. Extension setup card reappears with all-red steps

### macOS

Repeat the Linux flow on a fresh macOS VM. Sudo prompt arrives at the Keychain step.

### Windows

Repeat in an elevated PowerShell. UAC prompts at the certutil step.

## Phantom Browser launcher (v0.7.0)

### Linux

1. `./scripts/phantom-browser.sh --print-cmd` -> prints a Brave command line with
   `--user-data-dir`, `--load-extension`, `--proxy-server=127.0.0.1:<port>`, `HOME=`.
2. `./scripts/phantom-browser.sh` -> isolated Brave opens, extension loaded,
   bridge dot green.
3. Confirm isolation: `certutil -d sql:$HOME/.local/share/phantom-shield/home/.pki/nssdb -L`
   lists `phantom-shield`. On a clean machine, the real `~/.pki/nssdb` does NOT.
4. Visit a JA3/TLS-fingerprint test page -> shows the impersonated profile, not Brave's.
5. Close the window -> `ss -ltn | grep <port>` shows nothing (bridge stopped).
6. Re-launch while one is open -> "Phantom is already running".

### Windows

1. Double-click `scripts\phantom-browser.cmd` -> first run adds the CA to your
   user `Root` store (Import-Certificate into CurrentUser\Root, no elevation) and
   opens the isolated Brave. Windows may show a one-time "install certificate?"
   confirmation.
2. Close the window -> Task Manager shows no leftover `mitmdump.exe`.

## Brave engine masking (brave-mask)

With a desktop Chrome profile active in Brave, open DevTools console on any page:

1. `navigator.brave` -> `undefined`; `'brave' in navigator` -> `false`.
2. `'browsingTopics' in document` -> `true`; `await document.browsingTopics()` -> `[]`;
   `document.browsingTopics.toString()` -> `function browsingTopics() { [native code] }`.
3. Switch to a Firefox profile and reload: `'browsingTopics' in document` -> `false`
   (Firefox has no Topics API), while `navigator.brave` stays `undefined`.
4. Disable "Brave engine signature" in the options page and reload: `navigator.brave`
   is back.
5. Re-test the previously failing Cloudflare managed-challenge page. Pass rate should
   improve; a full pass is not guaranteed (PAT, behavioral, and farbling signals remain).
