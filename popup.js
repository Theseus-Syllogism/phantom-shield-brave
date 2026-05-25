const PHANTOMS = [
  { id: 'gamepad',        tier: 'core', name: 'Gamepad',                    surface: 'getGamepads' },
  { id: 'bluetooth',      tier: 'core', name: 'Bluetooth availability',     surface: 'bluetooth.getAvailability' },
  { id: 'keyboard',       tier: 'core', name: 'Keyboard layout',            surface: 'keyboard.getLayoutMap' },
  { id: 'storage',        tier: 'core', name: 'Storage estimate',           surface: 'storage.estimate' },
  { id: 'locks',          tier: 'core', name: 'Web Locks',                  surface: 'locks.query' },
  { id: 'netinfo',        tier: 'core', name: 'Network information',        surface: 'connection' },
  { id: 'uadata',         tier: 'core', name: 'UA-CH high-entropy',         surface: 'userAgentData' },
  { id: 'memory',         tier: 'core', name: 'Memory measurement',         surface: 'measureUserAgentSpecificMemory' },
  { id: 'webgpu',         tier: 'core', name: 'WebGPU adapter',             surface: 'GPUAdapter' },
  { id: 'perfmem',        tier: 't1',   name: 'JS heap size',               surface: 'performance.memory' },
  { id: 'hid',            tier: 't1',   name: 'WebHID',                     surface: 'hid.getDevices' },
  { id: 'serial',         tier: 't1',   name: 'WebSerial',                  surface: 'serial.getPorts' },
  { id: 'usb',            tier: 't1',   name: 'WebUSB',                     surface: 'usb.getDevices' },
  { id: 'installedapps',  tier: 't1',   name: 'Installed related apps',     surface: 'getInstalledRelatedApps' },
  { id: 'mediacaps',      tier: 't1',   name: 'Media HW decode',            surface: 'MediaCapabilities' },
  { id: 'rtccaps',        tier: 't1',   name: 'WebRTC codec capabilities',  surface: 'RTCRtp*.getCapabilities' },
  { id: 'screenextended', tier: 't2',   name: 'Multi-monitor flag',         surface: 'screen.isExtended' },
  { id: 'vkeyboard',      tier: 't2',   name: 'Virtual keyboard rect',      surface: 'VirtualKeyboard' },
  { id: 'wakelock',       tier: 't2',   name: 'Wake lock',                  surface: 'WakeLock.request' },
  { id: 'idle',           tier: 't2',   name: 'Idle detection',             surface: 'IdleDetector' },
  { id: 'pressure',       tier: 't2',   name: 'Compute pressure',           surface: 'PressureObserver' },
  { id: 'sensors',        tier: 't2',   name: 'Motion sensors',             surface: 'Sensor.start' },
  { id: 'matchmedia',     tier: 't2',   name: 'A11y media queries',         surface: 'matchMedia(a11y)' },
  { id: 'intl-locale',    tier: 't3',   name: 'Language',                    surface: 'navigator.language(s)' },
  { id: 'intl-tz',        tier: 't3',   name: 'Timezone',                    surface: 'Date / Intl.DateTimeFormat' },
  { id: 'intl-collator',  tier: 't3',   name: 'Intl locale coherence',       surface: 'Intl.{Collator,Number,…}' },
  { id: 'screen-dims',    tier: 't3',   name: 'Screen dimensions',           surface: 'Screen.w/h/avail*' },
  { id: 'screen-color',   tier: 't3',   name: 'Color depth',                 surface: 'Screen.colorDepth' },
  { id: 'dpr',            tier: 't3',   name: 'Device pixel ratio',          surface: 'devicePixelRatio' },
  { id: 'screen-orient',  tier: 't3',   name: 'Screen orientation',          surface: 'screen.orientation' },
  { id: 'nav-hwconc',     tier: 't3',   name: 'Hardware concurrency',        surface: 'navigator.hardwareConcurrency' },
  { id: 'nav-devmem',     tier: 't3',   name: 'Device memory',               surface: 'navigator.deviceMemory' },
  { id: 'nav-touch',      tier: 't3',   name: 'Touch points',                surface: 'navigator.maxTouchPoints' },
  { id: 'nav-pdf',        tier: 't3',   name: 'PDF viewer flag',             surface: 'navigator.pdfViewerEnabled' },
  { id: 'nav-webdriver',  tier: 't3',   name: 'WebDriver flag',              surface: 'navigator.webdriver' },
  { id: 'nav-vendor',     tier: 't3',   name: 'Vendor strings',              surface: 'navigator.vendor*' },
  { id: 'nav-appver',     tier: 't3',   name: 'appVersion',                  surface: 'navigator.appVersion' },
  { id: 'webrtc-leak',    tier: 't3',   name: 'WebRTC IP leak',              surface: 'RTCPeerConnection' },
  { id: 'fonts',          tier: 't3',   name: 'Font enumeration',            surface: 'document.fonts' },
  { id: 'double-noise',   tier: 't3',   name: 'Double-noise (experimental)', surface: 'canvas + audio' },
];

