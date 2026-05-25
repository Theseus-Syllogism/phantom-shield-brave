// ISOLATED world, document_start.
// Bridge per-user toggles + master + UA override + region/resolution/caps from
// chrome.storage to MAIN world via DOM attribute.
const ATTR = 'data-phantom-shield';
const KEYS = [
  'cfg', 'enabled',
  'activeUA', 'activeProfile', 'activeBrands', 'activePlatform', 'activeMobile',
  'activeRegion', 'activeTimezone', 'activeLocale', 'activeLanguages',
  'activeResolution', 'activeCaps', 'webrtcLeakMode', 'doubleNoiseSeed',
];

function push(state) {
  const enabled = state.enabled !== false;
  const payload = enabled
    ? {
        ...state.cfg || {},
        __ua: state.activeUA || null,
        __profile: state.activeProfile || null,
        __brands: state.activeBrands || null,
        __platform: state.activePlatform || null,
        __mobile: state.activeMobile || null,
        __region: state.activeRegion || null,
        __tz: state.activeTimezone || null,
        __locale: state.activeLocale || null,
        __languages: state.activeLanguages || null,
        __resolution: state.activeResolution || null,
        __caps: state.activeCaps || null,
        __webrtcMode: state.webrtcLeakMode || 'mdns',
        __noiseSeed: state.doubleNoiseSeed || null,
      }
    : { __off: true };
  try {
    document.documentElement.setAttribute(ATTR, JSON.stringify(payload));
  } catch (_) {}
}

chrome.storage.local.get(KEYS).then(push);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!KEYS.some((k) => k in changes)) return;
  chrome.storage.local.get(KEYS).then(push);
});
