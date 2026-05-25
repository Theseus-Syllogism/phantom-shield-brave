const PHANTOMS = [
  // ── Original ─────────────────────────────────────────────────
  { id: 'gamepad',        tier: 'core', name: 'Gamepad',                    surface: 'Navigator.getGamepads()',                       desc: 'Always reports no controllers connected.' },
  { id: 'bluetooth',      tier: 'core', name: 'Bluetooth availability',     surface: 'Bluetooth.getAvailability()',                   desc: 'Always reports Bluetooth unavailable.' },
  { id: 'keyboard',       tier: 'core', name: 'Keyboard layout',            surface: 'Keyboard.getLayoutMap()',                       desc: 'Empty map (hides physical layout).' },
  { id: 'storage',        tier: 'core', name: 'Storage estimate',           surface: 'StorageManager.estimate()',                     desc: 'Fixed 1 GiB quota, 0 used.' },
  { id: 'locks',          tier: 'core', name: 'Web Locks',                  surface: 'LockManager.query()',                           desc: 'Reports no pending or held locks.' },
  { id: 'netinfo',        tier: 'core', name: 'Network information',        surface: 'navigator.connection',                          desc: 'Pinned to 4g / 50ms / 10 Mbps.' },
  { id: 'uadata',         tier: 'core', name: 'UA Client Hints (high-entropy)', surface: 'NavigatorUAData.getHighEntropyValues()',    desc: 'Strips arch, bitness, model, full version.' },
  { id: 'memory',         tier: 'core', name: 'Memory measurement',         surface: 'performance.measureUserAgentSpecificMemory()',  desc: 'Rejects with NotAllowedError.' },
  { id: 'webgpu',         tier: 'core', name: 'WebGPU adapter',             surface: 'GPUAdapter info / features / limits',           desc: 'Strips vendor strings; coerces features=∅ and limits to spec minimums.' },
  // ── Tier 1 ───────────────────────────────────────────────────
  { id: 'perfmem',        tier: 't1',   name: 'JS heap size',               surface: 'performance.memory',                            desc: 'Pinned to common ~2 GiB heap class.' },
  { id: 'hid',            tier: 't1',   name: 'WebHID paired devices',      surface: 'navigator.hid.getDevices()',                    desc: 'Empty list.' },
  { id: 'serial',         tier: 't1',   name: 'WebSerial paired ports',     surface: 'navigator.serial.getPorts()',                   desc: 'Empty list.' },
  { id: 'usb',            tier: 't1',   name: 'WebUSB paired devices',      surface: 'navigator.usb.getDevices()',                    desc: 'Empty list.' },
  { id: 'installedapps',  tier: 't1',   name: 'Installed related PWAs',     surface: 'navigator.getInstalledRelatedApps()',           desc: 'Empty list.' },
  { id: 'mediacaps',      tier: 't1',   name: 'Media HW decode capability', surface: 'MediaCapabilities.decodingInfo() / encodingInfo()', desc: 'Preserves "supported"; forces smooth=false, powerEfficient=false to kill HW signal.' },
  { id: 'rtccaps',        tier: 't1',   name: 'WebRTC codec capabilities',  surface: 'RTCRtpSender/Receiver.getCapabilities()',       desc: 'Filters codec/extension lists to a minimal universal baseline. May break apps that require a specific codec.' },
  // ── Tier 2 ───────────────────────────────────────────────────
  { id: 'screenextended', tier: 't2',   name: 'Multi-monitor flag',          surface: 'screen.isExtended',                            desc: 'Always reports false.' },
  { id: 'vkeyboard',      tier: 't2',   name: 'Virtual keyboard rect',       surface: 'navigator.virtualKeyboard.boundingRect',       desc: 'Zero DOMRect.' },
  { id: 'wakelock',       tier: 't2',   name: 'Screen wake lock',            surface: 'WakeLock.request()',                           desc: 'Rejects with NotAllowedError. May affect video players.' },
  { id: 'idle',           tier: 't2',   name: 'Idle detection',              surface: 'IdleDetector.requestPermission() / start()',   desc: 'Permission always denied.' },
  { id: 'pressure',       tier: 't2',   name: 'Compute pressure',            surface: 'PressureObserver.observe()',                   desc: 'Rejects with NotAllowedError.' },
  { id: 'sensors',        tier: 't2',   name: 'Motion / orientation sensors', surface: 'Sensor.prototype.start (all sensor subclasses)', desc: 'Always fires an error event (matches no-sensor-available).' },
  { id: 'matchmedia',     tier: 't2',   name: 'A11y media queries',          surface: 'matchMedia(prefers-reduced-motion / contrast / etc.)', desc: 'Forces queries to their default-population values. Leaves color-scheme/pointer/hover untouched.' },
  // ── Tier 3 - coherence ───────────────────────────────────────
  { id: 'intl-locale',    tier: 't3', name: 'Language',                surface: 'navigator.language / languages',                desc: 'Sets language and languages list from the selected region.' },
  { id: 'intl-tz',        tier: 't3', name: 'Timezone',                surface: 'Date.getTimezoneOffset / Intl.DateTimeFormat',  desc: 'Reports the region\'s timezone (handles DST). Apps that pass an explicit timeZone still get that value.' },
  { id: 'intl-collator',  tier: 't3', name: 'Intl locale coherence',   surface: 'Intl.{Collator,NumberFormat,RelativeTime,…}',   desc: 'When code constructs an Intl object without a locale, defaults to the region locale.' },
  { id: 'screen-dims',    tier: 't3', name: 'Screen dimensions',       surface: 'screen.{width,height,availWidth,availHeight}',   desc: 'Reports the selected Resolution preset, not the real screen.' },
  { id: 'screen-color',   tier: 't3', name: 'Color depth',             surface: 'screen.colorDepth / pixelDepth',                desc: 'Pinned to 24.' },
  { id: 'dpr',            tier: 't3', name: 'Device pixel ratio',      surface: 'window.devicePixelRatio',                       desc: 'Reports the resolution preset\'s DPR.' },
  { id: 'screen-orient',  tier: 't3', name: 'Screen orientation',      surface: 'screen.orientation',                            desc: 'Portrait on mobile, landscape on desktop.' },
  { id: 'nav-hwconc',     tier: 't3', name: 'Hardware concurrency',    surface: 'navigator.hardwareConcurrency',                 desc: 'Pinned to a common modal value (desktop 8, mobile 4-8).' },
  { id: 'nav-devmem',     tier: 't3', name: 'Device memory',           surface: 'navigator.deviceMemory',                        desc: 'Pinned (desktop 8, mobile 4, Tor 2).' },
  { id: 'nav-touch',      tier: 't3', name: 'Touch points',            surface: 'navigator.maxTouchPoints',                      desc: '0 on desktop, 5 on mobile.' },
  { id: 'nav-pdf',        tier: 't3', name: 'PDF viewer flag',         surface: 'navigator.pdfViewerEnabled',                    desc: 'true on desktop, false on mobile.' },
  { id: 'nav-webdriver',  tier: 't3', name: 'WebDriver flag',          surface: 'navigator.webdriver',                           desc: 'Always false. Strong anti-bot signal.' },
  { id: 'nav-vendor',     tier: 't3', name: 'Vendor strings',          surface: 'navigator.vendor / vendorSub / productSub',     desc: 'Coherent with active TLS profile.' },
  { id: 'nav-appver',     tier: 't3', name: 'appVersion',              surface: 'navigator.appVersion',                          desc: 'Derived from active UA.' },
  { id: 'webrtc-leak',    tier: 't3', name: 'WebRTC IP leak',          surface: 'RTCPeerConnection',                             desc: 'Filters private-IP ICE candidates; mode set in card above.' },
  { id: 'brave-mask',     tier: 't3', name: 'Brave engine signature',  surface: 'navigator.brave / document.browsingTopics',     desc: 'Removes the navigator.brave object and restores Chrome\'s Topics API surface so a Chrome profile does not read as Brave. Disable only if a site needs Brave APIs.' },
  { id: 'fonts',          tier: 't3', name: 'Font enumeration',        surface: 'document.fonts',                                 desc: 'Reports only the per-platform baseline + page-added fonts.' },
  { id: 'double-noise',   tier: 't3', name: 'Double-noise (experimental)', surface: 'canvas + audio readbacks',                  desc: 'EXPERIMENTAL. Adds LSB perturbation on top of Brave\'s farbling. May break image editors, music apps, and accessibility tools.' },
];

