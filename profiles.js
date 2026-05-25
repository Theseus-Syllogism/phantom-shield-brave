// Curated TLS-profile catalogue. The `value` is a curl_cffi BrowserType.value
// understood by the mitmproxy addon at /opt/tls-mitm/addon.py.
// `npm run check` enforces that every `value` here is supported by curl_cffi.
//
// Each profile carries:
//   - `value`        - curl_cffi BrowserType identifier (drives the JA3/JA4
//                       impersonation done by the mitmproxy bridge).
//   - `label`        - short title shown in dropdowns.
//   - `ua`           - exact User-Agent header value the extension sends.
//   - `platform`     - Windows / macOS / Linux / Android / iOS (drives the
//                       resolution and caps defaults).
//   - `mobile`       - used by Sec-CH-UA-Mobile and by the resolution picker
//                       to decide which orientation/touch profile to default.
//   - `brands`       - Sec-CH-UA brand list (Chromium-family only; empty for
//                       Firefox / Safari / Tor).
//   - `caps`         - { hwConcurrency, deviceMemory, maxTouchPoints, vendor,
//                       vendorSub, productSub, pdfViewerEnabled } that the
//                       Tier 3 navigator.* phantoms read.
//   - `description`  - 1-2 sentences explaining when to use this profile.

const CHROME_DESKTOP_CAPS = { hwConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, vendor: 'Google Inc.', vendorSub: '', productSub: '20030107', pdfViewerEnabled: true };
const CHROME_MOBILE_CAPS  = { hwConcurrency: 8, deviceMemory: 4, maxTouchPoints: 5, vendor: 'Google Inc.', vendorSub: '', productSub: '20030107', pdfViewerEnabled: false };
const EDGE_DESKTOP_CAPS   = { hwConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, vendor: 'Google Inc.', vendorSub: '', productSub: '20030107', pdfViewerEnabled: true };
const FIREFOX_DESKTOP_CAPS= { hwConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, vendor: '',            vendorSub: '', productSub: '20100101', pdfViewerEnabled: true };
const SAFARI_MAC_CAPS     = { hwConcurrency: 8, deviceMemory: 8, maxTouchPoints: 0, vendor: 'Apple Computer, Inc.', vendorSub: '', productSub: '20030107', pdfViewerEnabled: true };
const SAFARI_IOS_CAPS     = { hwConcurrency: 4, deviceMemory: 4, maxTouchPoints: 5, vendor: 'Apple Computer, Inc.', vendorSub: '', productSub: '20030107', pdfViewerEnabled: false };
const TOR_CAPS            = { hwConcurrency: 2, deviceMemory: 2, maxTouchPoints: 0, vendor: '',            vendorSub: '', productSub: '20100101', pdfViewerEnabled: false };

// Brand-list helpers - match Chrome's three-entry pattern (Chromium, branded,
// GREASE). Versions are baked in; GREASE entry changes infrequently across major
// versions so we accept a small staleness rather than maintaining a lookup.
const chromiumBrands = (v) => [
  { brand: 'Chromium', version: String(v) },
  { brand: 'Google Chrome', version: String(v) },
  { brand: 'Not_A Brand', version: '24' },
];
const edgeBrands = (v) => [
  { brand: 'Microsoft Edge', version: String(v) },
  { brand: 'Chromium', version: String(v) },
  { brand: 'Not A;Brand', version: '99' },
];

