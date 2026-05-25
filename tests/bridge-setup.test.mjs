import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '..', 'bridge-setup.js'), 'utf8');

function loadModule(chromeMock) {
  const ctx = { self: {}, chrome: chromeMock };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.self.PhantomShieldSetup;
}

test('applyBrowserProxy sets fixed_servers with 127.0.0.1 and given port', async () => {
  const calls = [];
  const chrome = {
    proxy: {
      settings: {
        set: (opts) => { calls.push(opts); return Promise.resolve(); },
      },
    },
  };
  const mod = loadModule(chrome);
  await mod.applyBrowserProxy(8118);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].value.mode, 'fixed_servers');
  assert.equal(calls[0].value.rules.singleProxy.host, '127.0.0.1');
  assert.equal(calls[0].value.rules.singleProxy.port, 8118);
  assert.deepEqual(calls[0].value.rules.bypassList, ['127.0.0.1', 'localhost', '<local>']);
  assert.equal(calls[0].scope, 'regular');
});

test('clearBrowserProxy clears the regular scope', async () => {
  const calls = [];
  const chrome = {
    proxy: {
      settings: {
        clear: (opts) => { calls.push(opts); return Promise.resolve(); },
      },
    },
  };
  const mod = loadModule(chrome);
  await mod.clearBrowserProxy();
  assert.deepEqual(calls, [{ scope: 'regular' }]);
});

function loadWithProbe({ proxyCfg, probe }) {
  const chrome = {
    proxy: {
      settings: { get: () => Promise.resolve(proxyCfg) },
    },
  };
  const ctx = { self: {}, chrome, bridgeSelfCheck: () => Promise.resolve(probe) };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx.self.PhantomShieldSetup;
}

test('detectSetupState: all unhealthy when nothing works', async () => {
  const mod = loadWithProbe({
    proxyCfg: { value: { mode: 'system' } },
    probe: { ok: false, error: 'Failed to fetch' },
  });
  const s = await mod.detectSetupState();
  assert.equal(s.proxy_configured, false);
  assert.equal(s.bridge_reachable, false);
  assert.equal(s.addon_loaded, false);
  assert.equal(s.ca_trusted, null); // unknown when probe fails for non-cert reason
});

test('detectSetupState: ca_trusted=false on cert error', async () => {
  const mod = loadWithProbe({
    proxyCfg: { value: { mode: 'fixed_servers', rules: { singleProxy: { host: '127.0.0.1' } } } },
    probe: { ok: false, error: 'net::ERR_CERT_AUTHORITY_INVALID' },
  });
  const s = await mod.detectSetupState();
  assert.equal(s.proxy_configured, true);
  assert.equal(s.bridge_reachable, false);
  assert.equal(s.ca_trusted, false);
});

test('detectSetupState: all green when probe ok with version', async () => {
  const mod = loadWithProbe({
    proxyCfg: { value: { mode: 'fixed_servers', rules: { singleProxy: { host: '127.0.0.1' } } } },
    probe: { ok: true, version: 'phantom-shield-bridge/0.7' },
  });
  const s = await mod.detectSetupState();
  assert.equal(s.proxy_configured, true);
  assert.equal(s.bridge_reachable, true);
  assert.equal(s.addon_loaded, true);
  assert.equal(s.ca_trusted, true);
});

test('detectSetupState: bridge_reachable but addon_loaded=false when no version', async () => {
  const mod = loadWithProbe({
    proxyCfg: { value: { mode: 'fixed_servers', rules: { singleProxy: { host: '127.0.0.1' } } } },
    probe: { ok: false, error: 'Bridge responded 200 but no X-Phantom-Bridge-Version header' },
  });
  const s = await mod.detectSetupState();
  // The current bridgeSelfCheck contract sets ok=false in this case; the addon is technically
  // present but reports an outdated version. The card surfaces this via a distinct message.
  assert.equal(s.proxy_configured, true);
  assert.equal(s.bridge_reachable, false);
  assert.equal(s.addon_loaded, false);
});