const TIER_TITLES = {
  core: 'Original (Brave-gap surfaces)',
  t1:   'Tier 1 - high signal',
  t2:   'Tier 2 - defense-in-depth',
  t3:   'Tier 3 - coherence',
};

const list = document.getElementById('list');
const savedFlash = document.getElementById('saved');
let flashTimer;

function flash() {
  savedFlash.classList.add('on');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => savedFlash.classList.remove('on'), 900);
}

function render(cfg) {
  list.innerHTML = '';
  let currentTier = null;
  for (const p of PHANTOMS) {
    if (p.tier !== currentTier) {
      currentTier = p.tier;
      const h = document.createElement('h2');
      h.textContent = TIER_TITLES[currentTier];
      list.appendChild(h);
    }
    const li = document.createElement('li');
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = cfg[p.id] !== false;
    cb.addEventListener('change', async () => {
      const { cfg: cur = {} } = await chrome.storage.local.get('cfg');
      cur[p.id] = cb.checked;
      await chrome.storage.local.set({ cfg: cur });
      flash();
    });
    const text = document.createElement('div');
    text.innerHTML =
      `<span class="name">${p.name}</span> ` +
      `<span class="surface">${p.surface}</span>` +
      `<span class="desc">${p.desc}</span>`;
    label.appendChild(cb);
    label.appendChild(text);
    li.appendChild(label);
    list.appendChild(li);
  }
}

