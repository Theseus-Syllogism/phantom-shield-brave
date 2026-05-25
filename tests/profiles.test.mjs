import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROFILES = readFileSync(resolve(__dirname, '..', 'profiles.js'), 'utf8');

function loadProfiles() {
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(PROFILES, ctx);
  return ctx.self;
}

test('PHANTOM_PROFILES has at least 19 entries', () => {
  const { PHANTOM_PROFILES } = loadProfiles();
  assert.ok(PHANTOM_PROFILES.length >= 19, `expected >=19 profiles, got ${PHANTOM_PROFILES.length}`);
});

test('every profile has a description >20 chars', () => {
  const { PHANTOM_PROFILES } = loadProfiles();
  for (const p of PHANTOM_PROFILES) {
    assert.ok(typeof p.description === 'string' && p.description.length > 20,
      `profile ${p.value} missing or trivial description`);
  }
});

test('every profile value is unique', () => {
  const { PHANTOM_PROFILES } = loadProfiles();
  const seen = new Set();
  for (const p of PHANTOM_PROFILES) {
    assert.ok(!seen.has(p.value), `duplicate profile value: ${p.value}`);
    seen.add(p.value);
  }
});

test('every region has a description >20 chars', () => {
  const { PHANTOM_REGIONS } = loadProfiles();
  for (const r of PHANTOM_REGIONS) {
    assert.ok(typeof r.description === 'string' && r.description.length > 20,
      `region ${r.id} missing or trivial description`);
  }
});

test('every resolution has a description >20 chars', () => {
  const { PHANTOM_RESOLUTIONS } = loadProfiles();
  for (const r of PHANTOM_RESOLUTIONS) {
    assert.ok(typeof r.description === 'string' && r.description.length > 20,
      `resolution ${r.id} missing or trivial description`);
  }
});

test('WEBRTC_MODES has 3 entries with descriptions', () => {
  const { WEBRTC_MODES } = loadProfiles();
  assert.strictEqual(WEBRTC_MODES.length, 3);
  for (const m of WEBRTC_MODES) {
    assert.ok(m.id, 'mode id missing');
    assert.ok(m.label, `mode ${m.id} label missing`);
    assert.ok(typeof m.description === 'string' && m.description.length > 20,
      `mode ${m.id} description missing or trivial`);
  }
});

test('findWebrtcMode falls back to mdns for unknown id', () => {
  const { findWebrtcMode } = loadProfiles();
  assert.strictEqual(findWebrtcMode('nonexistent').id, 'mdns');
  assert.strictEqual(findWebrtcMode('relay').id, 'relay');
});

test('PHANTOM_REGIONS has 12 entries', () => {
  const { PHANTOM_REGIONS } = loadProfiles();
  assert.strictEqual(PHANTOM_REGIONS.length, 12);
});

test('every region has required fields', () => {
  const { PHANTOM_REGIONS } = loadProfiles();
  for (const r of PHANTOM_REGIONS) {
    assert.ok(r.id, 'id'); assert.ok(r.label, 'label'); assert.ok(r.locale, 'locale');
    assert.ok(r.tz, 'tz'); assert.ok(Array.isArray(r.languages) && r.languages.length, 'languages');
  }
});

test('findRegion finds and falls back', () => {
  const { findRegion } = loadProfiles();
  assert.strictEqual(findRegion('jp').tz, 'Asia/Tokyo');
  assert.strictEqual(findRegion('nonexistent').id, 'us-east');
});

test('PHANTOM_RESOLUTIONS has 8 entries', () => {
  const { PHANTOM_RESOLUTIONS } = loadProfiles();
  assert.strictEqual(PHANTOM_RESOLUTIONS.length, 8);
});

test('resolutionFromProfile maps platforms correctly', () => {
  const { resolutionFromProfile, findResolution } = loadProfiles();
  assert.strictEqual(resolutionFromProfile('Windows'), 'desktop-1080p');
  assert.strictEqual(resolutionFromProfile('macOS'), 'macos-1440');
  assert.strictEqual(resolutionFromProfile('iOS'), 'iphone-390');
  assert.strictEqual(resolutionFromProfile('Android'), 'android-412');
  assert.strictEqual(findResolution('iphone-390').width, 390);
});

test('mobile resolutions have availHeight = height - 80', () => {
  const { findResolution } = loadProfiles();
  const r = findResolution('iphone-390');
  assert.strictEqual(r.availHeight, r.height - 80);
});

test('desktop resolutions have availHeight = height - 40', () => {
  const { findResolution } = loadProfiles();
  const r = findResolution('desktop-1080p');
  assert.strictEqual(r.availHeight, r.height - 40);
});

test('every profile has a caps block', () => {
  const { PHANTOM_PROFILES } = loadProfiles();
  for (const p of PHANTOM_PROFILES) {
    assert.ok(p.caps, `profile ${p.value} missing caps`);
    for (const k of ['hwConcurrency','deviceMemory','maxTouchPoints','vendor','vendorSub','productSub','pdfViewerEnabled']) {
      assert.ok(k in p.caps, `${p.value} missing caps.${k}`);
    }
  }
});

test('Chrome desktop caps are 8/8/0', () => {
  const { findProfile } = loadProfiles();
  const c = findProfile('chrome146').caps;
  assert.strictEqual(c.hwConcurrency, 8);
  assert.strictEqual(c.deviceMemory, 8);
  assert.strictEqual(c.maxTouchPoints, 0);
  assert.strictEqual(c.vendor, 'Google Inc.');
});

test('Android Chrome caps are 8/4/5', () => {
  const { findProfile } = loadProfiles();
  const c = findProfile('chrome131_android').caps;
  assert.strictEqual(c.hwConcurrency, 8);
  assert.strictEqual(c.deviceMemory, 4);
  assert.strictEqual(c.maxTouchPoints, 5);
});

test('Firefox caps have productSub 20100101', () => {
  const { findProfile } = loadProfiles();
  assert.strictEqual(findProfile('firefox147').caps.productSub, '20100101');
});

test('Safari iOS caps are 4/4/5', () => {
  const { findProfile } = loadProfiles();
  const c = findProfile('safari260_ios').caps;
  assert.strictEqual(c.hwConcurrency, 4);
  assert.strictEqual(c.deviceMemory, 4);
  assert.strictEqual(c.maxTouchPoints, 5);
  assert.strictEqual(c.vendor, 'Apple Computer, Inc.');
});

test('font-presets defines Windows/macOS/iOS/Android baselines', () => {
  const code = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'font-presets.js'), 'utf8');
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const { FONT_BASELINE, FONT_GENERICS } = ctx.self;
  assert.ok(FONT_BASELINE.Windows.length > 20);
  assert.ok(FONT_BASELINE.macOS.length > 15);
  assert.ok(FONT_BASELINE.iOS.length > 5);
  assert.ok(FONT_BASELINE.Android.length > 5);
  assert.ok(FONT_GENERICS.has('serif'));
  assert.ok(FONT_GENERICS.has('system-ui'));
});
