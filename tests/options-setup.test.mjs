import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, '..', 'options.js'), 'utf8');

function loadOptions(navigatorMock) {
  const ctx = {
    self: {},
    chrome: { storage: { local: { get: () => Promise.resolve({}) } }, runtime: { onMessage: { addListener() {} } } },
    document: { getElementById: () => null, addEventListener() {} },
    navigator: navigatorMock,
  };
  vm.createContext(ctx);
  const begin = SRC.indexOf('// === setup-helpers begin ===');
  const end = SRC.indexOf('// === setup-helpers end ===');
  if (begin < 0 || end < 0) throw new Error('setup-helpers markers missing in options.js');
  const snippet = SRC.slice(begin, end);
  vm.runInContext(snippet, ctx);
  return ctx;
}

test('detectClientOS: linux UA', () => {
  const ctx = loadOptions({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' });
  assert.equal(ctx.detectClientOS(), 'linux');
});

test('detectClientOS: macOS UA', () => {
  const ctx = loadOptions({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2)' });
  assert.equal(ctx.detectClientOS(), 'macos');
});

test('detectClientOS: Windows UA', () => {
  const ctx = loadOptions({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  assert.equal(ctx.detectClientOS(), 'windows');
});

test('detectClientOSDistro: defaults linux to linux_debian when undetermined', () => {
  const ctx = loadOptions({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' });
  assert.equal(ctx.detectClientOSDistro(), 'linux_debian');
});

test('detectClientOSDistro: maps macOS UA to macos', () => {
  const ctx = loadOptions({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2)' });
  assert.equal(ctx.detectClientOSDistro(), 'macos');
});