const TIER_TITLES = { core: 'Original', t1: 'Tier 1', t2: 'Tier 2', t3: 'Tier 3 - Coherence' };

const list = document.getElementById('list');
const countEl = document.getElementById('count');
const masterEl = document.getElementById('master');
const masterRow = document.getElementById('masterRow');
const masterHint = document.getElementById('masterHint');
const savedFlash = document.getElementById('saved');
let flashTimer;

function flash() {
  savedFlash.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => savedFlash.classList.remove('on'), 700);
}

function updateCount(cfg) {
  const total = PHANTOMS.length;
  const active = PHANTOMS.filter((p) => cfg[p.id] !== false).length;
  countEl.textContent = `${active} / ${total}`;
}

function updateMasterDisplay(enabled, cfg) {
  masterEl.checked = enabled;
  if (enabled) {
    const active = PHANTOMS.filter((p) => cfg[p.id] !== false).length;
    masterHint.textContent = `${active} phantom function${active === 1 ? '' : 's'} active`;
    masterRow.classList.remove('off');
    list.classList.remove('disabled');
  } else {
    masterHint.textContent = 'All overrides disabled';
    masterRow.classList.add('off');
    list.classList.add('disabled');
  }
}

function render(cfg) {
  list.innerHTML = '';
  let currentTier = null;
  for (const p of PHANTOMS) {
    if (p.tier !== currentTier) {
      currentTier = p.tier;
      const h = document.createElement('div');
      h.className = 'group-title';
      h.textContent = TIER_TITLES[currentTier];
      list.appendChild(h);
    }
    const row = document.createElement('label');
    row.className = 'row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = cfg[p.id] !== false;
    cb.addEventListener('change', async () => {
      const { cfg: cur = {}, enabled = true } = await chrome.storage.local.get(['cfg', 'enabled']);
      cur[p.id] = cb.checked;
      await chrome.storage.local.set({ cfg: cur });
      updateCount(cur);
      updateMasterDisplay(enabled, cur);
      flash();
    });
    const name = document.createElement('span');
    name.className = 'row-name';
    name.textContent = p.name;
    const surface = document.createElement('span');
    surface.className = 'row-surface';
    surface.textContent = p.surface;
    row.appendChild(cb);
    row.appendChild(name);
    row.appendChild(surface);
    list.appendChild(row);
  }
}

masterEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ enabled: masterEl.checked });
  const { cfg = {} } = await chrome.storage.local.get('cfg');
  updateMasterDisplay(masterEl.checked, cfg);
  flash();
});

document.getElementById('reload').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await chrome.tabs.reload(tab.id);
  window.close();
});

document.getElementById('options').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

const profileEl = document.getElementById('profile');
const uaPreview = document.getElementById('uaPreview');
const profileExplain = document.getElementById('profileExplain');

