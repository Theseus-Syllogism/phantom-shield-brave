import { test } from 'node:test';
import assert from 'node:assert';
import { makeDom } from './_harness.mjs';

test('JSDOM boots and exposes window', () => {
  const dom = makeDom();
  assert.strictEqual(dom.window.location.href, 'https://example.test/');
  assert.ok(dom.window.Navigator);
});