const PHANTOM_PROFILES = [
  // ── Chrome - Windows desktop ──────────────────────────────────────────────
  {
    value: 'chrome146', label: 'Chrome 146 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    platform: 'Windows', mobile: false, brands: chromiumBrands(146), caps: CHROME_DESKTOP_CAPS,
    description: 'Latest stable Chrome on Windows 11. Most common desktop signature on the web - safest default for general browsing and the strongest blend for anti-bot evasion.',
  },
  {
    value: 'chrome145', label: 'Chrome 145 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    platform: 'Windows', mobile: false, brands: chromiumBrands(145), caps: CHROME_DESKTOP_CAPS,
    description: 'Chrome 145 on Windows. Use if a site refuses the very latest version; blends with users one update cycle behind.',
  },
  {
    value: 'chrome142', label: 'Chrome 142 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
    platform: 'Windows', mobile: false, brands: chromiumBrands(142), caps: CHROME_DESKTOP_CAPS,
    description: 'Mid-cycle stable Chrome. Useful population of users on slower update channels (enterprise, managed deployments).',
  },
  {
    value: 'chrome136', label: 'Chrome 136 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    platform: 'Windows', mobile: false, brands: chromiumBrands(136), caps: CHROME_DESKTOP_CAPS,
    description: 'Older Chrome 136 on Windows. Use when targeting sites that flag the newest versions or for testing site behavior on slightly stale builds.',
  },
  {
    value: 'chrome131', label: 'Chrome 131 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    platform: 'Windows', mobile: false, brands: chromiumBrands(131), caps: CHROME_DESKTOP_CAPS,
    description: 'Chrome 131 on Windows. Desktop counterpart to the Android-131 profile - useful for cross-device coherence testing.',
  },
  {
    value: 'chrome120', label: 'Chrome 120 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    platform: 'Windows', mobile: false, brands: chromiumBrands(120), caps: CHROME_DESKTOP_CAPS,
    description: 'Year-old stable Chrome. Sometimes preferred when newer JA3 fingerprints get aggressively challenged.',
  },

  // ── Chrome - Android mobile ───────────────────────────────────────────────
  {
    value: 'chrome131_android', label: 'Chrome 131 - Android',
    ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
    platform: 'Android', mobile: true, brands: chromiumBrands(131), caps: CHROME_MOBILE_CAPS,
    description: 'Chrome on Android 10. Mobile signature - sites serve mobile layouts, touch APIs report 5 contact points, and Sec-CH-UA-Mobile is ?1.',
  },
  {
    value: 'chrome99_android', label: 'Chrome 99 - Android',
    ua: 'Mozilla/5.0 (Linux; Android 12; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Mobile Safari/537.36',
    platform: 'Android', mobile: true, brands: chromiumBrands(99), caps: CHROME_MOBILE_CAPS,
    description: 'Older Chrome 99 on a Galaxy S22. Blends with users on outdated mobile builds or carrier-managed devices.',
  },

  // ── Edge - Windows ────────────────────────────────────────────────────────
  {
    value: 'edge101', label: 'Edge 101 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/101.0.4951.67 Safari/537.36 Edg/101.0.1210.53',
    platform: 'Windows', mobile: false, brands: edgeBrands(101), caps: EDGE_DESKTOP_CAPS,
    description: 'Microsoft Edge 101. UA-CH advertises "Microsoft Edge" brand; useful for sites that require Edge specifically (Microsoft 365, Teams).',
  },
  {
    value: 'edge99', label: 'Edge 99 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.51 Safari/537.36 Edg/99.0.1150.39',
    platform: 'Windows', mobile: false, brands: edgeBrands(99), caps: EDGE_DESKTOP_CAPS,
    description: 'Older Edge 99. Same Chromium base as Chrome 99 but with the Edge brand list; useful for the same niche enterprise-Edge audience.',
  },

  // ── Firefox - Windows ─────────────────────────────────────────────────────
  {
    value: 'firefox147', label: 'Firefox 147 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
    platform: 'Windows', mobile: false, brands: [], caps: FIREFOX_DESKTOP_CAPS,
    description: 'Latest Firefox on Windows. Gecko TLS fingerprint differs sharply from Chromium - use when Chrome-family fingerprints get challenged.',
  },
  {
    value: 'firefox144', label: 'Firefox 144 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0',
    platform: 'Windows', mobile: false, brands: [], caps: FIREFOX_DESKTOP_CAPS,
    description: 'Firefox 144 on Windows. ESR-adjacent; common with corporate Firefox users.',
  },
  {
    value: 'firefox135', label: 'Firefox 135 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) Gecko/20100101 Firefox/135.0',
    platform: 'Windows', mobile: false, brands: [], caps: FIREFOX_DESKTOP_CAPS,
    description: 'Mid-cycle Firefox 135. Useful for blending with the long tail of Firefox users not on auto-update.',
  },
  {
    value: 'firefox133', label: 'Firefox 133 - Windows',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    platform: 'Windows', mobile: false, brands: [], caps: FIREFOX_DESKTOP_CAPS,
    description: 'Older Firefox 133. Slightly distinct ALPN ordering from 144+; useful as a JA3 variant.',
  },

  // ── Safari - macOS ────────────────────────────────────────────────────────
  {
    value: 'safari260', label: 'Safari 26 - macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    platform: 'macOS', mobile: false, brands: [], caps: SAFARI_MAC_CAPS,
    description: 'Latest Safari 26 on macOS. WebKit engine produces a distinctive JA3 - best choice when anti-bot specifically fingerprints Chromium signatures.',
  },
  {
    value: 'safari184', label: 'Safari 18.4 - macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15',
    platform: 'macOS', mobile: false, brands: [], caps: SAFARI_MAC_CAPS,
    description: 'Safari 18.4 on macOS. Slightly older WebKit - blends with users on macOS Sonoma not yet upgraded to 26.',
  },
  {
    value: 'safari180', label: 'Safari 18.0 - macOS',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    platform: 'macOS', mobile: false, brands: [], caps: SAFARI_MAC_CAPS,
    description: 'Safari 18.0 on macOS. The 18.0 .0 release sees a long tail of users that never auto-update.',
  },

  // ── Safari - iOS ──────────────────────────────────────────────────────────
  {
    value: 'safari260_ios', label: 'Safari 26 - iOS',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
    platform: 'iOS', mobile: true, brands: [], caps: SAFARI_IOS_CAPS,
    description: 'Latest Safari on iPhone. Mobile WebKit - strongest "real user" signal for anti-bot, since iOS Safari can\'t easily be automated.',
  },
  {
    value: 'safari184_ios', label: 'Safari 18.4 - iOS',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1',
    platform: 'iOS', mobile: true, brands: [], caps: SAFARI_IOS_CAPS,
    description: 'Safari 18.4 on iPhone. Same WebKit base as 18.4 macOS; pairs with users on slightly older iOS.',
  },

  // ── Tor ───────────────────────────────────────────────────────────────────
  {
    value: 'tor145', label: 'Tor Browser 14.5',
    ua: 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0',
    platform: 'Windows', mobile: false, brands: [], caps: TOR_CAPS,
    description: 'Tor Browser 14.5 (Firefox 128 ESR base). Blends with the Tor population. NOTE: This profile does not route traffic through the Tor network - it only impersonates Tor\'s TLS and UA signatures.',
  },
];