function populateProfiles(activeId) {
  profileEl.innerHTML = '';
  for (const p of PHANTOM_PROFILES) {
    const opt = document.createElement('option');
    opt.value = p.value;
    opt.textContent = p.label;
    if (p.value === activeId) opt.selected = true;
    profileEl.appendChild(opt);
  }
  const active = findProfile(activeId);
  uaPreview.textContent = active.ua;
  profileExplain.textContent = active.description || '';
}

profileEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ profile: profileEl.value });
  const active = findProfile(profileEl.value);
  uaPreview.textContent = active.ua;
  profileExplain.textContent = active.description || '';
  flash();
});

const regionEl       = document.getElementById('region');
const regionHint     = document.getElementById('regionHint');
const regionExplain  = document.getElementById('regionExplain');
const resolutionEl   = document.getElementById('resolution');
const resHint        = document.getElementById('resolutionHint');
const resolutionExplain = document.getElementById('resolutionExplain');

function populateRegions(activeId) {
  regionEl.innerHTML = '';
  for (const r of PHANTOM_REGIONS) {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.label;
    if (r.id === activeId) opt.selected = true;
    regionEl.appendChild(opt);
  }
  const r = findRegion(activeId);
  regionHint.textContent = `${r.locale} · ${r.tz} · ${r.languages.join(', ')}`;
  regionExplain.textContent = r.description || '';
}

function populateResolutions(activeId) {
  resolutionEl.innerHTML = '';
  for (const r of PHANTOM_RESOLUTIONS) {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.label;
    if (r.id === activeId) opt.selected = true;
    resolutionEl.appendChild(opt);
  }
  const r = findResolution(activeId);
  resHint.textContent = `${r.width}×${r.height} · DPR ${r.dpr} · ${r.mobile ? 'mobile' : 'desktop'}`;
  resolutionExplain.textContent = r.description || '';
}

regionEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ region: regionEl.value });
  const r = findRegion(regionEl.value);
  regionHint.textContent = `${r.locale} · ${r.tz} · ${r.languages.join(', ')}`;
  regionExplain.textContent = r.description || '';
  flash();
});

resolutionEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ resolution: resolutionEl.value });
  const r = findResolution(resolutionEl.value);
  resHint.textContent = `${r.width}×${r.height} · DPR ${r.dpr} · ${r.mobile ? 'mobile' : 'desktop'}`;
  resolutionExplain.textContent = r.description || '';
  flash();
});

const bridgeDot = document.getElementById('bridgeDot');
const bridgeBadge = document.getElementById('bridgeBadge');

function paintBridgeStatus(status) {
  bridgeDot.classList.remove('ok','fallback','err');
  if (!status) { bridgeBadge.title = 'Bridge: checking…'; return; }
  if (!status.ok) {
    bridgeDot.classList.add('err');
    bridgeBadge.title = `Bridge: unreachable (${status.error || 'unknown'})`;
  } else if (!status.supported) {
    bridgeDot.classList.add('fallback');
    bridgeBadge.title = `Bridge OK - profile ${status.requestedProfile} unsupported, using ${status.activeProfile}`;
  } else {
    bridgeDot.classList.add('ok');
    bridgeBadge.title = `Bridge OK - ${status.activeProfile} · ${status.version}`;
  }
}

chrome.storage.local.get('bridgeStatus').then((s) => paintBridgeStatus(s.bridgeStatus));
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && 'bridgeStatus' in c) paintBridgeStatus(c.bridgeStatus.newValue);
});

bridgeBadge.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'bridge:recheck' });
});

(async () => {
  const {
    cfg = {}, enabled = true, profile = DEFAULT_PROFILE,
    region = DEFAULT_REGION,
    resolution = resolutionFromProfile(findProfile(profile).platform),
  } = await chrome.storage.local.get(['cfg', 'enabled', 'profile', 'region', 'resolution']);
  populateProfiles(profile);
  populateRegions(region);
  populateResolutions(resolution);
  render(cfg);
  updateCount(cfg);
  updateMasterDisplay(enabled, cfg);
})();
