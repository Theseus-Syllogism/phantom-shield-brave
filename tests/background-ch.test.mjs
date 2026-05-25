import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

function loadLib() {
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(resolve(ROOT, 'lib.js'), 'utf8'), ctx);
  return ctx.self.PhantomShieldLib;
}

// Load the profile catalogue (profiles.js assigns onto a global-ish scope).
function loadProfiles() {
  const ctx = { self: {}, window: {} };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(resolve(ROOT, 'profiles.js'), 'utf8'), ctx);
  return ctx.PHANTOM_PROFILES || ctx.self.PHANTOM_PROFILES || ctx.window.PHANTOM_PROFILES;
}

function findOp(ops, header) {
  return ops.find((o) => o.header.toLowerCase() === header.toLowerCase());
}

// platform -> substring that must appear in a coherent UA
const PLATFORM_UA_TOKEN = {
  Windows: 'Windows', macOS: 'Macintosh', iOS: 'iPhone', Android: 'Android', Linux: 'Linux',
};

// NOTE: object comparisons below use assert.deepEqual (not strict) because the
// ops are constructed inside the lib.js vm realm, whose Object constructor
// differs from this test's native realm. deepStrictEqual treats cross-realm
// objects as non-reference-equal even when every key/value matches (the same
// multi-realm artifact documented in tests/lib.test.mjs for parseFamilies).
// deepEqual still checks header/operation/value exactly; only the prototype
// identity check is relaxed.
test('buildClientHintsRequestHeaders: Chromium profile sets coherent low-entropy hints', () => {
  const L = loadLib();
  const profile = {
    platform: 'Windows', mobile: false,
    brands: [
      { brand: 'Chromium', version: '146' },
      { brand: 'Google Chrome', version: '146' },
      { brand: 'Not_A Brand', version: '24' },
    ],
  };
  const ops = L.buildClientHintsRequestHeaders(profile);
  assert.deepEqual(findOp(ops, 'Sec-CH-UA-Platform'),
    { header: 'Sec-CH-UA-Platform', operation: 'set', value: '"Windows"' });
  assert.deepEqual(findOp(ops, 'Sec-CH-UA-Mobile'),
    { header: 'Sec-CH-UA-Mobile', operation: 'set', value: '?0' });
  assert.strictEqual(findOp(ops, 'Sec-CH-UA').value,
    '"Chromium";v="146", "Google Chrome";v="146", "Not_A Brand";v="24"');
  const arch = findOp(ops, 'Sec-CH-UA-Arch');
  assert.strictEqual(arch.operation, 'remove');
});

test('buildClientHintsRequestHeaders: mobile flag becomes ?1', () => {
  const L = loadLib();
  const ops = L.buildClientHintsRequestHeaders({
    platform: 'Android', mobile: true,
    brands: [{ brand: 'Chromium', version: '131' }],
  });
  assert.strictEqual(findOp(ops, 'Sec-CH-UA-Mobile').value, '?1');
  assert.strictEqual(findOp(ops, 'Sec-CH-UA-Platform').value, '"Android"');
});

test('buildClientHintsRequestHeaders: missing platform defaults to "Windows"', () => {
  const L = loadLib();
  const ops = L.buildClientHintsRequestHeaders({
    mobile: false,
    brands: [{ brand: 'Chromium', version: '146' }],
  });
  assert.strictEqual(findOp(ops, 'Sec-CH-UA-Platform').value, '"Windows"');
});

test('buildClientHintsRequestHeaders: non-Chromium removes all hints, sets none', () => {
  const L = loadLib();
  const ops = L.buildClientHintsRequestHeaders({ platform: 'Windows', mobile: false, brands: [] });
  assert.ok(ops.length >= 10);
  assert.ok(ops.every((o) => o.operation === 'remove'));
  assert.ok(!ops.some((o) => o.header.toLowerCase() === 'sec-ch-ua' && o.operation === 'set'));
});

test('every real profile is client-hint coherent with its UA', () => {
  const L = loadLib();
  const profiles = loadProfiles();
  assert.ok(Array.isArray(profiles) && profiles.length > 0, 'profiles loaded');
  for (const p of profiles) {
    const ops = L.buildClientHintsRequestHeaders(p);
    const platOp = findOp(ops, 'Sec-CH-UA-Platform');
    if ((p.brands || []).length > 0) {
      const token = PLATFORM_UA_TOKEN[p.platform];
      assert.ok(token, `known platform for ${p.value}`);
      assert.strictEqual(platOp.operation, 'set', `${p.value} sets platform`);
      assert.strictEqual(platOp.value, `"${p.platform}"`, `${p.value} platform value`);
      assert.ok(p.ua.includes(token),
        `${p.value}: UA "${p.ua}" should contain platform token "${token}"`);
    } else {
      assert.ok(!platOp || platOp.operation === 'remove',
        `${p.value} (non-Chromium) must not set Sec-CH-UA-Platform`);
    }
  }
});
