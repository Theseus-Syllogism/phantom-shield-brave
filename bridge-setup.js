// bridge-setup.js - pure setup-detection + proxy-config helpers.
// Loaded by background.js via importScripts(); exposed on self.PhantomShieldSetup.
// No load-time side effects, so the tests can load it in a plain vm context.
// Runtime dependency: detectSetupState() calls a global bridgeSelfCheck()
// provided by background.js (present by the time any message arrives). Tests
// inject it into the vm context.

// The extension assumes the bridge listens on 8118. Installing with a custom
// --port is not yet wired through to the extension (would need the addon to
// echo an X-Phantom-Port header on the probe - tracked as future work).
const PHANTOM_SHIELD_DEFAULT_PORT = 8118;

async function applyBrowserProxy(port = PHANTOM_SHIELD_DEFAULT_PORT) {
  await chrome.proxy.settings.set({
    value: {
      mode: 'fixed_servers',
      rules: {
        singleProxy: { scheme: 'http', host: '127.0.0.1', port },
        bypassList: ['127.0.0.1', 'localhost', '<local>'],
      },
    },
    scope: 'regular',
  });
}

async function clearBrowserProxy() {
  await chrome.proxy.settings.clear({ scope: 'regular' });
}

async function detectSetupState() {
  const out = {
    bridge_reachable: false,
    addon_loaded: false,
    proxy_configured: false,
    ca_trusted: null,
    last_error: null,
    checked_at: Date.now(),
  };

  try {
    const cfg = await chrome.proxy.settings.get({});
    const mode = cfg && cfg.value && cfg.value.mode;
    const host = cfg && cfg.value && cfg.value.rules && cfg.value.rules.singleProxy
      && cfg.value.rules.singleProxy.host;
    out.proxy_configured = mode === 'fixed_servers' && host === '127.0.0.1';
  } catch (e) {
    out.last_error = `proxy-get: ${e}`;
  }

  const probe = await bridgeSelfCheck();
  out.bridge_reachable = !!probe.ok;
  out.addon_loaded = !!probe.version;
  if (!probe.ok && /CERT_AUTHORITY|certificate/i.test(probe.error || '')) {
    out.ca_trusted = false;
  } else if (probe.ok) {
    out.ca_trusted = true;
  }
  return out;
}

self.PhantomShieldSetup = {
  DEFAULT_PORT: PHANTOM_SHIELD_DEFAULT_PORT,
  applyBrowserProxy,
  clearBrowserProxy,
  detectSetupState,
};
