import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { makeDom, loadScript } from './_harness.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIB = readFileSync(resolve(__dirname, '..', 'lib.js'), 'utf8');

export function loadLib() {
  const ctx = { self: {} };
  vm.createContext(ctx);
  vm.runInContext(LIB, ctx);
  return ctx.self.PhantomShieldLib;
}

test('lib.js exposes PhantomShieldLib', () => {
  const L = loadLib();
  assert.ok(L && typeof L === 'object');
});

test('tzOffsetMinutes returns NY offset 240 in summer DST', () => {
  const L = loadLib();
  // 2025-07-04 noon UTC → NY is in EDT (UTC-4) → offset = 240 (minutes west)
  const d = new Date(Date.UTC(2025, 6, 4, 12, 0, 0));
  assert.strictEqual(L.tzOffsetMinutes(d, 'America/New_York'), 240);
});

test('tzOffsetMinutes returns NY offset 300 in winter (EST)', () => {
  const L = loadLib();
  const d = new Date(Date.UTC(2025, 0, 15, 12, 0, 0));
  assert.strictEqual(L.tzOffsetMinutes(d, 'America/New_York'), 300);
});

test('tzOffsetMinutes returns Tokyo offset -540 (UTC+9)', () => {
  const L = loadLib();
  const d = new Date(Date.UTC(2025, 6, 4, 12, 0, 0));
  assert.strictEqual(L.tzOffsetMinutes(d, 'Asia/Tokyo'), -540);
});

test('tzOffsetMinutes returns 0 for UTC', () => {
  const L = loadLib();
  assert.strictEqual(L.tzOffsetMinutes(new Date(), 'UTC'), 0);
});

test('isPrivateAddress detects RFC1918 v4', () => {
  const L = loadLib();
  assert.strictEqual(L.isPrivateAddress('10.0.0.1'), true);
  assert.strictEqual(L.isPrivateAddress('172.16.5.5'), true);
  assert.strictEqual(L.isPrivateAddress('172.31.255.255'), true);
  assert.strictEqual(L.isPrivateAddress('172.32.0.0'), false);
  assert.strictEqual(L.isPrivateAddress('192.168.1.1'), true);
});

test('isPrivateAddress detects CGNAT', () => {
  const L = loadLib();
  assert.strictEqual(L.isPrivateAddress('100.64.0.1'), true);
  assert.strictEqual(L.isPrivateAddress('100.127.255.255'), true);
  assert.strictEqual(L.isPrivateAddress('100.128.0.0'), false);
});

test('isPrivateAddress detects link-local', () => {
  const L = loadLib();
  assert.strictEqual(L.isPrivateAddress('169.254.1.1'), true);
  assert.strictEqual(L.isPrivateAddress('127.0.0.1'), true);
});

test('isPrivateAddress detects IPv6 ranges', () => {
  const L = loadLib();
  assert.strictEqual(L.isPrivateAddress('fe80::1'), true);
  assert.strictEqual(L.isPrivateAddress('fc00::1'), true);
  assert.strictEqual(L.isPrivateAddress('fdff::1'), true);
  assert.strictEqual(L.isPrivateAddress('::1'), true);
  assert.strictEqual(L.isPrivateAddress('2001:db8::1'), false);
});

test('isPrivateAddress keeps mDNS hosts public-ish (caller decides)', () => {
  const L = loadLib();
  assert.strictEqual(L.isPrivateAddress('foo.local'), false);
});

test('isPrivateAddress passes public IPs', () => {
  const L = loadLib();
  assert.strictEqual(L.isPrivateAddress('8.8.8.8'), false);
  assert.strictEqual(L.isPrivateAddress('1.1.1.1'), false);
});

test('extractAddress parses SDP candidate line', () => {
  const L = loadLib();
  const line = 'candidate:1 1 UDP 2113937151 192.168.1.5 54321 typ host generation 0';
  assert.strictEqual(L.extractAddress(line), '192.168.1.5');
});

test('extractAddress parses srflx with raddr', () => {
  const L = loadLib();
  const line = 'candidate:2 1 UDP 1677729535 1.2.3.4 50001 typ srflx raddr 192.168.1.5 rport 54321';
  assert.strictEqual(L.extractAddress(line), '1.2.3.4');
});

test('extractAddress returns null for malformed', () => {
  const L = loadLib();
  assert.strictEqual(L.extractAddress('garbage'), null);
});

test('acceptLanguage formats single locale', () => {
  const L = loadLib();
  assert.strictEqual(L.acceptLanguage(['en-US']), 'en-US');
});

test('acceptLanguage formats en-US, en', () => {
  const L = loadLib();
  assert.strictEqual(L.acceptLanguage(['en-US', 'en']), 'en-US,en;q=0.9');
});