const profileEl = document.getElementById('profile');
const uaHint = document.getElementById('uaHint');
const profileExplain = document.getElementById('profileExplain');
const uaOverrideEl = document.getElementById('uaOverride');
const coherenceWarn = document.getElementById('coherenceWarn');

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
  uaHint.textContent = active.ua;
  profileExplain.textContent = active.description || '';
}

function updateCoherenceWarn() {
  const profile = findProfile(profileEl.value);
  const override = uaOverrideEl.value.trim();
  const incoherent = override && override !== profile.ua;
  coherenceWarn.classList.toggle('on', !!incoherent);
}

profileEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ profile: profileEl.value });
  const active = findProfile(profileEl.value);
  uaHint.textContent = active.ua;
  profileExplain.textContent = active.description || '';
  updateCoherenceWarn();
  flash();
});

// Browse-all reference list - populated once on load.
function renderBrowseProfiles() {
  const container = document.getElementById('browseProfilesList');
  if (!container) return;
  container.innerHTML = '';
  for (const p of PHANTOM_PROFILES) {
    const row = document.createElement('div');
    row.className = 'browse-row';
    const head = document.createElement('div');
    const labelSpan = document.createElement('span');
    labelSpan.className = 'browse-label';
    labelSpan.textContent = p.label;
    head.appendChild(labelSpan);
    const tag = document.createElement('span');
    tag.className = 'browse-tag';
    tag.textContent = p.value;
    head.appendChild(tag);
    if (p.mobile) {
      const m = document.createElement('span');
      m.className = 'browse-tag';
      m.textContent = 'mobile';
      head.appendChild(m);
    }
    const ua = document.createElement('div');
    ua.className = 'browse-ua';
    ua.textContent = p.ua;
    const desc = document.createElement('div');
    desc.className = 'browse-desc';
    desc.textContent = p.description || '';
    row.appendChild(head);
    row.appendChild(ua);
    row.appendChild(desc);
    container.appendChild(row);
  }
}

let uaSaveTimer;
uaOverrideEl.addEventListener('input', () => {
  updateCoherenceWarn();
  clearTimeout(uaSaveTimer);
  uaSaveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ uaOverride: uaOverrideEl.value.trim() });
    flash();
  }, 300);
});

const regionEl = document.getElementById('region');
const regionHint = document.getElementById('regionHint');
const regionExplain = document.getElementById('regionExplain');
const resolutionEl = document.getElementById('resolution');
const resolutionHint = document.getElementById('resolutionHint');
const resolutionExplain = document.getElementById('resolutionExplain');
const webrtcModeEl = document.getElementById('webrtcMode');
const webrtcExplain = document.getElementById('webrtcExplain');

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
  resolutionHint.textContent = `${r.width}×${r.height} · DPR ${r.dpr} · ${r.mobile ? 'mobile' : 'desktop'}`;
  resolutionExplain.textContent = r.description || '';
}

function populateWebrtcModes(activeId) {
  webrtcModeEl.innerHTML = '';
  for (const m of WEBRTC_MODES) {
    const opt = document.createElement('option');
    opt.value = m.id; opt.textContent = m.label;
    if (m.id === activeId) opt.selected = true;
    webrtcModeEl.appendChild(opt);
  }
  webrtcExplain.textContent = findWebrtcMode(activeId).description || '';
}

regionEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ region: regionEl.value });
  populateRegions(regionEl.value);
  flash();
});

resolutionEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ resolution: resolutionEl.value });
  populateResolutions(resolutionEl.value);
  flash();
});

webrtcModeEl.addEventListener('change', async () => {
  await chrome.storage.local.set({ webrtcLeakMode: webrtcModeEl.value });
  webrtcExplain.textContent = findWebrtcMode(webrtcModeEl.value).description || '';
  flash();
});

const bridgeCard = document.getElementById('bridgeCard');
const bridgeText = document.getElementById('bridgeStateText');
const bridgeDetails = document.getElementById('bridgeDetails');

function paintBridge(s) {
  if (!s) { bridgeText.textContent = 'checking…'; bridgeCard.style.borderColor = '#888'; return; }
  if (!s.ok) {
    bridgeText.textContent = 'unreachable';
    bridgeCard.style.borderColor = '#ef4444';
    bridgeDetails.textContent = `Last error: ${s.error || 'unknown'} (checked ${new Date(s.checkedAt).toLocaleString()})`;
  } else if (!s.supported) {
    bridgeText.textContent = `fallback - profile "${s.requestedProfile}" unsupported, using "${s.activeProfile}"`;
    bridgeCard.style.borderColor = '#facc15';
    bridgeDetails.textContent = `Bridge ${s.version} · checked ${new Date(s.checkedAt).toLocaleString()}`;
  } else {
    bridgeText.textContent = `active - ${s.activeProfile}`;
    bridgeCard.style.borderColor = '#4ade80';
    bridgeDetails.textContent = `Bridge ${s.version} · checked ${new Date(s.checkedAt).toLocaleString()}`;
  }
}

chrome.storage.local.get('bridgeStatus').then((g) => paintBridge(g.bridgeStatus));
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && 'bridgeStatus' in c) paintBridge(c.bridgeStatus.newValue);
});

document.getElementById('bridgeRecheck').addEventListener('click', () => {
  bridgeText.textContent = 'checking…'; bridgeCard.style.borderColor = '#888';
  chrome.runtime.sendMessage({ type: 'bridge:recheck' });
});

(async () => {
  const {
    cfg = {}, profile = DEFAULT_PROFILE, uaOverride = '',
    region = DEFAULT_REGION,
    resolution = resolutionFromProfile(findProfile(profile).platform),
    webrtcLeakMode = 'mdns',
  } = await chrome.storage.local.get(['cfg', 'profile', 'uaOverride', 'region', 'resolution', 'webrtcLeakMode']);
  populateProfiles(profile);
  populateRegions(region);
  populateResolutions(resolution);
  populateWebrtcModes(webrtcLeakMode);
  uaOverrideEl.value = uaOverride;
  updateCoherenceWarn();
  updateCoherenceWarn2();
  render(cfg);
  renderBrowseProfiles();
})();

function updateCoherenceWarn2() {
  const profile = findProfile(profileEl.value);
  const resolution = findResolution(resolutionEl.value);
  const mismatch = profile.mobile !== resolution.mobile;
  const warn = document.getElementById('resolutionWarn');
  warn.classList.toggle('on', mismatch);
  if (mismatch) {
    document.getElementById('resPlatformWarn').textContent = resolution.mobile ? 'mobile' : 'desktop';
    document.getElementById('profPlatformWarn').textContent = profile.mobile ? 'mobile' : 'desktop';
  }
}

profileEl.addEventListener('change', updateCoherenceWarn2);
resolutionEl.addEventListener('change', updateCoherenceWarn2);

// === setup-helpers begin ===
function detectClientOS() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos';
  if (/Linux|X11/i.test(ua)) return 'linux';
  return 'linux';
}

function detectClientOSDistro() {
  const os = detectClientOS();
  if (os === 'windows') return 'windows';
  if (os === 'macos') return 'macos';
  // Linux: UA never tells us distro. Default to debian; show a "see also dnf"
  // hint in the modal so Fedora/RHEL users aren't lost.
  return 'linux_debian';
}

const SETUP_INSTALL_CMD = {
  linux: 'cd /opt/phantom-shield && ./scripts/install.sh',
  macos: 'cd /opt/phantom-shield && ./scripts/install.sh',
  windows: 'cd C:\\path\\to\\phantom-shield ; .\\scripts\\install.ps1',
};

