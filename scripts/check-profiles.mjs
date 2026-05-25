// scripts/check-profiles.mjs - Diff profiles.js values vs curl_cffi BrowserType.
// Fails non-zero if either side has values the other doesn't.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const code = readFileSync('profiles.js', 'utf8');
const ctx = { self: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const ours = new Set(ctx.self.PHANTOM_PROFILES.map((p) => p.value));

const venvPy = '/opt/tls-mitm/venv/bin/python';
const proc = spawnSync(venvPy, ['-c',
  "from curl_cffi.requests import BrowserType; print('\\n'.join(b.value for b in BrowserType))"
], { encoding: 'utf8' });

if (proc.status !== 0) {
  console.error('Could not read curl_cffi BrowserType. Is /opt/tls-mitm/venv set up?');
  console.error(proc.stderr);
  process.exit(2);
}

const theirs = new Set(proc.stdout.trim().split(/\r?\n/));

const missingInCurl = [...ours].filter((v) => !theirs.has(v));
const unusedInExt = [...theirs].filter((v) => !ours.has(v));

if (missingInCurl.length) {
  console.error('Profiles in profiles.js NOT supported by curl_cffi:');
  for (const v of missingInCurl) console.error('  -', v);
}
if (unusedInExt.length && process.env.PHANTOM_REPORT_UNUSED === '1') {
  console.log('curl_cffi BrowserTypes not exposed by profiles.js (informational):');
  for (const v of unusedInExt) console.log('  -', v);
}

if (missingInCurl.length) process.exit(1);
console.log(`All ${ours.size} extension profiles supported by curl_cffi (${theirs.size} total available).`);
