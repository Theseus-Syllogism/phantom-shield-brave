importScripts('lib.js', 'profiles.js', 'bridge-setup.js');
const { acceptLanguage, buildClientHintsRequestHeaders } = self.PhantomShieldLib;

const PHANTOM_DEFAULTS = {
  // Existing
  gamepad: true, bluetooth: true, keyboard: true, storage: true, locks: true,
  netinfo: true, uadata: true, memory: true, webgpu: true,
  perfmem: true, hid: true, serial: true, usb: true, installedapps: true,
  mediacaps: true, rtccaps: true,
  screenextended: true, vkeyboard: true, wakelock: true, idle: true,
  pressure: true, sensors: true, matchmedia: true,
  // Tier 3 - coherence
  'intl-locale': true, 'intl-tz': true, 'intl-collator': true,
  'screen-dims': true, 'screen-color': true, 'dpr': true, 'screen-orient': true,
  'nav-hwconc': true, 'nav-devmem': true, 'nav-touch': true,
  'nav-pdf': true, 'nav-webdriver': true, 'nav-vendor': true, 'nav-appver': true,
  'webrtc-leak': true,
  'brave-mask': true,
  'fonts': true,
  'double-noise': false,
};

const RULE_IDS = {
  impersonate: 1,
  uaRemove: 2,
  uaSet: 3,
  chRemove: 4,
  acceptLang: 5,
};

function resolveProfileState(state) {
  const profile = findProfile(state.profile || DEFAULT_PROFILE);
  const effectiveUA = (state.uaOverride && state.uaOverride.trim()) || profile.ua;
  const regionId = state.region || regionFromProfile(profile);
  const region = findRegion(regionId);
  const resolutionId = state.resolution || resolutionFromProfile(profile.platform);
  const resolution = findResolution(resolutionId);
  const caps = { ...profile.caps, webdriver: false };
  const acceptLang = acceptLanguage(region.languages);

  return { profile, effectiveUA, region, resolution, caps, acceptLang };
}

async function applyProxyRules(state) {
  const s = resolveProfileState(state);

  const condition = {
    urlFilter: '|https:',
    resourceTypes: [
      'main_frame', 'sub_frame', 'stylesheet', 'script', 'image',
      'font', 'object', 'xmlhttprequest', 'ping', 'csp_report',
      'media', 'websocket', 'webtransport', 'webbundle', 'other',
    ],
  };

  const addRules = [
    {
      id: RULE_IDS.impersonate, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'X-TLS-Impersonate', operation: 'set', value: s.profile.value },
      ]},
      condition,
    },
    {
      id: RULE_IDS.uaSet, priority: 2,
      action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'User-Agent', operation: 'set', value: s.effectiveUA },
      ]},
      condition,
    },
    {
      // Coherent client hints: set the low-entropy trio from the active profile
      // (Chromium family) and strip the high-entropy hints; remove all for
      // non-Chromium profiles. Prevents the UA-vs-Sec-CH-UA-Platform mismatch.
      id: RULE_IDS.chRemove, priority: 3,
      action: { type: 'modifyHeaders',
        requestHeaders: buildClientHintsRequestHeaders(s.profile) },
      condition,
    },
    {
      id: RULE_IDS.acceptLang, priority: 4,
      action: { type: 'modifyHeaders', requestHeaders: [
        { header: 'Accept-Language', operation: 'set', value: s.acceptLang },
      ]},
      condition,
    },
  ];

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: Object.values(RULE_IDS),
    addRules,
  });

  await chrome.storage.local.set({
    activeUA: s.effectiveUA,
    activeProfile: s.profile.value,
    activeBrands: s.profile.brands,
    activePlatform: s.profile.platform,
    activeMobile: s.profile.mobile,
    activeRegion: s.region.id,
    activeTimezone: s.region.tz,
    activeLocale: s.region.locale,
    activeLanguages: s.region.languages,
    activeResolution: s.resolution,
    activeCaps: s.caps,
    activeAcceptLang: s.acceptLang,
  });
}

async function clearProxyRules() {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: Object.values(RULE_IDS),
    addRules: [],
  });
  await chrome.storage.local.remove([
    'activeUA','activeProfile','activeBrands','activePlatform','activeMobile',
    'activeRegion','activeTimezone','activeLocale','activeLanguages',
    'activeResolution','activeCaps','activeAcceptLang',
  ]);
}