const SETUP_CA_INSTRUCTIONS = {
  linux_debian:
`# install.sh does this automatically. To redo manually:
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.crt /usr/local/share/ca-certificates/phantom-shield.crt
sudo update-ca-certificates

# If you're on Fedora/RHEL instead:
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /etc/pki/ca-trust/source/anchors/phantom-shield.pem
sudo update-ca-trust`,
  linux_fedora:
`# install.sh does this automatically. To redo manually:
sudo cp ~/.mitmproxy/mitmproxy-ca-cert.pem /etc/pki/ca-trust/source/anchors/phantom-shield.pem
sudo update-ca-trust`,
  macos:
`# install.sh does this automatically. To redo manually:
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem`,
  windows:
`# install.ps1 does this automatically. To redo manually (in an elevated PowerShell):
certutil -addstore -f "ROOT" "$env:USERPROFILE\\.mitmproxy\\mitmproxy-ca-cert.cer"`,
};

const SETUP_RESTART_CMD = {
  linux:   'systemctl --user restart phantom-shield-bridge.service',
  macos:   'launchctl kickstart -k gui/$UID/com.phantom-shield.bridge',
  windows: 'Stop-ScheduledTask PhantomShieldBridge; Start-ScheduledTask PhantomShieldBridge',
};
// === setup-helpers end ===

// === setup-card runtime ===
function setStepState(stepId, state) {
  // state: true=ok, false=err, null=warn/unknown
  const el = document.querySelector(`.setup-step[data-step="${stepId}"]`);
  if (!el) return;
  el.classList.remove('ok', 'err', 'warn');
  if (state === true)  el.classList.add('ok');
  else if (state === false) el.classList.add('err');
  else el.classList.add('warn');
}

function paintSetupCard(s) {
  const card = document.getElementById('setupCard');
  if (!card) return;
  const allGood = s.bridge_reachable && s.addon_loaded && s.proxy_configured && s.ca_trusted === true;
  card.hidden = allGood;
  setStepState('install', s.bridge_reachable);
  setStepState('addon',   s.addon_loaded);
  setStepState('proxy',   s.proxy_configured);
  setStepState('ca',      s.ca_trusted);
}

async function reverifySetup() {
  const state = await chrome.runtime.sendMessage({ type: 'setup:detect' });
  paintSetupCard(state);
}

function showSetupModal(title, body) {
  document.getElementById('setupModalTitle').textContent = title;
  document.getElementById('setupModalBody').textContent = body;
  document.getElementById('setupModal').classList.add('open');
}

function closeSetupModal() {
  document.getElementById('setupModal').classList.remove('open');
}

document.getElementById('setupModalClose')?.addEventListener('click', closeSetupModal);
document.getElementById('setupModalCopy')?.addEventListener('click', () => {
  const body = document.getElementById('setupModalBody').textContent;
  navigator.clipboard?.writeText(body);
});
document.getElementById('setupModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'setupModal') closeSetupModal();
});

document.getElementById('setupCard')?.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  if (action === 'apply-proxy') {
    // Hardcoded 8118 - the default install port. Custom-port installs aren't
    // supported from this button yet (see bridge-setup.js / X-Phantom-Port).
    await chrome.runtime.sendMessage({ type: 'setup:apply-proxy', port: 8118 });
    setTimeout(reverifySetup, 250);
  } else if (action === 'clear-proxy') {
    await chrome.runtime.sendMessage({ type: 'setup:clear-proxy' });
    setTimeout(reverifySetup, 250);
  } else if (action === 'show-install-cmd') {
    showSetupModal('Install command', SETUP_INSTALL_CMD[detectClientOS()] || SETUP_INSTALL_CMD.linux);
  } else if (action === 'show-ca-instructions') {
    showSetupModal('CA installation', SETUP_CA_INSTRUCTIONS[detectClientOSDistro()] || SETUP_CA_INSTRUCTIONS.linux_debian);
  } else if (action === 'show-restart-cmd') {
    showSetupModal('Restart bridge', SETUP_RESTART_CMD[detectClientOS()] || SETUP_RESTART_CMD.linux);
  }
});

document.getElementById('setupReverify')?.addEventListener('click', reverifySetup);

// Fire on load (after the existing IIFE finishes populating the dropdowns).
// Swallow errors: if the service worker isn't ready yet, the user can still
// trigger detection via the "Re-verify all steps" button.
reverifySetup().catch(() => {});