const DEFAULT_PROFILE = 'chrome146';

function findProfile(value) {
  return PHANTOM_PROFILES.find((p) => p.value === value) || PHANTOM_PROFILES[0];
}

const PHANTOM_REGIONS = [
  { id: 'us-east',   label: 'US East - New York',     locale: 'en-US', tz: 'America/New_York',    languages: ['en-US', 'en'],
    description: 'Eastern US business hours (UTC-5/-4). Default pairing for most US-targeted services and the largest single-region population.' },
  { id: 'us-west',   label: 'US West - Los Angeles',  locale: 'en-US', tz: 'America/Los_Angeles', languages: ['en-US', 'en'],
    description: 'Pacific time (UTC-8/-7). Common with tech-sector users and CDN edge POPs on the US west coast.' },
  { id: 'us-cent',   label: 'US Central - Chicago',   locale: 'en-US', tz: 'America/Chicago',     languages: ['en-US', 'en'],
    description: 'Central time (UTC-6/-5). Useful when Pacific or Eastern timestamps would look suspicious for known-Midwestern services.' },
  { id: 'uk',        label: 'UK - London',            locale: 'en-GB', tz: 'Europe/London',       languages: ['en-GB', 'en'],
    description: 'United Kingdom (UTC+0/+1). British English locale; Accept-Language prefers en-GB over en-US, affecting content negotiation on globalized sites.' },
  { id: 'de',        label: 'Germany - Berlin',       locale: 'de-DE', tz: 'Europe/Berlin',       languages: ['de-DE', 'de', 'en'],
    description: 'Germany (UTC+1/+2). Sends German Accept-Language and de-DE locale formats - sites serve EU content and German UI by default.' },
  { id: 'fr',        label: 'France - Paris',         locale: 'fr-FR', tz: 'Europe/Paris',        languages: ['fr-FR', 'fr', 'en'],
    description: 'France (UTC+1/+2). French Accept-Language with English fallback; useful for European content with French as the primary language.' },
  { id: 'jp',        label: 'Japan - Tokyo',          locale: 'ja-JP', tz: 'Asia/Tokyo',          languages: ['ja', 'en-US', 'en'],
    description: 'Japan (UTC+9, no DST). Japanese Accept-Language; sites with ja-JP localization serve Japanese UI and currency formatting.' },
  { id: 'kr',        label: 'Korea - Seoul',          locale: 'ko-KR', tz: 'Asia/Seoul',          languages: ['ko-KR', 'ko', 'en'],
    description: 'South Korea (UTC+9, no DST). Korean Accept-Language; common in tech-related East-Asian user pools.' },
  { id: 'br',        label: 'Brazil - São Paulo',     locale: 'pt-BR', tz: 'America/Sao_Paulo',   languages: ['pt-BR', 'pt', 'en'],
    description: 'Brazil (UTC-3, no DST since 2019). Brazilian Portuguese - largest Latin-American region.' },
  { id: 'in',        label: 'India - Kolkata',        locale: 'en-IN', tz: 'Asia/Kolkata',        languages: ['en-IN', 'en', 'hi'],
    description: 'India (UTC+5:30, no DST). English with Indian variant + Hindi fallback; the half-hour offset is a strong region signal.' },
  { id: 'au',        label: 'Australia - Sydney',     locale: 'en-AU', tz: 'Australia/Sydney',    languages: ['en-AU', 'en'],
    description: 'Sydney (UTC+10/+11, DST inverted from Northern hemisphere). Australian English; useful for APAC content.' },
  { id: 'ca',        label: 'Canada - Toronto',       locale: 'en-CA', tz: 'America/Toronto',     languages: ['en-CA', 'en', 'fr-CA'],
    description: 'Eastern Canada (UTC-5/-4). Canadian English with French-Canadian fallback in Accept-Language - distinctive vs. US-only en-US.' },
];

