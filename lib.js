// lib.js - pure helpers shared between extension runtime and Node tests.
// Loaded as a MAIN-world content script BEFORE inject.js; populates a
// single global `PhantomShieldLib` namespace.
//
// Node tests import this file via vm or fresh JSDOM context.
(function (root) {
  'use strict';

  const lib = {};

  function tzOffsetMinutes(date, timeZone) {
    const fmt = new Intl.DateTimeFormat('en', { timeZone, timeZoneName: 'longOffset' });
    const parts = fmt.formatToParts(date);
    const part = parts.find((p) => p.type === 'timeZoneName');
    if (!part) return 0;
    if (part.value === 'GMT') return 0;
    const m = part.value.match(/GMT([+-])(\d{2}):?(\d{2})?/);
    if (!m) return 0;
    const sign = m[1] === '+' ? 1 : -1;
    const hours = parseInt(m[2], 10);
    const minutes = parseInt(m[3] || '0', 10);
    return -sign * (hours * 60 + minutes);
  }

  lib.tzOffsetMinutes = tzOffsetMinutes;

  function isPrivateAddress(addr) {
    if (!addr || typeof addr !== 'string') return false;
    if (addr.includes(':')) {
      const lower = addr.toLowerCase();
      if (lower === '::1') return true;
      if (lower.startsWith('fe80:') || /^fe[89ab][0-9a-f]:/.test(lower)) return true;
      if (lower.startsWith('fc') || lower.startsWith('fd')) {
        return /^f[cd][0-9a-f]{2}:/.test(lower);
      }
      return false;
    }
    const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    const o = m.slice(1).map((s) => parseInt(s, 10));
    if (o.some((n) => n > 255)) return false;
    if (o[0] === 10) return true;
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;
    if (o[0] === 169 && o[1] === 254) return true;
    if (o[0] === 127) return true;
    return false;
  }

  function extractAddress(candidateLine) {
    if (!candidateLine || typeof candidateLine !== 'string') return null;
    const m = candidateLine.match(/^candidate:\S+\s+\d+\s+(?:UDP|TCP|udp|tcp)\s+\d+\s+(\S+)\s+\d+\s+typ\s/);
    return m ? m[1] : null;
  }

  lib.isPrivateAddress = isPrivateAddress;
  lib.extractAddress = extractAddress;

  function acceptLanguage(langs) {
    if (!Array.isArray(langs) || langs.length === 0) return 'en-US,en;q=0.9';
    return langs
      .map((l, i) => {
        if (i === 0) return l;
        const q = Math.max(0.1, +(1 - i * 0.1).toFixed(1));
        return `${l};q=${q}`;
      })
      .join(',');
  }

  lib.acceptLanguage = acceptLanguage;

  function parseFamilies(font) {
    if (typeof font !== 'string' || !font.trim()) return [];
    if (typeof document === 'undefined') return [];
    try {
      const el = document.createElement('span');
      el.style.font = font;
      const raw = el.style.fontFamily;
      if (!raw) return [];
      return raw.split(',').map((s) =>
        s.trim().replace(/^["']|["']$/g, '').toLowerCase()
      );
    } catch (_) {
      return [];
    }
  }

  lib.parseFamilies = parseFamilies;

  function filterSdp(sdp) {
    if (typeof sdp !== 'string') return sdp;
    const out = [];
    for (const line of sdp.split(/\r?\n/)) {
      if (!line.startsWith('a=candidate:')) {
        out.push(line);
        continue;
      }
      const addr = extractAddress(line.slice(2));
      if (addr && /\.local$/i.test(addr)) {
        out.push(scrubRaddr(line));
        continue;
      }
      if (addr && isPrivateAddress(addr)) continue;
      out.push(scrubRaddr(line));
    }
    return out.join('\r\n');
  }

  function scrubRaddr(candidateLine) {
    return candidateLine.replace(/\sraddr\s(\S+)\srport\s(\d+)/g, (full, addr, port) => {
      if (isPrivateAddress(addr)) return '';
      return full;
    });
  }

  lib.filterSdp = filterSdp;

  // --- Sec-CH-UA client hints -------------------------------------------
  // Low-entropy hints sent on every request; set coherently per profile.
  const CH_LOW = ['Sec-CH-UA', 'Sec-CH-UA-Mobile', 'Sec-CH-UA-Platform'];
  // High-entropy hints (only sent on Accept-CH request); always stripped.
  const CH_HIGH = [
    'Sec-CH-UA-Arch', 'Sec-CH-UA-Bitness', 'Sec-CH-UA-Full-Version',
    'Sec-CH-UA-Full-Version-List', 'Sec-CH-UA-Model',
    'Sec-CH-UA-Platform-Version', 'Sec-CH-UA-WoW64',
  ];

  function secChUaHeader(brands) {
    return (brands || [])
      .map((b) => `"${b.brand}";v="${b.version}"`)
      .join(', ');
  }

  lib.secChUaHeader = secChUaHeader;

  // Build the declarativeNetRequest requestHeaders operations for client hints.
  // Chromium-family profiles (non-empty brands) get the low-entropy trio set
  // coherently and the high-entropy hints removed. Non-Chromium profiles
  // (Firefox/Safari/Tor) get every client hint removed, since those browsers
  // send none. profile = { brands, platform, mobile }.
  function buildClientHintsRequestHeaders(profile) {
    const brands = (profile && profile.brands) || [];
    if (brands.length === 0) {
      return CH_LOW.concat(CH_HIGH).map((h) => ({ header: h, operation: 'remove' }));
    }
    const platform = (profile && profile.platform) || 'Windows';
    return [
      { header: 'Sec-CH-UA', operation: 'set', value: secChUaHeader(brands) },
      { header: 'Sec-CH-UA-Mobile', operation: 'set', value: profile.mobile ? '?1' : '?0' },
      { header: 'Sec-CH-UA-Platform', operation: 'set', value: `"${platform}"` },
    ].concat(CH_HIGH.map((h) => ({ header: h, operation: 'remove' })));
  }

  lib.buildClientHintsRequestHeaders = buildClientHintsRequestHeaders;

  root.PhantomShieldLib = lib;
})(typeof self !== 'undefined' ? self : globalThis);
