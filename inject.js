// MAIN world, document_start.
// All phantoms apply immediately (safe default). Settings arrive async via a
// DOM attribute set by isolated.js; on change we reconcile per-id.
(() => {
  'use strict';

  const ATTR = 'data-phantom-shield';

  // Single source of truth for bridged values. Each phantom reads from this
  // closure on every install / getter invocation, so changes via reconcile()
  // propagate without reinstalling.
  const bridge = {
    ua: null, brands: null, platform: null, mobile: null,
    region: null, tz: null, locale: null, languages: null,
    resolution: null, caps: null,
    webrtcMode: 'mdns', noiseSeed: null,
  };

  const origFnToString = Function.prototype.toString;
  const fakeMap = new WeakMap();

  const proxiedToString = new Proxy(origFnToString, {
    apply(target, thisArg, args) {
      if (fakeMap.has(thisArg)) return fakeMap.get(thisArg);
      return Reflect.apply(target, thisArg, args);
    },
  });
  fakeMap.set(proxiedToString, 'function toString() { [native code] }');
  Function.prototype.toString = proxiedToString;

  function asNative(fn, name) {
    fakeMap.set(fn, `function ${name}() { [native code] }`);
    return fn;
  }

  function methodPhantom(proto, name, impl) {
    if (!proto || !(name in proto)) return null;
    const original = proto[name];
    return {
      install() {
        Object.defineProperty(proto, name, {
          value: asNative(impl, name),
          writable: true, configurable: true, enumerable: true,
        });
      },
      restore() {
        Object.defineProperty(proto, name, {
          value: original,
          writable: true, configurable: true, enumerable: true,
        });
      },
    };
  }

  function getterPhantom(proto, name, getter) {
    if (!proto) return null;
    const origDesc = Object.getOwnPropertyDescriptor(proto, name);
    return {
      install() {
        Object.defineProperty(proto, name, {
          get: asNative(getter, 'get ' + name),
          configurable: true, enumerable: true,
        });
      },
      restore() {
        if (origDesc) Object.defineProperty(proto, name, origDesc);
      },
    };
  }

  const phantoms = {};

  function register(id, build) {
    try {
      const p = build();
      if (p) phantoms[id] = p;
    } catch (_) {}
  }

  register('gamepad', () => methodPhantom(Navigator.prototype, 'getGamepads',
    function getGamepads() { return [null, null, null, null]; }));

  register('bluetooth', () => typeof Bluetooth !== 'undefined'
    ? methodPhantom(Bluetooth.prototype, 'getAvailability',
        function getAvailability() { return Promise.resolve(false); })
    : null);

  register('keyboard', () => typeof Keyboard !== 'undefined'
    ? methodPhantom(Keyboard.prototype, 'getLayoutMap',
        function getLayoutMap() { return Promise.resolve(new Map()); })
    : null);

  register('storage', () => typeof StorageManager !== 'undefined'
    ? methodPhantom(StorageManager.prototype, 'estimate',
        function estimate() {
          return Promise.resolve({ quota: 1073741824, usage: 0, usageDetails: {} });
        })
    : null);

  register('locks', () => typeof LockManager !== 'undefined'
    ? methodPhantom(LockManager.prototype, 'query',
        function query() { return Promise.resolve({ pending: [], held: [] }); })
    : null);

  register('netinfo', () => {
    const fakeConn = Object.freeze({
      effectiveType: '4g', rtt: 50, downlink: 10, downlinkMax: Infinity,
      saveData: false, type: 'unknown', onchange: null,
      addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
    });
    return getterPhantom(Navigator.prototype, 'connection', function () { return fakeConn; });
  });

  register('uadata', () => {
    if (typeof NavigatorUAData === 'undefined' || !NavigatorUAData.prototype.getHighEntropyValues) return null;
    const orig = NavigatorUAData.prototype.getHighEntropyValues;
    const safe = new Set(['brands', 'mobile', 'platform']);
    return methodPhantom(NavigatorUAData.prototype, 'getHighEntropyValues',
      function getHighEntropyValues(hints) {
        const filtered = Array.isArray(hints) ? hints.filter((h) => safe.has(h)) : [];
        return Reflect.apply(orig, this, [filtered]);
      });
  });

  register('memory', () => Performance.prototype.measureUserAgentSpecificMemory
    ? methodPhantom(Performance.prototype, 'measureUserAgentSpecificMemory',
        function measureUserAgentSpecificMemory() {
          return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
        })
    : null);

  // WebGPU: strip info AND coerce features + limits to a baseline so the GPU
  // class (integrated vs discrete, Apple vs AMD vs Nvidia) can't be inferred.
  // Baseline limits come from the WebGPU spec required minimums; features=empty.
  const WEBGPU_MIN_LIMITS = {
    maxTextureDimension1D: 8192, maxTextureDimension2D: 8192, maxTextureDimension3D: 2048,
    maxTextureArrayLayers: 256, maxBindGroups: 4, maxBindGroupsPlusVertexBuffers: 24,
    maxBindingsPerBindGroup: 1000, maxDynamicUniformBuffersPerPipelineLayout: 8,
    maxDynamicStorageBuffersPerPipelineLayout: 4, maxSampledTexturesPerShaderStage: 16,
    maxSamplersPerShaderStage: 16, maxStorageBuffersPerShaderStage: 8,
    maxStorageTexturesPerShaderStage: 4, maxUniformBuffersPerShaderStage: 12,
    maxUniformBufferBindingSize: 65536, maxStorageBufferBindingSize: 134217728,
    minUniformBufferOffsetAlignment: 256, minStorageBufferOffsetAlignment: 256,
    maxVertexBuffers: 8, maxBufferSize: 268435456, maxVertexAttributes: 16,
    maxVertexBufferArrayStride: 2048, maxInterStageShaderComponents: 60,
    maxInterStageShaderVariables: 16, maxColorAttachments: 8,
    maxColorAttachmentBytesPerSample: 32, maxComputeWorkgroupStorageSize: 16384,
    maxComputeInvocationsPerWorkgroup: 256, maxComputeWorkgroupSizeX: 256,
    maxComputeWorkgroupSizeY: 256, maxComputeWorkgroupSizeZ: 64,
    maxComputeWorkgroupsPerDimension: 65535,
  };
  register('webgpu', () => {
    if (typeof GPU === 'undefined' || !GPU.prototype.requestAdapter) return null;
    const origReq = GPU.prototype.requestAdapter;
    const fakeInfo = { vendor: '', architecture: '', device: '', description: '' };
    const fakeFeatures = new Set();
    const fakeLimits = new Proxy(WEBGPU_MIN_LIMITS, {
      get(t, k) { return t[k]; },
      has(t, k) { return k in t; },
      ownKeys(t) { return Reflect.ownKeys(t); },
      getOwnPropertyDescriptor(t, k) {
        if (k in t) return { value: t[k], enumerable: true, configurable: true };
      },
    });
    return methodPhantom(GPU.prototype, 'requestAdapter',
      function requestAdapter(opts) {
        const p = Reflect.apply(origReq, this, [opts]);
        return p.then((adapter) => {
          if (!adapter) return adapter;
          try {
            Object.defineProperty(adapter, 'info', {
              get: asNative(function () { return fakeInfo; }, 'get info'),
              configurable: true,
            });
            Object.defineProperty(adapter, 'features', {
              get: asNative(function () { return fakeFeatures; }, 'get features'),
              configurable: true,
            });
            Object.defineProperty(adapter, 'limits', {
              get: asNative(function () { return fakeLimits; }, 'get limits'),
              configurable: true,
            });
            if (typeof adapter.requestAdapterInfo === 'function') {
              Object.defineProperty(adapter, 'requestAdapterInfo', {
                value: asNative(function requestAdapterInfo() {
                  return Promise.resolve(fakeInfo);
                }, 'requestAdapterInfo'),
                writable: true, configurable: true,
              });
            }
          } catch (_) {}
          return adapter;
        });
      });
  });

  // ─── Tier 1 ──────────────────────────────────────────────────────────────

  // performance.memory - JS heap fingerprint. Pin to a common ~2 GiB class.
  register('perfmem', () => {
    const desc = Object.getOwnPropertyDescriptor(Performance.prototype, 'memory');
    if (!desc) return null;
    const fake = Object.freeze({
      jsHeapSizeLimit: 2172649472,
      totalJSHeapSize: 35000000,
      usedJSHeapSize: 25000000,
    });
    return {
      install() {
        Object.defineProperty(Performance.prototype, 'memory', {
          get: asNative(function () { return fake; }, 'get memory'),
          configurable: true, enumerable: true,
        });
      },
      restore() { Object.defineProperty(Performance.prototype, 'memory', desc); },
    };
  });

  // WebHID / WebSerial / WebUSB - empty device lists.
  register('hid', () => typeof HID !== 'undefined'
    ? methodPhantom(HID.prototype, 'getDevices',
        function getDevices() { return Promise.resolve([]); })
    : null);

  register('serial', () => typeof Serial !== 'undefined'
    ? methodPhantom(Serial.prototype, 'getPorts',
        function getPorts() { return Promise.resolve([]); })
    : null);

  register('usb', () => typeof USB !== 'undefined'
    ? methodPhantom(USB.prototype, 'getDevices',
        function getDevices() { return Promise.resolve([]); })
    : null);

  // Installed related PWAs - strong cross-site identifier when populated.
  register('installedapps', () =>
    Navigator.prototype.getInstalledRelatedApps
      ? methodPhantom(Navigator.prototype, 'getInstalledRelatedApps',
          function getInstalledRelatedApps() { return Promise.resolve([]); })
      : null);

  // MediaCapabilities: preserve `supported` (so playback selection still works),
  // but kill the HW-decode signal: always report smooth=false, powerEfficient=false.
  register('mediacaps', () => {
    if (typeof MediaCapabilities === 'undefined') return null;
    const origDec = MediaCapabilities.prototype.decodingInfo;
    const origEnc = MediaCapabilities.prototype.encodingInfo;
    const wrap = (orig, name) => methodPhantom(MediaCapabilities.prototype, name,
      function (cfg) {
        return Reflect.apply(orig, this, [cfg]).then((r) => ({
          ...r, smooth: false, powerEfficient: false,
        })).catch(() => ({ supported: false, smooth: false, powerEfficient: false }));
      });
    const dec = wrap(origDec, 'decodingInfo');
    const enc = wrap(origEnc, 'encodingInfo');
    if (!dec || !enc) return null;
    return {
      install() { dec.install(); enc.install(); },
      restore() { dec.restore(); enc.restore(); },
    };
  });

  // RTCRtpSender/Receiver.getCapabilities - codec/RTX/FEC support list is a
  // strong WebRTC-side fingerprint. Filter to a minimal universal baseline.
  register('rtccaps', () => {
    if (typeof RTCRtpSender === 'undefined' || !RTCRtpSender.getCapabilities) return null;
    const KEEP_AUDIO = new Set(['audio/opus', 'audio/PCMU', 'audio/PCMA', 'audio/G722']);
    const KEEP_VIDEO = new Set(['video/VP8', 'video/VP9', 'video/H264', 'video/AV1']);
    const KEEP_EXT = new Set([
      'urn:ietf:params:rtp-hdrext:sdes:mid',
      'urn:ietf:params:rtp-hdrext:ssrc-audio-level',
    ]);
    const origSend = RTCRtpSender.getCapabilities;
    const origRecv = RTCRtpReceiver.getCapabilities;
    const filter = (caps, kind) => {
      if (!caps) return caps;
      const allow = kind === 'audio' ? KEEP_AUDIO : KEEP_VIDEO;
      return {
        codecs: (caps.codecs || []).filter((c) => allow.has(c.mimeType)),
        headerExtensions: (caps.headerExtensions || []).filter((h) => KEEP_EXT.has(h.uri)),
      };
    };
    const sendFn = asNative(function getCapabilities(kind) {
      return filter(Reflect.apply(origSend, null, [kind]), kind);
    }, 'getCapabilities');
    const recvFn = asNative(function getCapabilities(kind) {
      return filter(Reflect.apply(origRecv, null, [kind]), kind);
    }, 'getCapabilities');
    return {
      install() {
        RTCRtpSender.getCapabilities = sendFn;
        RTCRtpReceiver.getCapabilities = recvFn;
      },
      restore() {
        RTCRtpSender.getCapabilities = origSend;
        RTCRtpReceiver.getCapabilities = origRecv;
      },
    };
  });

  // ─── Tier 2 ──────────────────────────────────────────────────────────────

  register('screenextended', () => 'isExtended' in Screen.prototype
    ? getterPhantom(Screen.prototype, 'isExtended', function () { return false; })
    : null);

  register('vkeyboard', () => {
    if (typeof VirtualKeyboard === 'undefined') return null;
    const zero = new DOMRect(0, 0, 0, 0);
    return getterPhantom(VirtualKeyboard.prototype, 'boundingRect', function () { return zero; });
  });

  register('wakelock', () => typeof WakeLock !== 'undefined'
    ? methodPhantom(WakeLock.prototype, 'request',
        function request() {
          return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
        })
    : null);

  // IdleDetector: keep constructor (presence is a Chrome/Brave feature signal
  // that hiding would itself fingerprint), but make probes consistently report
  // "denied" - matches a user who refused permission.
  register('idle', () => {
    if (typeof IdleDetector === 'undefined') return null;
    const origRP = IdleDetector.requestPermission;
    const origStart = IdleDetector.prototype.start;
    const rp = asNative(function requestPermission() { return Promise.resolve('denied'); }, 'requestPermission');
    const start = asNative(function start() {
      return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
    }, 'start');
    return {
      install() {
        IdleDetector.requestPermission = rp;
        Object.defineProperty(IdleDetector.prototype, 'start', {
          value: start, writable: true, configurable: true,
        });
      },
      restore() {
        IdleDetector.requestPermission = origRP;
        Object.defineProperty(IdleDetector.prototype, 'start', {
          value: origStart, writable: true, configurable: true,
        });
      },
    };
  });

  register('pressure', () => typeof PressureObserver !== 'undefined'
    ? methodPhantom(PressureObserver.prototype, 'observe',
        function observe() {
          return Promise.reject(new DOMException('Not allowed', 'NotAllowedError'));
        })
    : null);

  // All sensor classes inherit from Sensor; one prototype hook covers
  // Accelerometer, Gyroscope, Magnetometer, LinearAccelerationSensor,
  // GravitySensor, Absolute/RelativeOrientationSensor, AmbientLightSensor.
  register('sensors', () => typeof Sensor !== 'undefined'
    ? methodPhantom(Sensor.prototype, 'start', function start() {
        const ev = new Event('error');
        queueMicrotask(() => { try { this.dispatchEvent(ev); } catch (_) {} });
      })
    : null);

  // ─── Custom UA / profile coherence ───────────────────────────────────────
  // The TLS profile selected in the popup (via the mitmproxy bridge) drives
  // upstream JA3/JA4 + HTTP UA. To keep JS-visible navigator.* coherent with
  // what the network sees, we mirror the same UA/platform/brands here.
  //
  // Values arrive from isolated.js via the bridge attribute under __ua/__brands/
  // __platform/__mobile. The phantom installs only if a non-null UA was pushed.
  // It's installed/restored on every reconcile so changing profile in the popup
  // applies on next page load without needing a new phantom registration.
  let uaInstalledState = null;
  function applyUA(ua, brands, platform, mobile) {
    if (!ua) return;
    try {
      Object.defineProperty(Navigator.prototype, 'userAgent', {
        get: asNative(function () { return ua; }, 'get userAgent'),
        configurable: true,
      });
    } catch (_) {}
    try {
      Object.defineProperty(Navigator.prototype, 'platform', {
        get: asNative(function () {
          if (platform === 'Windows') return 'Win32';
          if (platform === 'macOS') return 'MacIntel';
          if (platform === 'iOS') return 'iPhone';
          if (platform === 'Android') return 'Linux armv8l';
          return 'Linux x86_64';
        }, 'get platform'),
        configurable: true,
      });
    } catch (_) {}
    if (brands && navigator.userAgentData) {
      try {
        const fakeData = Object.create(NavigatorUAData.prototype);
        Object.defineProperty(fakeData, 'brands', { get: () => brands, configurable: true });
        Object.defineProperty(fakeData, 'mobile', { get: () => !!mobile, configurable: true });
        Object.defineProperty(fakeData, 'platform', { get: () => platform || '', configurable: true });
        fakeData.getHighEntropyValues = asNative(function (hints) {
          const out = { brands, mobile: !!mobile, platform: platform || '' };
          return Promise.resolve(out);
        }, 'getHighEntropyValues');
        fakeData.toJSON = function () { return { brands, mobile: !!mobile, platform: platform || '' }; };
        Object.defineProperty(Navigator.prototype, 'userAgentData', {
          get: asNative(function () { return fakeData; }, 'get userAgentData'),
          configurable: true,
        });
      } catch (_) {}
    }
    uaInstalledState = { ua, brands, platform, mobile };
  }
  function clearUA() {
    if (!uaInstalledState) return;
    try { delete Navigator.prototype.userAgent; } catch (_) {}
    try { delete Navigator.prototype.platform; } catch (_) {}
    try { delete Navigator.prototype.userAgentData; } catch (_) {}
    uaInstalledState = null;
  }

  // matchMedia accessibility queries - coerce high-entropy a11y axes to default.
  // Leaving (prefers-color-scheme), (pointer), (hover) alone since lying there
  // breaks layout without much fingerprint gain.
  register('matchmedia', () => {
    const orig = Window.prototype.matchMedia;
    if (!orig) return null;
    const COERCE = {
      '(prefers-reduced-motion: reduce)': false,
      '(prefers-reduced-motion: no-preference)': true,
      '(prefers-reduced-transparency: reduce)': false,
      '(prefers-reduced-transparency: no-preference)': true,
      '(prefers-reduced-data: reduce)': false,
      '(prefers-reduced-data: no-preference)': true,
      '(prefers-contrast: more)': false,
      '(prefers-contrast: less)': false,
      '(prefers-contrast: custom)': false,
      '(prefers-contrast: no-preference)': true,
      '(forced-colors: active)': false,
      '(forced-colors: none)': true,
      '(inverted-colors: inverted)': false,
      '(inverted-colors: none)': true,
    };
    return methodPhantom(Window.prototype, 'matchMedia', function matchMedia(q) {
      const result = Reflect.apply(orig, this, [q]);
      if (typeof q === 'string' && q in COERCE) {
        try {
          Object.defineProperty(result, 'matches', {
            get: asNative(function () { return COERCE[q]; }, 'get matches'),
            configurable: true,
          });
        } catch (_) {}
      }
      return result;
    });
  });

  // ─── Tier 3 - coherence ───────────────────────────────────────────────────

  register('intl-locale', () => {
    // Capture originals at registration time (not install) so double-install
    // can't pollute them.
    const origLang = Object.getOwnPropertyDescriptor(Navigator.prototype, 'language');
    const origLangs = Object.getOwnPropertyDescriptor(Navigator.prototype, 'languages');
    return {
      install() {
        // No early-return on null bridge.languages: phantoms install at IIFE
        // time (before bridge state arrives). Getters fall back to the real
        // browser value until bridge arrives, then transparently switch.
        Object.defineProperty(Navigator.prototype, 'language', {
          get: asNative(function () {
            if (bridge.languages && bridge.languages.length) return bridge.languages[0];
            return origLang && origLang.get ? Reflect.apply(origLang.get, this, []) : undefined;
          }, 'get language'),
          configurable: true, enumerable: true,
        });
        Object.defineProperty(Navigator.prototype, 'languages', {
          get: asNative(function () {
            if (bridge.languages) return Object.freeze([...bridge.languages]);
            return origLangs && origLangs.get ? Reflect.apply(origLangs.get, this, []) : [];
          }, 'get languages'),
          configurable: true, enumerable: true,
        });
      },
      restore() {
        if (origLang) Object.defineProperty(Navigator.prototype, 'language', origLang);
        if (origLangs) Object.defineProperty(Navigator.prototype, 'languages', origLangs);
      },
    };
  });

  register('intl-tz', () => {
    const { tzOffsetMinutes } = self.PhantomShieldLib;
    const origGetTzOff = Date.prototype.getTimezoneOffset;
    const origDtfCtor = Intl.DateTimeFormat;
    const origDtfResolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    const explicitTz = new WeakSet();

    function wrappedDtf(locales, options) {
      const opts = options ? { ...options } : {};
      const hadTz = 'timeZone' in opts && opts.timeZone;
      if (!hadTz && bridge.tz) opts.timeZone = bridge.tz;
      const inst = Reflect.construct(origDtfCtor, [locales, opts], new.target || origDtfCtor);
      if (hadTz) explicitTz.add(inst);
      return inst;
    }
    asNative(wrappedDtf, 'DateTimeFormat');
    Object.setPrototypeOf(wrappedDtf, origDtfCtor);
    wrappedDtf.prototype = origDtfCtor.prototype;
    wrappedDtf.supportedLocalesOf = origDtfCtor.supportedLocalesOf.bind(origDtfCtor);

    return {
      install() {
        // Always install - wrappers read bridge.tz live and fall through to
        // the originals when it's null (IIFE-time install before bridge arrives).
        Object.defineProperty(Date.prototype, 'getTimezoneOffset', {
          value: asNative(function getTimezoneOffset() {
            if (bridge.tz) return tzOffsetMinutes(this, bridge.tz);
            return Reflect.apply(origGetTzOff, this, []);
          }, 'getTimezoneOffset'),
          writable: true, configurable: true,
        });
        Intl.DateTimeFormat = wrappedDtf;
        Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
          value: asNative(function resolvedOptions() {
            const out = Reflect.apply(origDtfResolved, this, []);
            if (!explicitTz.has(this) && bridge.tz) out.timeZone = bridge.tz;
            return out;
          }, 'resolvedOptions'),
          writable: true, configurable: true,
        });
      },
      restore() {
        Object.defineProperty(Date.prototype, 'getTimezoneOffset', {
          value: origGetTzOff, writable: true, configurable: true,
        });
        Intl.DateTimeFormat = origDtfCtor;
        Object.defineProperty(Intl.DateTimeFormat.prototype, 'resolvedOptions', {
          value: origDtfResolved, writable: true, configurable: true,
        });
      },
    };
  });

  register('intl-collator', () => {
    const targets = [
      'Collator', 'NumberFormat', 'RelativeTimeFormat',
      'PluralRules', 'ListFormat', 'Segmenter', 'DisplayNames',
    ].filter((n) => typeof Intl[n] === 'function');
    const saved = {};
    const explicitLoc = new WeakSet();

    return {
      install() {
        // No early-return on null bridge.locale: install always runs. The
        // wrapper passes locales through unchanged when bridge.locale is null,
        // and only overrides when a bridge locale exists.
        for (const name of targets) {
          const Ctor = Intl[name];
          const origResolved = Ctor.prototype.resolvedOptions;
          const orig = Ctor;

          function wrapped(locales, options) {
            const hadLoc = locales !== undefined && locales !== null
              && !(Array.isArray(locales) && locales.length === 0);
            // hadLoc → pass caller's locale through.
            // !hadLoc + bridge.locale → inject ours.
            // !hadLoc + !bridge.locale → pass undefined through (browser default).
            const useLoc = hadLoc ? locales : (bridge.locale ? [bridge.locale] : locales);
            const inst = Reflect.construct(orig, [useLoc, options], new.target || orig);
            if (hadLoc) explicitLoc.add(inst);
            return inst;
          }
          asNative(wrapped, name);
          Object.setPrototypeOf(wrapped, orig);
          wrapped.prototype = orig.prototype;
          if (orig.supportedLocalesOf) {
            wrapped.supportedLocalesOf = orig.supportedLocalesOf.bind(orig);
          }

          Intl[name] = wrapped;
          Object.defineProperty(orig.prototype, 'resolvedOptions', {
            value: asNative(function resolvedOptions() {
              const out = Reflect.apply(origResolved, this, []);
              if (!explicitLoc.has(this) && bridge.locale) out.locale = bridge.locale;
              return out;
            }, 'resolvedOptions'),
            writable: true, configurable: true,
          });

          saved[name] = { orig, origResolved };
        }
      },
      restore() {
        for (const name of Object.keys(saved)) {
          const { orig, origResolved } = saved[name];
          Intl[name] = orig;
          Object.defineProperty(orig.prototype, 'resolvedOptions', {
            value: origResolved, writable: true, configurable: true,
          });
        }
      },
    };
  });

  register('screen-dims', () => {
    const props = ['width', 'height', 'availWidth', 'availHeight'];
    // Capture originals at registration time so a double-install can't
    // overwrite them with the wrapped descriptors.
    const saved = {};
    for (const p of props) saved[p] = Object.getOwnPropertyDescriptor(Screen.prototype, p);
    return {
      install() {
        // Always install; getter falls back to the real screen dim if bridge
        // hasn't arrived yet.
        for (const p of props) {
          Object.defineProperty(Screen.prototype, p, {
            get: asNative(function () {
              if (bridge.resolution) return bridge.resolution[p];
              return saved[p] && saved[p].get ? Reflect.apply(saved[p].get, this, []) : 0;
            }, `get ${p}`),
            configurable: true, enumerable: true,
          });
        }
      },
      restore() {
        for (const p of props) {
          if (saved[p]) Object.defineProperty(Screen.prototype, p, saved[p]);
        }
      },
    };
  });

  register('screen-color', () => {
    const origCD = Object.getOwnPropertyDescriptor(Screen.prototype, 'colorDepth');
    const origPD = Object.getOwnPropertyDescriptor(Screen.prototype, 'pixelDepth');
    return {
      install() {
        Object.defineProperty(Screen.prototype, 'colorDepth', {
          get: asNative(function () { return bridge.resolution?.colorDepth ?? 24; }, 'get colorDepth'),
          configurable: true, enumerable: true,
        });
        Object.defineProperty(Screen.prototype, 'pixelDepth', {
          get: asNative(function () { return bridge.resolution?.pixelDepth ?? 24; }, 'get pixelDepth'),
          configurable: true, enumerable: true,
        });
      },
      restore() {
        if (origCD) Object.defineProperty(Screen.prototype, 'colorDepth', origCD);
        if (origPD) Object.defineProperty(Screen.prototype, 'pixelDepth', origPD);
      },
    };
  });

  register('dpr', () => {
    const orig = Object.getOwnPropertyDescriptor(Window.prototype, 'devicePixelRatio')
              || Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    return {
      install() {
        Object.defineProperty(window, 'devicePixelRatio', {
          get: asNative(function () { return bridge.resolution?.dpr ?? 1; }, 'get devicePixelRatio'),
          configurable: true, enumerable: true,
        });
      },
      restore() {
        if (orig) Object.defineProperty(window, 'devicePixelRatio', orig);
      },
    };
  });

  register('screen-orient', () => {
    if (!('orientation' in screen)) return null;
    const orig = Object.getOwnPropertyDescriptor(Screen.prototype, 'orientation');
    return {
      install() {
        Object.defineProperty(Screen.prototype, 'orientation', {
          // Rebuild on each access so changing resolution propagates without
          // requiring a phantom reinstall. (Real ScreenOrientation is a
          // singleton; rebuilding loses identity equality but no fingerprinter
          // we care about checks that.)
          get: asNative(function () {
            return Object.freeze({
              type: bridge.resolution?.orientation || 'landscape-primary',
              angle: bridge.resolution?.orientationAngle ?? 0,
              onchange: null,
              addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
              lock() { return Promise.reject(new DOMException('Not allowed', 'NotAllowedError')); },
              unlock() {},
            });
          }, 'get orientation'),
          configurable: true, enumerable: true,
        });
      },
      restore() {
        if (orig) Object.defineProperty(Screen.prototype, 'orientation', orig);
      },
    };
  });

  function navGetter(id, prop, capKey, fallback) {
    register(id, () => {
      const orig = Object.getOwnPropertyDescriptor(Navigator.prototype, prop);
      return {
        install() {
          Object.defineProperty(Navigator.prototype, prop, {
            get: asNative(function () {
              const v = bridge.caps?.[capKey];
              return v === undefined ? fallback : v;
            }, `get ${prop}`),
            configurable: true, enumerable: true,
          });
        },
        restore() { if (orig) Object.defineProperty(Navigator.prototype, prop, orig); },
      };
    });
  }

  navGetter('nav-hwconc',    'hardwareConcurrency', 'hwConcurrency', 8);
  navGetter('nav-devmem',    'deviceMemory',        'deviceMemory',  8);
  navGetter('nav-touch',     'maxTouchPoints',      'maxTouchPoints', 0);
  navGetter('nav-pdf',       'pdfViewerEnabled',    'pdfViewerEnabled', true);
  navGetter('nav-webdriver', 'webdriver',           'webdriver',     false);

  register('nav-vendor', () => {
    const props = ['vendor', 'vendorSub', 'productSub'];
    // Capture originals at registration time so a double-install can't pollute.
    const saved = {};
    for (const p of props) saved[p] = Object.getOwnPropertyDescriptor(Navigator.prototype, p);
    return {
      install() {
        for (const p of props) {
          Object.defineProperty(Navigator.prototype, p, {
            get: asNative(function () {
              if (bridge.caps && p in bridge.caps) return bridge.caps[p];
              return saved[p] && saved[p].get ? Reflect.apply(saved[p].get, this, []) : '';
            }, `get ${p}`),
            configurable: true, enumerable: true,
          });
        }
      },
      restore() {
        for (const p of props) {
          if (saved[p]) Object.defineProperty(Navigator.prototype, p, saved[p]);
        }
      },
    };
  });

  register('nav-appver', () => {
    const orig = Object.getOwnPropertyDescriptor(Navigator.prototype, 'appVersion');
    return {
      install() {
        Object.defineProperty(Navigator.prototype, 'appVersion', {
          get: asNative(function () {
            const ua = bridge.ua || navigator.userAgent;
            return ua.replace(/^Mozilla\//, '');
          }, 'get appVersion'),
          configurable: true, enumerable: true,
        });
      },
      restore() { if (orig) Object.defineProperty(Navigator.prototype, 'appVersion', orig); },
    };
  });

  register('webrtc-leak', () => {
    if (typeof RTCPeerConnection === 'undefined') return null;
    const { isPrivateAddress, extractAddress, filterSdp } = self.PhantomShieldLib;
    const OrigPC = window.RTCPeerConnection;
    const OrigWPC = window.webkitRTCPeerConnection;
    let installed = false;
    let PhantomPC = null;

    function buildPhantomPC() {
      class _PhantomPC extends OrigPC {
        constructor(config, ...rest) {
          const mode = bridge.webrtcMode || 'mdns';
          if (mode === 'relay' && config) {
            config = { ...config, iceTransportPolicy: 'relay' };
          } else if (mode === 'relay' && !config) {
            config = { iceTransportPolicy: 'relay' };
          }
          super(config, ...rest);
          if (mode === 'mdns') wrapIceEvents(this);
        }
        setConfiguration(config) {
          const mode = bridge.webrtcMode || 'mdns';
          if (mode === 'relay') config = { ...(config || {}), iceTransportPolicy: 'relay' };
          return super.setConfiguration(config);
        }
        get localDescription()        { return maybeFilterDesc(super.localDescription); }
        get pendingLocalDescription() { return maybeFilterDesc(super.pendingLocalDescription); }
        get currentLocalDescription() { return maybeFilterDesc(super.currentLocalDescription); }
      }
      Object.defineProperty(_PhantomPC, 'name', { value: 'RTCPeerConnection' });
      // Without this, RTCPeerConnection.toString() returns the class source
      // - a clear tell to fingerprinting libs that the constructor is wrapped.
      asNative(_PhantomPC, 'RTCPeerConnection');
      return _PhantomPC;
    }

    function maybeFilterDesc(desc) {
      if (!desc || (bridge.webrtcMode || 'mdns') !== 'mdns') return desc;
      return { type: desc.type, sdp: filterSdp(desc.sdp), toJSON() { return { type: this.type, sdp: this.sdp }; } };
    }

    function isLeaky(cand) {
      // If mode flipped away from 'mdns' after this PC was constructed, the
      // event listeners are still wrapped - but we shouldn't filter anything.
      if ((bridge.webrtcMode || 'mdns') !== 'mdns') return false;
      if (!cand || !cand.candidate) return false;
      const addr = cand.address || extractAddress(cand.candidate);
      if (!addr) return false;
      if (/\.local$/i.test(addr)) return false;
      return isPrivateAddress(addr);
    }

    function wrapIceEvents(pc) {
      const origAdd = pc.addEventListener.bind(pc);
      const origRem = pc.removeEventListener.bind(pc);
      const wrappers = new WeakMap();

      pc.addEventListener = asNative(function addEventListener(type, listener, opts) {
        if (type === 'icecandidate' && typeof listener === 'function') {
          const w = function (e) { if (!isLeaky(e.candidate)) listener.call(this, e); };
          wrappers.set(listener, w);
          return origAdd(type, w, opts);
        }
        return origAdd(type, listener, opts);
      }, 'addEventListener');

      pc.removeEventListener = asNative(function removeEventListener(type, listener, opts) {
        if (type === 'icecandidate' && wrappers.has(listener)) {
          return origRem(type, wrappers.get(listener), opts);
        }
        return origRem(type, listener, opts);
      }, 'removeEventListener');

      let userHandler = null;
      const origDesc = Object.getOwnPropertyDescriptor(OrigPC.prototype, 'onicecandidate');
      Object.defineProperty(pc, 'onicecandidate', {
        get: asNative(function () { return userHandler; }, 'get onicecandidate'),
        set: asNative(function (fn) {
          userHandler = fn;
          if (typeof fn !== 'function') {
            origDesc.set.call(pc, fn);
            return;
          }
          const filtered = function (e) { if (!isLeaky(e.candidate)) fn.call(this, e); };
          origDesc.set.call(pc, filtered);
        }, 'set onicecandidate'),
        configurable: true, enumerable: true,
      });
    }

    return {
      install() {
        if (installed) return;
        PhantomPC = buildPhantomPC();
        Object.defineProperty(window, 'RTCPeerConnection', {
          value: PhantomPC, writable: true, configurable: true,
        });
        if (OrigWPC) {
          Object.defineProperty(window, 'webkitRTCPeerConnection', {
            value: PhantomPC, writable: true, configurable: true,
          });
        }
        installed = true;
      },
      restore() {
        if (!installed) return;
        Object.defineProperty(window, 'RTCPeerConnection', {
          value: OrigPC, writable: true, configurable: true,
        });
        if (OrigWPC) {
          Object.defineProperty(window, 'webkitRTCPeerConnection', {
            value: OrigWPC, writable: true, configurable: true,
          });
        }
        installed = false;
      },
    };
  });

  register('fonts', () => {
    if (typeof FontFaceSet === 'undefined' || !document.fonts) return null;
    const { parseFamilies } = self.PhantomShieldLib;
    const proto = FontFaceSet.prototype;
    const origCheck     = proto.check;
    const origAdd       = proto.add;
    const origDelete    = proto.delete;
    const origForEach   = proto.forEach;
    const origEntries   = proto.entries;
    const origValues    = proto.values;
    const origKeys      = proto.keys;
    const origIter      = proto[Symbol.iterator];
    const origSizeDesc  = Object.getOwnPropertyDescriptor(proto, 'size');
    const ownAdded = new WeakMap();

    function getOwn(set) {
      let s = ownAdded.get(set);
      if (!s) { s = new Set(); ownAdded.set(set, s); }
      return s;
    }

    function platform() { return bridge.platform || 'Windows'; }

    function baselineSet() {
      const plat = platform();
      const list = (typeof FONT_BASELINE !== 'undefined' && FONT_BASELINE[plat]) || [];
      return new Set([...list, ...FONT_GENERICS].map((s) => String(s).toLowerCase()));
    }

    function isAllowed(set, family) {
      const f = family.toLowerCase().replace(/^["']|["']$/g, '');
      return baselineSet().has(f) || getOwn(set).has(f);
    }

    function syntheticFaces() {
      const plat = platform();
      const list = (typeof FONT_BASELINE !== 'undefined' && FONT_BASELINE[plat]) || [];
      return list.map((family) => {
        const face = new FontFace(family, `local("${family}")`, { style: 'normal', weight: '400' });
        try {
          Object.defineProperty(face, 'status', { value: 'loaded', configurable: true });
        } catch (_) {}
        return face;
      });
    }

    function pageAddedFaces(set) {
      const out = [];
      const own = getOwn(set);
      const iter = Reflect.apply(origIter, set, []);
      for (const face of iter) {
        const f = String(face.family || '').toLowerCase().replace(/^["']|["']$/g, '');
        if (own.has(f)) out.push(face);
      }
      return out;
    }

    function unionList(set) {
      return [...syntheticFaces(), ...pageAddedFaces(set)];
    }

    return {
      install() {
        proto.check = asNative(function check(font, text) {
          const fams = parseFamilies(font);
          if (fams.length === 0) return Reflect.apply(origCheck, this, [font, text]);
          return fams.every((f) => isAllowed(this, f));
        }, 'check');

        proto.add = asNative(function add(face) {
          getOwn(this).add(String(face.family || '').toLowerCase().replace(/^["']|["']$/g, ''));
          return Reflect.apply(origAdd, this, [face]);
        }, 'add');

        proto.delete = asNative(function _delete(face) {
          getOwn(this).delete(String(face.family || '').toLowerCase().replace(/^["']|["']$/g, ''));
          return Reflect.apply(origDelete, this, [face]);
        }, 'delete');

        proto.forEach = asNative(function forEach(cb, thisArg) {
          for (const face of unionList(this)) cb.call(thisArg, face, face, this);
        }, 'forEach');

        proto.values = asNative(function values() { return unionList(this)[Symbol.iterator](); }, 'values');
        proto.keys   = asNative(function keys()   { return unionList(this)[Symbol.iterator](); }, 'keys');
        proto.entries = asNative(function entries() {
          return unionList(this).map((f) => [f, f])[Symbol.iterator]();
        }, 'entries');
        proto[Symbol.iterator] = asNative(function () {
          return unionList(this)[Symbol.iterator]();
        }, '@@iterator');

        Object.defineProperty(proto, 'size', {
          get: asNative(function () { return unionList(this).length; }, 'get size'),
          configurable: true, enumerable: true,
        });
      },
      restore() {
        proto.check = origCheck; proto.add = origAdd; proto.delete = origDelete;
        proto.forEach = origForEach; proto.entries = origEntries;
        proto.values = origValues; proto.keys = origKeys;
        proto[Symbol.iterator] = origIter;
        if (origSizeDesc) Object.defineProperty(proto, 'size', origSizeDesc);
      },
    };
  });

  register('double-noise', () => {
    function seedBytes() {
      if (!bridge.noiseSeed) return null;
      try {
        return Uint8Array.from(atob(bridge.noiseSeed), (c) => c.charCodeAt(0));
      } catch (_) { return null; }
    }

    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const origToBlob    = HTMLCanvasElement.prototype.toBlob;
    const orig2DGet     = CanvasRenderingContext2D.prototype.getImageData;
    const origGLRead    = (typeof WebGLRenderingContext !== 'undefined')
      ? WebGLRenderingContext.prototype.readPixels : null;
    const origGL2Read   = (typeof WebGL2RenderingContext !== 'undefined')
      ? WebGL2RenderingContext.prototype.readPixels : null;

    const origAudioGetCh = (typeof AudioBuffer !== 'undefined') ? AudioBuffer.prototype.getChannelData : null;
    const origAnalyserFreqF = (typeof AnalyserNode !== 'undefined') ? AnalyserNode.prototype.getFloatFrequencyData : null;
    const origAnalyserFreqB = (typeof AnalyserNode !== 'undefined') ? AnalyserNode.prototype.getByteFrequencyData : null;
    const origAnalyserTimeF = (typeof AnalyserNode !== 'undefined') ? AnalyserNode.prototype.getFloatTimeDomainData : null;
    const origAnalyserTimeB = (typeof AnalyserNode !== 'undefined') ? AnalyserNode.prototype.getByteTimeDomainData : null;

    function perturbImageData(imgData) {
      const seed = seedBytes(); if (!seed) return imgData;
      const data = imgData.data;
      for (let i = 0; i < data.length; i += 4) {
        data[i] ^= seed[(i >> 2) & 63] & 1;
      }
      return imgData;
    }

    function perturbCanvas(canvas) {
      const w = canvas.width, h = canvas.height;
      if (!w || !h) return canvas;
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const ctx = off.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      // Use the original getImageData directly - if our wrapper is already
      // installed, calling ctx.getImageData would double-perturb (the wrapper
      // applies noise, then perturbImageData applies it again).
      const img = Reflect.apply(orig2DGet, ctx, [0, 0, w, h]);
      perturbImageData(img);
      ctx.putImageData(img, 0, 0);
      return off;
    }

    return {
      install() {
        HTMLCanvasElement.prototype.toDataURL = asNative(function toDataURL(...args) {
          return Reflect.apply(origToDataURL, perturbCanvas(this), args);
        }, 'toDataURL');
        HTMLCanvasElement.prototype.toBlob = asNative(function toBlob(cb, ...rest) {
          return Reflect.apply(origToBlob, perturbCanvas(this), [cb, ...rest]);
        }, 'toBlob');
        CanvasRenderingContext2D.prototype.getImageData = asNative(function getImageData(...args) {
          const img = Reflect.apply(orig2DGet, this, args);
          return perturbImageData(img);
        }, 'getImageData');
        if (origGLRead) {
          WebGLRenderingContext.prototype.readPixels = asNative(function readPixels(x, y, w, h, fmt, type, pixels, ...rest) {
            const r = Reflect.apply(origGLRead, this, [x, y, w, h, fmt, type, pixels, ...rest]);
            const seed = seedBytes();
            if (seed && pixels && pixels.length) {
              for (let i = 0; i < pixels.length; i += 4) pixels[i] ^= seed[(i >> 2) & 63] & 1;
            }
            return r;
          }, 'readPixels');
        }
        if (origGL2Read) {
          WebGL2RenderingContext.prototype.readPixels = asNative(function readPixels(x, y, w, h, fmt, type, pixels, ...rest) {
            const r = Reflect.apply(origGL2Read, this, [x, y, w, h, fmt, type, pixels, ...rest]);
            const seed = seedBytes();
            if (seed && pixels && pixels.length) {
              for (let i = 0; i < pixels.length; i += 4) pixels[i] ^= seed[(i >> 2) & 63] & 1;
            }
            return r;
          }, 'readPixels');
        }
        if (origAudioGetCh) {
          AudioBuffer.prototype.getChannelData = asNative(function getChannelData(channel) {
            const real = Reflect.apply(origAudioGetCh, this, [channel]);
            const seed = seedBytes();
            if (!seed) return real;
            const out = new Float32Array(real);
            const epsilon = 1 / (1 << 24);
            for (let i = 0; i < out.length; i += 199) {
              out[i] += (seed[i & 63] & 1) ? epsilon : -epsilon;
            }
            return out;
          }, 'getChannelData');
        }
        if (origAnalyserFreqF) {
          AnalyserNode.prototype.getFloatFrequencyData = asNative(function getFloatFrequencyData(array) {
            Reflect.apply(origAnalyserFreqF, this, [array]);
            const seed = seedBytes();
            if (seed) for (let i = 0; i < array.length; i += 53) array[i] += (seed[i & 63] & 1) ? 0.0001 : -0.0001;
          }, 'getFloatFrequencyData');
        }
        if (origAnalyserFreqB) {
          AnalyserNode.prototype.getByteFrequencyData = asNative(function getByteFrequencyData(array) {
            Reflect.apply(origAnalyserFreqB, this, [array]);
            const seed = seedBytes();
            if (seed) for (let i = 0; i < array.length; i += 53) array[i] ^= seed[i & 63] & 1;
          }, 'getByteFrequencyData');
        }
        if (origAnalyserTimeF) {
          AnalyserNode.prototype.getFloatTimeDomainData = asNative(function getFloatTimeDomainData(array) {
            Reflect.apply(origAnalyserTimeF, this, [array]);
            const seed = seedBytes();
            if (seed) for (let i = 0; i < array.length; i += 53) array[i] += (seed[i & 63] & 1) ? 0.00001 : -0.00001;
          }, 'getFloatTimeDomainData');
        }
        if (origAnalyserTimeB) {
          AnalyserNode.prototype.getByteTimeDomainData = asNative(function getByteTimeDomainData(array) {
            Reflect.apply(origAnalyserTimeB, this, [array]);
            const seed = seedBytes();
            if (seed) for (let i = 0; i < array.length; i += 53) array[i] ^= seed[i & 63] & 1;
          }, 'getByteTimeDomainData');
        }
      },
      restore() {
        HTMLCanvasElement.prototype.toDataURL = origToDataURL;
        HTMLCanvasElement.prototype.toBlob = origToBlob;
        CanvasRenderingContext2D.prototype.getImageData = orig2DGet;
        if (origGLRead)  WebGLRenderingContext.prototype.readPixels = origGLRead;
        if (origGL2Read) WebGL2RenderingContext.prototype.readPixels = origGL2Read;
        if (origAudioGetCh) AudioBuffer.prototype.getChannelData = origAudioGetCh;
        if (origAnalyserFreqF) AnalyserNode.prototype.getFloatFrequencyData = origAnalyserFreqF;
        if (origAnalyserFreqB) AnalyserNode.prototype.getByteFrequencyData = origAnalyserFreqB;
        if (origAnalyserTimeF) AnalyserNode.prototype.getFloatTimeDomainData = origAnalyserTimeF;
        if (origAnalyserTimeB) AnalyserNode.prototype.getByteTimeDomainData = origAnalyserTimeB;
      },
    };
  });

  // Brave engine masking: make a Chrome/Edge profile stop reading as Brave.
  // - navigator.brave does not exist in Chrome; delete it (one-time, engine-
  //   independent, so safe at the bootstrap install).
  // - document.browsingTopics exists in Chrome but not Brave; add a native-
  //   looking stub for Chromium-family profiles only. Its presence depends on
  //   bridge.brands, which is null at bootstrap, so reconcile() re-runs
  //   syncTopics() once brands are populated (see reconcile below).
  register('brave-mask', () => {
    const navDesc = Object.getOwnPropertyDescriptor(navigator, 'brave');
    const protoDesc = typeof Navigator !== 'undefined'
      ? Object.getOwnPropertyDescriptor(Navigator.prototype, 'brave') : undefined;
    let topicsAdded = false;

    function deleteBrave() {
      try { delete navigator.brave; } catch (_) {}
      try { if (typeof Navigator !== 'undefined') delete Navigator.prototype.brave; } catch (_) {}
    }
    function restoreBrave() {
      if (navDesc) { try { Object.defineProperty(navigator, 'brave', navDesc); } catch (_) {} }
      if (protoDesc) { try { Object.defineProperty(Navigator.prototype, 'brave', protoDesc); } catch (_) {} }
    }
    function syncTopics() {
      if (typeof Document === 'undefined') return;
      const proto = Document.prototype;
      const isChromium = !!(bridge.brands && bridge.brands.length);
      const present = ('browsingTopics' in proto) || ('browsingTopics' in document);
      if (isChromium && !present) {
        Object.defineProperty(proto, 'browsingTopics', {
          value: asNative(function browsingTopics() { return Promise.resolve([]); }, 'browsingTopics'),
          writable: true, configurable: true, enumerable: true,
        });
        topicsAdded = true;
      } else if (!isChromium && topicsAdded) {
        try { delete proto.browsingTopics; } catch (_) {}
        topicsAdded = false;
      }
    }

    return {
      install() { deleteBrave(); syncTopics(); },
      restore() {
        restoreBrave();
        if (topicsAdded) {
          try { delete Document.prototype.browsingTopics; } catch (_) {}
          topicsAdded = false;
        }
      },
      syncTopics,
    };
  });

  // Apply all by default - privacy-conservative if settings never arrive.
  const active = new Set();
  for (const id of Object.keys(phantoms)) {
    try { phantoms[id].install(); active.add(id); } catch (_) {}
  }

  function reconcile(cfg) {
    // Master-off sentinel - restore originals for every phantom + UA.
    if (cfg && cfg.__off === true) {
      for (const id of Object.keys(phantoms)) {
        if (active.has(id)) {
          try { phantoms[id].restore(); active.delete(id); } catch (_) {}
        }
      }
      clearUA();
      return;
    }
    // Update bridge state for all phantoms to consume.
    bridge.ua         = cfg.__ua         || null;
    bridge.brands     = cfg.__brands     || null;
    bridge.platform   = cfg.__platform   || null;
    bridge.mobile     = !!cfg.__mobile;
    bridge.region     = cfg.__region     || null;
    bridge.tz         = cfg.__tz         || null;
    bridge.locale     = cfg.__locale     || null;
    bridge.languages  = cfg.__languages  || null;
    bridge.resolution = cfg.__resolution || null;
    bridge.caps       = cfg.__caps       || null;
    bridge.webrtcMode = cfg.__webrtcMode || 'mdns';
    bridge.noiseSeed  = cfg.__noiseSeed  || null;

    for (const id of Object.keys(phantoms)) {
      const want = cfg[id] !== false;
      const is = active.has(id);
      if (want && !is) {
        try { phantoms[id].install(); active.add(id); } catch (_) {}
      } else if (!want && is) {
        try { phantoms[id].restore(); active.delete(id); } catch (_) {}
      }
    }

    // brave-mask's Topics presence depends on the profile family (bridge.brands),
    // which is only populated here, not at the bootstrap install. Re-sync it.
    if (active.has('brave-mask')) {
      try { phantoms['brave-mask'].syncTopics(); } catch (_) {}
    }

    // Apply UA override on every reconcile so popup profile changes propagate.
    if (cfg.__ua) {
      applyUA(cfg.__ua, cfg.__brands, cfg.__platform, cfg.__mobile);
    } else {
      clearUA();
    }
  }

  function readCfg() {
    const raw = document.documentElement.getAttribute(ATTR);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (_) { return null; }
  }

  const initial = readCfg();
  if (initial) reconcile(initial);

  new MutationObserver(() => {
    const cfg = readCfg();
    if (cfg) reconcile(cfg);
  }).observe(document.documentElement, { attributes: true, attributeFilter: [ATTR] });
})();