test('acceptLanguage formats de-DE chain', () => {
  const L = loadLib();
  assert.strictEqual(L.acceptLanguage(['de-DE', 'de', 'en']), 'de-DE,de;q=0.9,en;q=0.8');
});

test('acceptLanguage formats ja chain', () => {
  const L = loadLib();
  assert.strictEqual(L.acceptLanguage(['ja', 'en-US', 'en']), 'ja,en-US;q=0.9,en;q=0.8');
});

test('acceptLanguage falls back for empty', () => {
  const L = loadLib();
  assert.strictEqual(L.acceptLanguage([]), 'en-US,en;q=0.9');
  assert.strictEqual(L.acceptLanguage(null), 'en-US,en;q=0.9');
});

test('acceptLanguage caps quality at 5 entries', () => {
  const L = loadLib();
  const got = L.acceptLanguage(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.strictEqual(got, 'a,b;q=0.9,c;q=0.8,d;q=0.7,e;q=0.6,f;q=0.5');
});

// NOTE: parseFamilies tests use assert.deepEqual (not strict) because
// parseFamilies returns an Array from the JSDOM VM realm, which has a
// different Array constructor than the test's native realm. deepStrictEqual
// treats cross-realm arrays as non-reference-equal even when values match.
// This is a JSDOM multi-realm artifact; real browsers behave identically to
// the expected values below.
test('parseFamilies extracts a single family', async () => {
  const dom = makeDom();
  loadScript(dom, 'lib.js');
  const L = dom.window.PhantomShieldLib;
  const fams = L.parseFamilies('12px Arial');
  assert.deepEqual(fams, ['arial']);
});

test('parseFamilies extracts a fallback chain', async () => {
  const dom = makeDom();
  loadScript(dom, 'lib.js');
  const L = dom.window.PhantomShieldLib;
  const fams = L.parseFamilies('14px "Helvetica Neue", Helvetica, sans-serif');
  assert.deepEqual(fams, ['helvetica neue', 'helvetica', 'sans-serif']);
});

test('parseFamilies handles quoted families with spaces', async () => {
  const dom = makeDom();
  loadScript(dom, 'lib.js');
  const L = dom.window.PhantomShieldLib;
  const fams = L.parseFamilies('italic bold 16px/1.5 "Times New Roman", serif');
  assert.deepEqual(fams, ['times new roman', 'serif']);
});

test('parseFamilies returns empty on garbage', async () => {
  const dom = makeDom();
  loadScript(dom, 'lib.js');
  const L = dom.window.PhantomShieldLib;
  assert.deepEqual(L.parseFamilies('this is not a font shorthand'), []);
});

test('filterSdp removes private host candidate', () => {
  const L = loadLib();
  const sdp = [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=candidate:1 1 UDP 2113937151 192.168.1.5 54321 typ host generation 0',
    'a=candidate:2 1 UDP 1677729535 9.9.9.9 50001 typ srflx raddr 192.168.1.5 rport 54321',
  ].join('\r\n');
  const out = L.filterSdp(sdp);
  assert.ok(!out.includes('192.168.1.5 54321 typ host'), 'host should be stripped');
  assert.ok(out.includes('9.9.9.9 50001 typ srflx'), 'srflx (public) should remain');
  assert.ok(!out.includes('raddr 192.168.1.5'), 'raddr leak should be stripped');
});

test('filterSdp keeps mDNS .local host candidates', () => {
  const L = loadLib();
  const sdp = [
    'a=candidate:1 1 UDP 2113937151 abc.local 54321 typ host generation 0',
  ].join('\r\n');
  assert.ok(L.filterSdp(sdp).includes('abc.local'));
});

test('filterSdp leaves non-candidate lines alone', () => {
  const L = loadLib();
  const sdp = 'v=0\r\no=- 1 1 IN IP4 0.0.0.0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111';
  assert.strictEqual(L.filterSdp(sdp), sdp);
});

test('secChUaHeader builds a Chromium brand string', () => {
  const L = loadLib();
  const brands = [
    { brand: 'Chromium', version: '146' },
    { brand: 'Google Chrome', version: '146' },
    { brand: 'Not_A Brand', version: '24' },
  ];
  assert.strictEqual(
    L.secChUaHeader(brands),
    '"Chromium";v="146", "Google Chrome";v="146", "Not_A Brand";v="24"'
  );
});

test('secChUaHeader returns empty string for empty/missing brands', () => {
  const L = loadLib();
  assert.strictEqual(L.secChUaHeader([]), '');
  assert.strictEqual(L.secChUaHeader(undefined), '');
});