const DEFAULT_REGION = 'us-east';

function _res(id, label, w, h, dpr, mobile, description) {
  return {
    id, label, width: w, height: h,
    availWidth: w,
    availHeight: h - (mobile ? 80 : 40),
    colorDepth: 24, pixelDepth: 24,
    dpr, mobile,
    orientation: mobile ? 'portrait-primary' : 'landscape-primary',
    orientationAngle: 0,
    description,
  };
}

const PHANTOM_RESOLUTIONS = [
  _res('desktop-1080p',  '1080p (1920×1080)',     1920, 1080, 1,     false,
    'The most common desktop class. ~30% of all desktop users - blends with the largest population.'),
  _res('desktop-1440p',  '1440p (2560×1440)',     2560, 1440, 1,     false,
    'Higher-end 27" monitors common with gamers, developers, and creative professionals.'),
  _res('desktop-4k',     '4K (3840×2160)',        3840, 2160, 1.5,   false,
    '4K displays with DPR 1.5 - high-end hardware, smaller population but distinctive.'),
  _res('desktop-laptop', 'Laptop (1366×768)',     1366,  768, 1,     false,
    '1366×768 laptops - older or budget hardware. Useful for blending into business or education segments.'),
  _res('macos-1440',     'macOS Air (1440×900)',  1440,  900, 2,     false,
    'MacBook Air-class Retina display reporting 1440×900 logical resolution at DPR 2.'),
  _res('macos-1680',     'macOS Pro (1680×1050)', 1680, 1050, 2,     false,
    'MacBook Pro 16" reporting 1680×1050 logical resolution at DPR 2.'),
  _res('iphone-390',     'iPhone (390×844)',       390,  844, 3,     true,
    'iPhone 14/15/16 (non-Plus, non-Pro Max) viewport at DPR 3. Most common iPhone size.'),
  _res('android-412',    'Android (412×915)',      412,  915, 2.625, true,
    'Pixel-class Android viewport (412×915 at DPR 2.625). Representative of mid-range Android devices.'),
];

function findResolution(id) {
  return PHANTOM_RESOLUTIONS.find((r) => r.id === id) || PHANTOM_RESOLUTIONS[0];
}

function resolutionFromProfile(platform) {
  switch (platform) {
    case 'macOS':   return 'macos-1440';
    case 'iOS':     return 'iphone-390';
    case 'Android': return 'android-412';
    default:        return 'desktop-1080p';
  }
}

function findRegion(id) {
  return PHANTOM_REGIONS.find((r) => r.id === id) || PHANTOM_REGIONS[0];
}

function regionFromProfile(profile) {
  return DEFAULT_REGION;
}

const WEBRTC_MODES = [
  { id: 'off',   label: 'Off - no filtering',
    description: 'Pass all WebRTC traffic through unchanged. Your real local IP can leak to any site that creates an RTCPeerConnection.' },
  { id: 'mdns',  label: 'mDNS only (default)',
    description: 'Drop ICE candidates pointing at RFC1918 / CGNAT / link-local addresses. Keep mDNS host candidates (already anonymized by Chrome) and public srflx/relay candidates. Compatible with virtually all WebRTC apps.' },
  { id: 'relay', label: 'Relay-only (strictest)',
    description: 'Force iceTransportPolicy:"relay" on every RTCPeerConnection. The browser only gathers TURN-relayed candidates. BREAKS peer-to-peer apps (Zoom, Meet, Discord voice) when no TURN server is provided.' },
];

function findWebrtcMode(id) {
  return WEBRTC_MODES.find((m) => m.id === id) || WEBRTC_MODES[1];
}

// Make available to service worker (importScripts), popup, and options.
if (typeof self !== 'undefined') {
  self.PHANTOM_PROFILES = PHANTOM_PROFILES;
  self.DEFAULT_PROFILE = DEFAULT_PROFILE;
  self.findProfile = findProfile;
  self.PHANTOM_REGIONS = PHANTOM_REGIONS;
  self.DEFAULT_REGION = DEFAULT_REGION;
  self.findRegion = findRegion;
  self.regionFromProfile = regionFromProfile;
  self.PHANTOM_RESOLUTIONS = PHANTOM_RESOLUTIONS;
  self.findResolution = findResolution;
  self.resolutionFromProfile = resolutionFromProfile;
  self.WEBRTC_MODES = WEBRTC_MODES;
  self.findWebrtcMode = findWebrtcMode;
}
