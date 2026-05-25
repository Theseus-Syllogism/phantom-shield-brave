import { test } from 'node:test';
import assert from 'node:assert';
import { makeDom, loadScript, setBridgeAttr } from './_harness.mjs';

const CHROMIUM_CFG = {
  'brave-mask': true,
  __ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  __brands: [
    { brand: 'Chromium', version: '146' },
    { brand: 'Google Chrome', version: '146' },
    { brand: 'Not_A Brand', version: '24' },
  ],
  __platform: 'Windows', __mobile: false,
};

const FIREFOX_CFG = {
  'brave-mask': true,
  __ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:147.0) Gecko/20100101 Firefox/147.0',
  __brands: [], __platform: 'Windows', __mobile: false,
};

function bootWith(cfg, { withBrave = true } = {}) {
  const dom = makeDom();
  if (withBrave) {
    dom.window.navigator.brave = { isBrave() { return Promise.resolve(true); } };
  }
  if (cfg) setBridgeAttr(dom, cfg);
  loadScript(dom, 'inject.js');
  return dom;
}

test('brave-mask removes navigator.brave (Chromium profile)', () => {
  const dom = bootWith(CHROMIUM_CFG);
  assert.strictEqual('brave' in dom.window.navigator, false);
  assert.strictEqual(dom.window.navigator.brave, undefined);
});

test('brave-mask adds document.browsingTopics for Chromium', async () => {
  const dom = bootWith(CHROMIUM_CFG);
  assert.strictEqual('browsingTopics' in dom.window.document, true);
  const topics = await dom.window.document.browsingTopics();
  assert.deepEqual(topics, []);
  assert.match(dom.window.document.browsingTopics.toString(), /\[native code\]/);
});

test('brave-mask does NOT add browsingTopics for non-Chromium (Firefox), still removes brave', () => {
  const dom = bootWith(FIREFOX_CFG);
  assert.strictEqual('browsingTopics' in dom.window.document, false);
  assert.strictEqual('brave' in dom.window.navigator, false);
});

test('brave-mask off leaves navigator.brave intact', () => {
  const dom = bootWith({ ...CHROMIUM_CFG, 'brave-mask': false });
  assert.strictEqual('brave' in dom.window.navigator, true);
});

test('brave-mask re-syncs Topics across a profile switch (reconcile hook)', async () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const dom = bootWith(CHROMIUM_CFG);
  assert.strictEqual('browsingTopics' in dom.window.document, true); // Chrome: present

  // Switch to Firefox -> MutationObserver fires reconcile -> syncTopics removes it.
  setBridgeAttr(dom, FIREFOX_CFG);
  await tick();
  assert.strictEqual('browsingTopics' in dom.window.document, false); // Firefox: gone

  // Switch back to Chrome -> re-added.
  setBridgeAttr(dom, CHROMIUM_CFG);
  await tick();
  assert.strictEqual('browsingTopics' in dom.window.document, true); // Chrome: back
});
