// tests/_harness.mjs - shared JSDOM bootstrap for phantom tests.
// Loads lib.js + a target script into a JSDOM window so phantom install
// targets behave like real browser prototypes.
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

export function makeDom({ url = 'https://example.test/', html = '<!doctype html><html><head></head><body></body></html>' } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'dangerously', pretendToBeVisual: true });
  return dom;
}

export function loadScript(dom, relPath) {
  const code = readFileSync(resolve(ROOT, relPath), 'utf8');
  const script = dom.window.document.createElement('script');
  script.textContent = code;
  dom.window.document.head.appendChild(script);
}

export function setBridgeAttr(dom, payload) {
  dom.window.document.documentElement.setAttribute(
    'data-phantom-shield',
    JSON.stringify(payload)
  );
}
