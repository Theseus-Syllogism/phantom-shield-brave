// scripts/generate-profiles-json.mjs - export profiles.js data as JSON for
// the Python package. Run after any edit to profiles.js. CI should verify the
// committed JSON matches the JS source.
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const code = readFileSync(resolve(ROOT, 'profiles.js'), 'utf8');
const ctx = { self: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);

const out = {
  default_profile: ctx.self.DEFAULT_PROFILE,
  default_region: ctx.self.DEFAULT_REGION,
  profiles: ctx.self.PHANTOM_PROFILES,
  regions: ctx.self.PHANTOM_REGIONS,
  resolutions: ctx.self.PHANTOM_RESOLUTIONS,
  webrtc_modes: ctx.self.WEBRTC_MODES,
};

const dest = resolve(ROOT, 'phantom_shield', 'profiles.json');
writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${dest} (${out.profiles.length} profiles, ${out.regions.length} regions, ${out.resolutions.length} resolutions)`);