async function ensureNoiseSeed() {
  const { doubleNoiseSeed } = await chrome.storage.local.get('doubleNoiseSeed');
  if (doubleNoiseSeed && typeof doubleNoiseSeed === 'string' && doubleNoiseSeed.length === 88) return;
  const buf = crypto.getRandomValues(new Uint8Array(64));
  const b64 = btoa(String.fromCharCode(...buf));
  await chrome.storage.local.set({ doubleNoiseSeed: b64 });
}

// Sentinel host the mitmproxy addon short-circuits. Uses RFC 2606 .test TLD -
// Chrome routes it through the configured proxy without short-circuiting (unlike
// .invalid, which Chrome's HostResolver returns NXDOMAIN for locally).
const BRIDGE_PROBE_URL = 'https://phantom-shield-bridge.test/probe';

async function bridgeSelfCheck() {
  const s = await chrome.storage.local.get(['profile']);
  const profile = s.profile || DEFAULT_PROFILE;
  try {
    const r = await fetch(BRIDGE_PROBE_URL, { method: 'HEAD', cache: 'no-store', credentials: 'omit' });
    const got = r.headers.get('X-Phantom-Profile') || '';
    const supported = r.headers.get('X-Phantom-Supported') === '1';
    const ver = r.headers.get('X-Phantom-Bridge-Version') || '';

    // Got a response but no phantom headers → mitmproxy is reachable but the
    // sentinel-host addon isn't loaded (likely: addon.py was updated but
    // mitmproxy wasn't restarted).
    if (!ver) {
      const status = {
        ok: false,
        error: `Bridge responded ${r.status} but no X-Phantom-Bridge-Version header - restart mitmproxy to load the latest addon.py.`,
        checkedAt: Date.now(),
      };
      await chrome.storage.local.set({ bridgeStatus: status });
      return status;
    }

    const status = {
      ok: true,
      supported: supported && got === profile,
      activeProfile: got,
      requestedProfile: profile,
      version: ver,
      checkedAt: Date.now(),
    };
    await chrome.storage.local.set({ bridgeStatus: status });
    return status;
  } catch (e) {
    let hint = '';
    const msg = String(e);
    if (/Failed to fetch|NetworkError|ERR_/i.test(msg)) {
      hint = ' - likely: mitmproxy not running, not set as browser proxy, or its CA not installed in the OS trust store.';
    }
    const status = { ok: false, error: msg + hint, checkedAt: Date.now() };
    await chrome.storage.local.set({ bridgeStatus: status });
    return status;
  }
}

async function refresh() {
  const s = await chrome.storage.local.get([
    'cfg','enabled','profile','uaOverride','region','resolution',
  ]);
  const enabled = s.enabled === undefined ? true : s.enabled;
  if (enabled && s.profile) {
    await applyProxyRules(s);
    bridgeSelfCheck();          // fire-and-forget
  } else {
    await clearProxyRules();
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const s = await chrome.storage.local.get(['cfg','enabled','profile','uaOverride','region','resolution','webrtcLeakMode']);
  const merged = { ...PHANTOM_DEFAULTS, ...(s.cfg || {}) };
  const enabled = s.enabled === undefined ? true : s.enabled;
  const profileId = s.profile || DEFAULT_PROFILE;
  const profile = findProfile(profileId);
  const uaOverride = s.uaOverride || '';
  const region = s.region || regionFromProfile(profile);
  const resolution = s.resolution || resolutionFromProfile(profile.platform);
  const webrtcLeakMode = s.webrtcLeakMode || 'mdns';
  await chrome.storage.local.set({ cfg: merged, enabled, profile: profileId, uaOverride, region, resolution, webrtcLeakMode });
  await ensureNoiseSeed();
  await refresh();
});

chrome.runtime.onStartup?.addListener(async () => {
  await ensureNoiseSeed();
  await refresh();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  for (const k of ['enabled','profile','uaOverride','region','resolution']) {
    if (k in changes) { refresh(); return; }
  }
});

chrome.proxy?.onProxyError?.addListener((details) => {
  chrome.storage.local.set({
    lastProxyError: { ...details, at: Date.now() },
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'bridge:recheck') {
    bridgeSelfCheck().then(sendResponse);
    return true;
  }
  if (msg?.type === 'setup:detect') {
    self.PhantomShieldSetup.detectSetupState().then(sendResponse);
    return true;
  }
  if (msg?.type === 'setup:apply-proxy') {
    self.PhantomShieldSetup.applyBrowserProxy(msg.port).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'setup:clear-proxy') {
    self.PhantomShieldSetup.clearBrowserProxy().then(() => sendResponse({ ok: true }));
    return true;
  }
});
