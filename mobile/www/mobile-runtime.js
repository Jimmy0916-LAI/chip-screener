// === mobile/platform/core.js ===
/**
 * ChipMobile 核心命名空間：錯誤型別、台北時間、雜湊、併發池與基準資料容器。
 * 所有行動版模組皆以 IIFE 掛載於 globalThis.ChipMobile，可同時在 WebView 與 Node 測試中執行。
 */
(function (CM) {
  'use strict';

  class ValueError extends Error {
    constructor(message) {
      super(message);
      this.name = 'ValueError';
    }
  }
  CM.ValueError = ValueError;

  /* ---------- 台北時間（UTC+8，無日光節約） ---------- */
  const TAIPEI_OFFSET_MS = 8 * 3600 * 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');

  function taipeiParts(ms = Date.now()) {
    const t = new Date(ms + TAIPEI_OFFSET_MS);
    const jsDay = t.getUTCDay(); // 0=Sun
    const parts = {
      year: t.getUTCFullYear(),
      month: t.getUTCMonth() + 1,
      day: t.getUTCDate(),
      hour: t.getUTCHours(),
      minute: t.getUTCMinutes(),
      second: t.getUTCSeconds(),
      millisecond: t.getUTCMilliseconds(),
      weekday: (jsDay + 6) % 7, // 與 Python datetime.weekday() 相同：0=週一 … 6=週日
      ms
    };
    parts.date = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    parts.time = `${pad(parts.hour)}:${pad(parts.minute)}`;
    return parts;
  }

  /** 對應 Python datetime.isoformat(timespec=...)，固定 +08:00 */
  function taipeiIso(ms = Date.now(), timespec = 'milliseconds') {
    const p = taipeiParts(ms);
    let s = `${p.date}T${pad(p.hour)}:${pad(p.minute)}`;
    if (timespec !== 'minutes') s += `:${pad(p.second)}`;
    if (timespec === 'milliseconds') s += `.${pad(p.millisecond, 3)}`;
    if (timespec === 'microseconds') s += `.${pad(p.millisecond, 3)}000`;
    return s + '+08:00';
  }

  /** 'YYYY-MM-DD' 加減日數 */
  function addDays(isoDay, delta) {
    const t = Date.parse(isoDay + 'T00:00:00Z') + delta * 86400000;
    return new Date(t).toISOString().slice(0, 10);
  }

  /** 解析含時區 ISO 字串為 epoch ms；無效回傳 NaN */
  function parseIso(text) {
    return Date.parse(String(text || ''));
  }

  CM.time = { taipeiParts, taipeiIso, addDays, parseIso, TAIPEI_OFFSET_MS };

  /* ---------- 通用工具 ---------- */
  async function sha256Hex(bytes) {
    const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  /** 以固定併發數執行非同步工作，結果順序與輸入一致；單筆失敗回傳 undefined 並不中斷整批 */
  async function pool(items, concurrency, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
      while (next < items.length) {
        const idx = next++;
        try {
          results[idx] = await worker(items[idx], idx);
        } catch {
          results[idx] = undefined;
        }
      }
    });
    await Promise.all(runners);
    return results;
  }

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  /** 近似 Python round()：一般情況四捨五入，恰為 .5 時取偶數（banker's rounding） */
  function pyRound(x, digits = 0) {
    if (x === null || x === undefined || !Number.isFinite(x)) return x;
    const m = 10 ** digits;
    const v = x * m;
    const floor = Math.floor(v);
    const diff = v - floor;
    let r;
    if (Math.abs(diff - 0.5) < 1e-9) r = floor % 2 === 0 ? floor : floor + 1;
    else r = Math.round(v);
    return r / m;
  }

  function utf8Decode(bytes) {
    let text = new TextDecoder('utf-8').decode(bytes);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 對應 Python 'utf-8-sig'
    return text;
  }

  function base64ToBytes(b64) {
    const bin = atob(b64 || '');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  CM.util = { sha256Hex, pool, sleep, pyRound, utf8Decode, base64ToBytes };

  /**
   * 內建基準資料（由 boot 於 App 啟動前自 INITIAL_DATA 淺拷貝，避免前端 applyWeek 變動影響服務層）
   * { stocks, series, universe, sessions, hashes, usUniverse }
   */
  CM.base = CM.base || null;

  /** 前景狀態：背景時暫停大量掃描以省電 */
  CM.lifecycle = CM.lifecycle || {
    active: true,
    async waitActive() {
      while (!CM.lifecycle.active) await sleep(1000);
    }
  };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/platform/http.js ===
/**
 * 行動版 HTTPS 用戶端
 * - 僅允許 HTTPS 與白名單網域（防止資料外流或被注入任意請求）
 * - 透過原生 CapacitorHttp 發送（繞過 WebView CORS，憑證由 Android 系統 CA 驗證）
 * - 統一逾時、回應大小上限與錯誤訊息
 */
(function (CM) {
  'use strict';

  const ALLOWED_HOSTS = new Set([
    'opendata.tdcc.com.tw',
    'www.twse.com.tw',
    'api.finmindtrade.com',
    'query1.finance.yahoo.com',
    'query2.finance.yahoo.com',
    'tw.stock.yahoo.com',
    'feeds.feedburner.com',
    'search.cnbc.com',
    'generativelanguage.googleapis.com'
  ]);

  const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
  const USER_AGENT = 'ChipScreener-Android/0.6 (weekly public data)';

  function assertAllowed(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      throw new Error('連線失敗 網址無效');
    }
    if (u.protocol !== 'https:') throw new Error('連線失敗 僅允許 HTTPS');
    if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error('連線失敗 未授權網域 ' + u.hostname);
    if (u.username || u.password) throw new Error('連線失敗 網址不可含帳密');
    return u;
  }

  function wrapResponse(status, headers, bytes) {
    let textCache = null;
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: headers || {},
      bytes,
      text() {
        if (textCache === null) textCache = CM.util.utf8Decode(bytes);
        return textCache;
      },
      json() {
        return JSON.parse(this.text());
      }
    };
  }

  /**
   * 發送請求（不因 HTTP 狀態碼拋錯；網路錯誤／逾時／超量拋錯）
   * @param {object} opts { url, method='GET', headers={}, json=undefined, timeoutMs=12000, maxBytes }
   */
  async function request(opts) {
    const { url, method = 'GET', headers = {}, json, timeoutMs = 12000, maxBytes = DEFAULT_MAX_BYTES } = opts;
    assertAllowed(url);
    if (!CM.native || typeof CM.native.httpRequest !== 'function') {
      throw new Error('連線失敗 原生網路模組未就緒');
    }
    const finalHeaders = { 'User-Agent': USER_AGENT, 'Cache-Control': 'no-cache', ...headers };
    if (json !== undefined) finalHeaders['Content-Type'] = 'application/json';
    let res;
    try {
      res = await CM.native.httpRequest({ url, method, headers: finalHeaders, json, timeoutMs });
    } catch (e) {
      const msg = String((e && e.message) || e || '');
      if (/timeout|timed out|逾時/i.test(msg)) throw new Error('連線失敗 逾時');
      if (/^連線失敗/.test(msg)) throw e;
      throw new Error('連線失敗 ' + (msg || '網路無法使用'));
    }
    const bytes = res.bytes instanceof Uint8Array ? res.bytes : new Uint8Array(res.bytes || []);
    if (bytes.length > maxBytes) throw new Error('回應過大');
    return wrapResponse(res.status, res.headers, bytes);
  }

  /** GET 並要求 HTTP 200，否則拋 'HTTP <code>' */
  async function getOk(url, opts = {}) {
    const res = await request({ ...opts, url, method: 'GET' });
    if (res.status !== 200) {
      const err = new Error('HTTP ' + res.status);
      err.status = res.status;
      throw err;
    }
    return res;
  }

  async function postJson(url, payload, opts = {}) {
    return request({ ...opts, url, method: 'POST', json: payload });
  }

  CM.http = { request, getOk, postJson, assertAllowed, ALLOWED_HOSTS };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/platform/storage.js ===
/**
 * 行動版本機儲存：App 私有目錄 JSON 檔（原子寫入）、Android Keystore 加密金庫、每日通知。
 * 所有實作委派給 CM.native（App 內為 Capacitor 原生外掛，測試時為記憶體替身）。
 */
(function (CM) {
  'use strict';

  const SAFE_PATH = /^(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;

  function checkPath(path) {
    const p = String(path || '');
    if (!SAFE_PATH.test(p) || p.split('/').some(seg => seg === '.' || seg === '..') || p.length > 200) {
      throw new Error('儲存路徑無效');
    }
    return p;
  }

  function joinPath(...parts) {
    return parts.filter(Boolean).join('/').replace(/\/+/g, '/');
  }

  /** @returns {Promise<{exists:boolean, data:string, mtime:number}>} mtime 為 epoch ms */
  async function readText(path) {
    return CM.native.fsRead({ path: checkPath(path) });
  }

  /** 原子寫入（暫存檔 → fsync → rename） */
  async function writeText(path, data) {
    await CM.native.fsWrite({ path: checkPath(path), data: String(data) });
  }

  /** 讀 JSON；不存在或損毀回傳 null（損毀時 meta.damaged=true） */
  async function readJsonMeta(path) {
    const r = await readText(path);
    if (!r || !r.exists) return null;
    try {
      return { value: JSON.parse(r.data), mtime: r.mtime, damaged: false };
    } catch {
      return { value: null, mtime: r.mtime, damaged: true };
    }
  }

  async function readJson(path, fallback = null) {
    const meta = await readJsonMeta(path);
    return meta && !meta.damaged ? meta.value : fallback;
  }

  async function writeJson(path, value) {
    await writeText(path, JSON.stringify(value));
  }

  /** @returns {Promise<Array<{name:string, mtime:number, size:number}>>} 目錄不存在回傳 [] */
  async function list(dir) {
    const r = await CM.native.fsList({ path: checkPath(dir) });
    return (r && r.files) || [];
  }

  async function remove(path) {
    await CM.native.fsRemove({ path: checkPath(path) });
  }

  CM.fs = { readText, writeText, readJson, readJsonMeta, writeJson, list, remove, joinPath, checkPath };

  /* ---------- 金鑰金庫（Android Keystore AES-256-GCM） ---------- */
  const VAULT_KEY = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;
  function checkKey(key) {
    if (!VAULT_KEY.test(String(key))) throw new Error('金庫鍵名無效');
    return key;
  }

  CM.vault = {
    async get(key) {
      const r = await CM.native.vaultGet({ key: checkKey(key) });
      return (r && r.value) || '';
    },
    async set(key, value) {
      await CM.native.vaultSet({ key: checkKey(key), value: String(value) });
    },
    async remove(key) {
      await CM.native.vaultRemove({ key: checkKey(key) });
    }
  };

  /* ---------- 每日本機通知（取代 Windows 工作排程器） ---------- */
  CM.notify = {
    /** @returns {Promise<'granted'|'denied'|'prompt'|'unsupported'>} */
    async permission(request = false) {
      if (!CM.native.notifyPermission) return 'unsupported';
      const r = await CM.native.notifyPermission({ request });
      return (r && r.display) || 'unsupported';
    },
    /** 每日固定時間通知；hour/minute 為台北時間（裝置時區即本地時間） */
    async scheduleDaily({ id, hour, minute, title, body }) {
      if (!CM.native.notifySchedule) return false;
      await CM.native.notifyCancel({ ids: [id] });
      await CM.native.notifySchedule({ id, hour, minute, title, body });
      return true;
    },
    async cancel(id) {
      if (CM.native.notifyCancel) await CM.native.notifyCancel({ ids: [id] });
    },
    async pending() {
      if (!CM.native.notifyPending) return [];
      const r = await CM.native.notifyPending();
      return (r && r.ids) || [];
    }
  };

  CM.openExternal = async function openExternal(url) {
    const u = new URL(String(url));
    if (u.protocol !== 'https:') throw new Error('僅允許開啟 HTTPS 連結');
    if (CM.native && CM.native.openExternal) await CM.native.openExternal({ url: u.href });
  };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/platform/local-store.js ===
/**
 * 行動版三副本原子儲存（對應 Electron src/main/storage.cjs）
 * - 維護 current / mirror / previous 三份副本與 SHA-256 校驗
 * - 啟動時預先載入記憶體，讓前端 storage-adapter.js 的同步 window.desktopStore.read/save 無縫運作
 * - 寫入以序列佇列非同步落盤至 App 私有目錄 store-v1/
 */
(function (CM) {
  'use strict';

  const SLOTS = ['current', 'mirror', 'previous'];
  const KINDS = ['settings', 'snapshot'];

  class MobileLocalStore {
    constructor(dir = 'store-v1', appVersion = '0.6.0-android') {
      this.dir = dir;
      this.appVersion = appVersion;
      this._cache = {
        settings: { value: null, revision: 0, slot: null, damaged: false, raw: null },
        snapshot: { value: null, revision: 0, slot: null, damaged: false, raw: null }
      };
      this._writeQueue = Promise.resolve();
    }

    _file(kind, slot) {
      return CM.fs.joinPath(this.dir, `${kind}.${slot}.json`);
    }

    async init() {
      for (const kind of KINDS) {
        let damaged = false;
        let best = { value: null, revision: 0, slot: null, raw: null };
        for (const slot of SLOTS) {
          try {
            const res = await CM.fs.readText(this._file(kind, slot));
            if (!res || !res.exists) continue;
            const parsed = JSON.parse(res.data);
            const body = parsed && parsed.body;
            if (
              !body ||
              body.schema !== 1 ||
              body.kind !== kind ||
              !Number.isSafeInteger(body.revision) ||
              body.revision <= 0
            ) {
              damaged = true;
              continue;
            }
            const expected = await CM.util.sha256Hex(JSON.stringify(body));
            if (expected !== parsed.sha256) {
              damaged = true;
              continue;
            }
            if (body.revision > best.revision) {
              best = { value: body.value, revision: body.revision, slot, raw: res.data };
            }
          } catch {
            damaged = true;
          }
        }
        this._cache[kind] = { ...best, damaged };
      }
    }

    readSync(kind) {
      if (!KINDS.includes(kind)) return { ok: false, error: '未知儲存類型' };
      const cur = this._cache[kind];
      return {
        ok: true,
        value: cur.value ? structuredClone(cur.value) : null,
        slot: cur.slot,
        damaged: cur.damaged,
        version: this.appVersion
      };
    }

    saveSync(kind, value) {
      if (!KINDS.includes(kind)) return { ok: false, error: '未知儲存類型' };
      const old = this._cache[kind];
      const nextRev = (old.revision || 0) + 1;
      const cloned = structuredClone(value);
      const prevRaw = old.raw;
      this._cache[kind] = { value: cloned, revision: nextRev, slot: 'current', damaged: false, raw: null };

      this._writeQueue = this._writeQueue
        .then(async () => {
          const body = { schema: 1, kind, revision: nextRev, value: cloned };
          const sha256 = await CM.util.sha256Hex(JSON.stringify(body));
          const raw = JSON.stringify({ body, sha256 });
          if (prevRaw) {
            await CM.fs.writeText(this._file(kind, 'previous'), prevRaw);
          }
          await CM.fs.writeText(this._file(kind, 'current'), raw);
          this._cache[kind].raw = raw;
          try {
            await CM.fs.writeText(this._file(kind, 'mirror'), raw);
          } catch {
            // 主檔已原子提交，鏡像失敗不回滾
          }
        })
        .catch(() => {});

      return { ok: true, redundant: true };
    }

    flush() {
      return this._writeQueue;
    }

    installGlobal(target = globalThis) {
      target.desktopStore = {
        read: kind => this.readSync(kind),
        save: (kind, value) => this.saveSync(kind, value)
      };
    }
  }

  CM.localStore = { MobileLocalStore };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/platform/capacitor-bridge.js ===
/**
 * Capacitor 原生橋接層
 * 將 CM.native 對接到自訂原生外掛 ChipNative（檔案／Keystore 金庫／HTTPS／外部瀏覽器）
 * 以及官方外掛 LocalNotifications 與 App 生命週期。
 * 若在純瀏覽器預覽（無原生外掛），會自動降級為安全無害的測試提示模式。
 */
(function (CM) {
  'use strict';

  function getPlugins() {
    const cap = globalThis.Capacitor;
    return (cap && cap.Plugins) || {};
  }

  function isNativeAndroid() {
    const cap = globalThis.Capacitor;
    return Boolean(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  }

  function createCapacitorNative() {
    const plugins = getPlugins();
    const ChipNative = plugins.ChipNative;
    const LocalNotifications = plugins.LocalNotifications;
    const AppPlugin = plugins.App;

    if (AppPlugin && typeof AppPlugin.addListener === 'function') {
      AppPlugin.addListener('appStateChange', ({ isActive }) => {
        CM.lifecycle.active = Boolean(isActive);
      });
    }

    const notifyChannelReady = (async () => {
      if (!LocalNotifications || typeof LocalNotifications.createChannel !== 'function') return;
      try {
        await LocalNotifications.createChannel({
          id: 'daily-briefing',
          name: '每日財經晨報',
          description: '每日定時提醒檢視台美股財經晨報與自選股分析',
          importance: 4,
          visibility: 1,
          vibration: true
        });
      } catch {
        // 忽略舊版或不支援通道的環境
      }
    })();

    return {
      isNative: isNativeAndroid() && Boolean(ChipNative),

      async httpRequest({ url, method = 'GET', headers = {}, json, timeoutMs = 12000 }) {
        if (!ChipNative || typeof ChipNative.httpRequest !== 'function') {
          throw new Error('連線失敗 原生網路模組未就緒');
        }
        const body = json !== undefined ? JSON.stringify(json) : undefined;
        const res = await ChipNative.httpRequest({ url, method, headers, body, timeoutMs });
        return {
          status: Number(res.status) || 0,
          headers: res.headers || {},
          bytes: CM.util.base64ToBytes(res.bodyBase64 || '')
        };
      },

      async fsRead({ path }) {
        if (!ChipNative) return { exists: false, data: '', mtime: 0 };
        return ChipNative.fsRead({ path });
      },

      async fsWrite({ path, data }) {
        if (!ChipNative) return;
        await ChipNative.fsWrite({ path, data });
      },

      async fsList({ path }) {
        if (!ChipNative) return { files: [] };
        return ChipNative.fsList({ path });
      },

      async fsRemove({ path }) {
        if (!ChipNative) return;
        await ChipNative.fsRemove({ path });
      },

      async vaultGet({ key }) {
        if (!ChipNative) return { value: '' };
        return ChipNative.vaultGet({ key });
      },

      async vaultSet({ key, value }) {
        if (!ChipNative) return;
        await ChipNative.vaultSet({ key, value });
      },

      async vaultRemove({ key }) {
        if (!ChipNative) return;
        await ChipNative.vaultRemove({ key });
      },

      async notifyPermission({ request = false } = {}) {
        if (!LocalNotifications) return { display: 'unsupported' };
        try {
          const cur = await LocalNotifications.checkPermissions();
          if (cur && cur.display === 'granted') return { display: 'granted' };
          if (request) {
            const next = await LocalNotifications.requestPermissions();
            return { display: (next && next.display) || 'denied' };
          }
          return { display: (cur && cur.display) || 'prompt' };
        } catch {
          return { display: 'unsupported' };
        }
      },

      async notifySchedule({ id, hour, minute, title, body }) {
        if (!LocalNotifications) return;
        await notifyChannelReady;
        await LocalNotifications.schedule({
          notifications: [
            {
              id: Number(id) || 1001,
              title: String(title || '籌碼雷達 每日晨報'),
              body: String(body || '點擊查看今日台美股盤勢與重點新聞'),
              channelId: 'daily-briefing',
              schedule: {
                on: { hour: Number(hour), minute: Number(minute) },
                allowWhileIdle: true
              },
              extra: { page: 'briefing' }
            }
          ]
        });
      },

      async notifyCancel({ ids }) {
        if (!LocalNotifications || !Array.isArray(ids) || !ids.length) return;
        try {
          await LocalNotifications.cancel({ notifications: ids.map(id => ({ id: Number(id) })) });
        } catch {
          // 忽略取消不存在排程時的錯誤
        }
      },

      async notifyPending() {
        if (!LocalNotifications) return { ids: [] };
        try {
          const res = await LocalNotifications.getPending();
          return { ids: ((res && res.notifications) || []).map(n => n.id) };
        } catch {
          return { ids: [] };
        }
      },

      async openExternal({ url }) {
        if (ChipNative && typeof ChipNative.openExternal === 'function') {
          await ChipNative.openExternal({ url });
        } else if (typeof window !== 'undefined') {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }
    };
  }

  CM.installCapacitorBridge = function installCapacitorBridge() {
    CM.native = createCapacitorNative();
    return CM.native;
  };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/services/feed.js ===
/**
 * 官方集保 (TDCC 1-5)／證交所交易日曆 (TWSE FMTQIK) 即時更新與個股日 K 服務
 * 移植自 scripts/serve_local.py（LocalFeedService、DailyService 與模組輔助函式）。
 */
(function (CM) {
  'use strict';

  const TDCC_URL = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5';
  const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
  const REQUEST_TIMEOUT_MS = 40000;
  const REQUIRED_TDCC_FIELDS = ['資料日期', '證券代號', '持股分級', '人數', '股數', '占集保庫存數比例%'];
  const BAND_START_LEVELS = [11, 12, 13, 15];
  const ETF_CODE_RE = /^00\d{2,4}[A-Z]?$/;
  const TW_CODE_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/;

  function calendarUrl(month) {
    return `https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=${String(month).replace(/-/g, '')}01&response=json`;
  }

  function taipeiNow() {
    return CM.time.taipeiIso(Date.now(), 'milliseconds');
  }

  function check(condition, message) {
    if (!condition) throw new CM.ValueError(message);
  }

  function parseIsoDay(text) {
    const s = String(text);
    check(/^\d{4}-\d{2}-\d{2}$/.test(s), `日期無效 ${s}`);
    const [y, m, d] = s.split('-').map(Number);
    check(y >= 1, `日期無效 ${s}`);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const iso = dt.toISOString().slice(0, 10);
    check(iso === s, `日期無效 ${s}`);
    return s;
  }

  function nextMonth(month) {
    const [y, m] = String(month).split('-').map(Number);
    return m === 12
      ? `${String(y + 1).padStart(4, '0')}-01`
      : `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}`;
  }

  function toBytes(raw) {
    if (raw instanceof Uint8Array) return raw;
    if (typeof raw === 'string') return new TextEncoder().encode(raw);
    return new Uint8Array(raw || []);
  }

  async function downloadUrl(url) {
    try {
      const res = await CM.http.getOk(url, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_RESPONSE_BYTES
      });
      return res.bytes;
    } catch (exc) {
      if (exc && exc.status) {
        throw new CM.ValueError(`官方 HTTP ${exc.status}`);
      }
      const msg = String((exc && exc.message) || exc || '');
      if (msg === '回應過大') throw new CM.ValueError('回應過大');
      if (/^連線失敗/.test(msg)) throw new CM.ValueError(msg);
      throw new CM.ValueError(`連線失敗 ${msg || '網路無法使用'}`);
    }
  }

  async function parseWeek(rawBytes, universe, fetched) {
    const bytes = toBytes(rawBytes);
    const text = CM.util.utf8Decode(bytes).trim();
    const lines = text ? text.split(/\r\n|\r|\n/) : [];
    check(lines.length > 1, '集保內容為空');

    const fields = lines[0].split(',').map(s => s.trim());
    const colIdx = REQUIRED_TDCC_FIELDS.map(name => fields.indexOf(name));
    check(colIdx.every(i => i >= 0) && new Set(fields).size === fields.length, '集保欄位缺失或重複');

    const pool = new Set(universe);
    const groups = new Map();
    const issues = {};
    const adjustments = {};
    const rows = {};
    const extraRows = {};
    let day = null;
    let dayStamp = '';
    const fetchedDay = String(fetched || '').slice(0, 10);

    for (let li = 1; li < lines.length; li++) {
      const values = lines[li].split(',');
      check(values.length === fields.length, '集保欄數錯誤');
      const stamp = values[colIdx[0]].trim();
      const code = values[colIdx[1]].trim();
      const lv = values[colIdx[2]].trim();
      const holdersS = values[colIdx[3]].trim();
      const sharesS = values[colIdx[4]].trim();

      if (day === null) {
        check(/^\d{8}$/.test(stamp), '統計日期格式錯誤');
        day = parseIsoDay(`${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`);
        dayStamp = day.replace(/-/g, '');
        const jsDay = new Date(day + 'T00:00:00Z').getUTCDay();
        const weekday = (jsDay + 6) % 7;
        check(day <= fetchedDay && weekday !== 5 && weekday !== 6, '未來或非營業日的統計日期');
      }
      check(stamp === dayStamp, '同份集保檔混有不同日期');
      if (!pool.has(code) && !ETF_CODE_RE.test(code)) continue;

      let levels = groups.get(code);
      if (!levels) {
        levels = new Map();
        groups.set(code, levels);
      }
      if (!/^\d+$/.test(lv) || !/^\d+$/.test(holdersS) || !/^\d+$/.test(sharesS)) {
        issues[code] = '重複級距或股數／戶數無效';
        continue;
      }
      const level = Number(lv);
      if (level < 1 || level > 17 || levels.has(level)) {
        issues[code] = '重複級距或股數／戶數無效';
        continue;
      }
      levels.set(level, [Number(sharesS), Number(holdersS)]);
    }

    for (const code of universe) {
      const g = groups.get(code);
      if (!g || g.size !== 17) {
        if (!Object.hasOwn(issues, code)) issues[code] = '原表缺股或缺少級距';
      }
      if (Object.hasOwn(issues, code)) continue;

      const [den, count] = g.get(17);
      let sumShares = 0;
      let sumHolders = 0;
      for (let i = 1; i <= 15; i++) {
        sumShares += g.get(i)[0];
        sumHolders += g.get(i)[1];
      }
      const bandsShares = BAND_START_LEVELS.map(start => {
        let s = 0;
        for (let i = start; i <= 15; i++) s += g.get(i)[0];
        return s;
      });
      const bandsHolders = BAND_START_LEVELS.map(start => {
        let s = 0;
        for (let i = start; i <= 15; i++) s += g.get(i)[1];
        return s;
      });
      const adj = g.get(16);

      if (
        den <= 0 ||
        sumShares - adj[0] !== den ||
        sumHolders !== count ||
        bandsShares.some(n => n > den)
      ) {
        issues[code] = '股數或戶數與第17級未對帳，待核';
        continue;
      }

      rows[code] = [den, count, ...bandsShares, ...bandsHolders];
      if (adj[0] || adj[1]) adjustments[code] = [adj[0], adj[1]];
    }

    const universeIssues = {};
    for (const [k, v] of Object.entries(issues)) {
      if (pool.has(k)) universeIssues[k] = v;
    }

    for (const [code, g] of groups.entries()) {
      if (pool.has(code) || Object.hasOwn(issues, code) || g.size !== 17) continue;
      const [den, count] = g.get(17);
      let sumShares = 0;
      let sumHolders = 0;
      for (let i = 1; i <= 15; i++) {
        sumShares += g.get(i)[0];
        sumHolders += g.get(i)[1];
      }
      const bandsShares = BAND_START_LEVELS.map(start => {
        let s = 0;
        for (let i = start; i <= 15; i++) s += g.get(i)[0];
        return s;
      });
      const bandsHolders = BAND_START_LEVELS.map(start => {
        let s = 0;
        for (let i = start; i <= 15; i++) s += g.get(i)[1];
        return s;
      });
      const adj = g.get(16);
      if (
        den <= 0 ||
        sumShares - adj[0] !== den ||
        sumHolders !== count ||
        bandsShares.some(n => n > den)
      ) {
        continue;
      }
      extraRows[code] = [den, count, ...bandsShares, ...bandsHolders];
      if (adj[0] || adj[1]) adjustments[code] = [adj[0], adj[1]];
    }

    const valid = Object.keys(rows).length;
    check(Boolean(day) && valid >= Math.ceil(pool.size * 0.95), `集保有效股票覆蓋不足 95%（${valid}/${pool.size}）`);

    return {
      day,
      rows,
      extraRows,
      issues: universeIssues,
      adjustments,
      observed: fetched,
      quality: {
        raw_source: TDCC_URL,
        sha256: await CM.util.sha256Hex(bytes),
        valid,
        invalid: pool.size - valid,
        universe: pool.size,
        fetched,
        publication: null,
        validation: '1–17 級日期、股數、戶數與固定母體覆蓋驗證通過'
      }
    };
  }

  async function parseMonth(rawBytes, month, fetched, known) {
    const bytes = toBytes(rawBytes);
    const payload = JSON.parse(CM.util.utf8Decode(bytes));
    const fields = Array.isArray(payload && payload.fields) ? payload.fields : [];
    const data = Array.isArray(payload && payload.data) ? payload.data : [];
    check(
      Boolean(payload) &&
        payload.stat === 'OK' &&
        fields[0] === '日期' &&
        fields.includes('成交股數') &&
        payload.date === String(month).replace(/-/g, '') + '01' &&
        data.length > 0,
      `TWSE 日曆月份或欄位不符 ${month}`
    );

    const days = [];
    for (const row of data) {
      const m = /^(\d{2,3})\/(\d{2})\/(\d{2})$/.exec(String(row[0]).trim());
      const volStr = String(row[1]).replace(/,/g, '').trim();
      const vol = /^-?\d+$/.test(volStr) ? Number(volStr) : NaN;
      check(Boolean(m) && Number.isFinite(vol) && vol > 0, 'TWSE 交易日列無效');
      const iso = parseIsoDay(`${String(Number(m[1]) + 1911).padStart(4, '0')}-${m[2]}-${m[3]}`);
      days.push(iso);
    }

    const fetchedDay = String(fetched || '').slice(0, 10);
    const daySet = new Set(days);
    const monotonic = days.every(
      (d, i) => d.startsWith(month + '-') && d <= fetchedDay && (i === 0 || d > days[i - 1])
    );
    check(monotonic && (known || []).every(d => daySet.has(d)), 'TWSE 日曆日期倒退、錯月或缺少已知交易日');

    return {
      month,
      days,
      source: calendarUrl(month),
      sha256: await CM.util.sha256Hex(bytes),
      fetched
    };
  }

  class LocalFeedService {
    constructor(cacheDir = 'tdcc-local-v1', base = CM.base) {
      this.cacheDir = cacheDir;
      this.base = base;
      this.weeks = {};
      this.months = {};
      this.notes = [];
      this._initPromise = null;
      this._inFlight = null;
    }

    _getBase() {
      return this.base || CM.base;
    }

    _bucketFile(kind, key) {
      return CM.fs.joinPath(this.cacheDir, kind, `${key}.json`);
    }

    async init() {
      if (this._initPromise) return this._initPromise;
      this._initPromise = this._loadCache();
      return this._initPromise;
    }

    async _loadCache() {
      const buckets = [
        ['official', /^\d{4}-\d{2}-\d{2}\.json$/, this.weeks],
        ['calendar', /^\d{4}-\d{2}\.json$/, this.months]
      ];
      for (const [kind, pattern, target] of buckets) {
        const dir = CM.fs.joinPath(this.cacheDir, kind);
        let files;
        try {
          files = await CM.fs.list(dir);
        } catch {
          continue;
        }
        files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const file of files) {
          if (!pattern.test(file.name)) continue;
          const stem = file.name.slice(0, -5);
          try {
            const meta = await CM.fs.readJsonMeta(CM.fs.joinPath(dir, file.name));
            if (!meta || meta.damaged || !meta.value || typeof meta.value !== 'object') {
              this.notes.push(`${stem} 本機快取損毀略過`);
              continue;
            }
            const data = meta.value;
            if ((data.day || data.month) === stem) {
              target[stem] = data;
            }
          } catch {
            this.notes.push(`${stem} 本機快取損毀略過`);
          }
        }
      }
    }

    async _atomicSave(kind, key, value) {
      await CM.fs.writeJson(this._bucketFile(kind, key), value);
    }

    async latest() {
      const base = this._getBase();
      const keys = [...Object.keys((base && base.hashes) || {}), ...Object.keys(this.weeks)];
      keys.sort();
      return keys.length ? keys[keys.length - 1] : '';
    }

    async initial() {
      return { weeks: this.weeks, months: this.months, notes: this.notes };
    }

    async _checkWeek() {
      const base = this._getBase();
      const rawBytes = await downloadUrl(TDCC_URL);
      const week = await parseWeek(rawBytes, base.universe, taipeiNow());
      const latestDay = await this.latest();
      const day = week.day;

      if (day < latestDay) {
        throw new CM.ValueError(`忽略舊回應 ${day}，已保存 ${latestDay}`);
      }
      if (day === latestDay) {
        const knownHash =
          (this.weeks[day] && this.weeks[day].quality && this.weeks[day].quality.sha256) ||
          (base.hashes && base.hashes[day]);
        if (knownHash !== week.quality.sha256) {
          throw new CM.ValueError(`${day} 同期內容變更，保留已驗證版本待核`);
        }
        // 若舊快取缺少 ETF extraRows，就地補齊並回傳給前端
        if (Object.hasOwn(this.weeks, day) && !Object.hasOwn(this.weeks[day], 'extraRows')) {
          this.weeks[day].extraRows = week.extraRows || {};
          this.weeks[day].adjustments = Object.assign(this.weeks[day].adjustments || {}, week.adjustments || {});
          await this._atomicSave('official', day, this.weeks[day]);
          return [this.weeks[day], `已是最新 ${day}（已補齊 ETF 資料）`];
        }
        return [null, `已是最新 ${day}`];
      }

      await this._atomicSave('official', day, week);
      this.weeks[day] = week;
      return [week, `有新資料 ${day}`];
    }

    async _checkCalendar(changed) {
      const base = this._getBase();
      const monthKeys = Object.keys(this.months).sort();
      let month = monthKeys.length
        ? monthKeys[monthKeys.length - 1]
        : base.sessions[base.sessions.length - 1].slice(0, 7);
      const todayMonth = taipeiNow().slice(0, 7);
      while (month <= todayMonth) {
        const old =
          (this.months[month] && this.months[month].days) ||
          base.sessions.filter(d => d.startsWith(month));
        const rawBytes = await downloadUrl(calendarUrl(month));
        const record = await parseMonth(rawBytes, month, taipeiNow(), old);
        if (record.days.length > old.length) {
          await this._atomicSave('calendar', month, record);
          this.months[month] = record;
          changed[month] = record;
        }
        month = nextMonth(month);
      }
    }

    async update() {
      if (this._inFlight) return this._inFlight;
      this._inFlight = this._doUpdate().finally(() => {
        this._inFlight = null;
      });
      return this._inFlight;
    }

    async _doUpdate() {
      const months = {};
      const errors = [];
      let week = null;
      let message = '';

      try {
        [week, message] = await this._checkWeek();
      } catch (exc) {
        errors.push('集保：' + ((exc && exc.message) || String(exc)));
      }

      try {
        await this._checkCalendar(months);
      } catch (exc) {
        errors.push('交易日曆：' + ((exc && exc.message) || String(exc)));
      }

      let status;
      if (errors.length === 2 && errors.every(e => e.includes('連線失敗'))) {
        status = '離線';
      } else if (errors.length === 2) {
        status = '失敗';
      } else if (errors.length > 0) {
        status = '部分成功';
      } else if (week) {
        status = '有新資料';
      } else {
        status = '已是最新';
      }

      return {
        weeks: week ? { [week.day]: week } : {},
        months,
        status,
        message: [message, ...errors].filter(Boolean).join('｜'),
        checked: taipeiNow()
      };
    }
  }

  class DailyService {
    constructor(cacheDir = 'daily-cache-v1', feedService = null) {
      this.cacheDir = cacheDir;
      this.feedService = feedService;
      this._inFlight = new Map();
    }

    async init() {}

    async _fetchFinmind(dataset, code, startDate = '2024-01-01') {
      const qs = new URLSearchParams({ dataset, data_id: code, start_date: startDate }).toString();
      const raw = await downloadUrl(`${DailyService.FINMIND_API}?${qs}`);
      const payload = JSON.parse(CM.util.utf8Decode(raw));
      if (payload.status !== 200) {
        throw new CM.ValueError(payload.msg || `FinMind 回應異常 (${payload.status})`);
      }
      return payload.data || [];
    }

    _fallbackIssuedShares(code) {
      const weeks = (this.feedService && this.feedService.weeks) || {};
      const days = Object.keys(weeks).sort().reverse();
      for (const day of days) {
        const week = weeks[day];
        const row = (week.rows && week.rows[code]) || (week.extraRows && week.extraRows[code]);
        if (row && row[0] > 0) return Math.trunc(row[0]);
      }
      return 0;
    }

    async getDaily(code) {
      const norm = String(code || '').trim().toUpperCase();
      if (!TW_CODE_RE.test(norm)) {
        throw new CM.ValueError('請輸入有效四碼股票或 ETF 代號');
      }

      const cachePath = CM.fs.joinPath(this.cacheDir, `${norm}.json`);
      const meta = await CM.fs.readJsonMeta(cachePath);
      if (meta && !meta.damaged && meta.value && Date.now() - meta.mtime < DailyService.CACHE_TTL_MS) {
        return meta.value;
      }

      if (this._inFlight.has(norm)) return this._inFlight.get(norm);
      const task = this._loadDaily(norm, cachePath).finally(() => {
        this._inFlight.delete(norm);
      });
      this._inFlight.set(norm, task);
      return task;
    }

    async _loadDaily(code, cachePath) {
      const prices = await this._fetchFinmind('TaiwanStockPrice', code);
      if (!prices.length) {
        throw new CM.ValueError(`查無 ${code} 的日行情資料`);
      }

      const sharesRows = await this._fetchFinmind('TaiwanStockShareholding', code);
      const issuedByDate = [];
      let stockName = '';
      for (const r of sharesRows) {
        const n = Math.trunc(Number(r.NumberOfSharesIssued || 0));
        if (n > 0) {
          issuedByDate.push([r.date, n, r.stock_name || '']);
          if (!stockName && r.stock_name) stockName = r.stock_name;
        }
      }
      issuedByDate.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

      const fallbackDen = this._fallbackIssuedShares(code);
      const bars = [];
      let idx = 0;
      let lastIssued = issuedByDate.length ? issuedByDate[0][1] : fallbackDen;

      for (const p of prices) {
        const d = p.date || '';
        const o = Number(p.open || 0);
        const h = Number(p.max || 0);
        const l = Number(p.min || 0);
        const c = Number(p.close || 0);
        const vol = Math.trunc(Number(p.Trading_Volume || 0));

        while (idx < issuedByDate.length && issuedByDate[idx][0] <= d) {
          lastIssued = issuedByDate[idx][1];
          idx++;
        }

        const issued = lastIssued || fallbackDen;
        if (l <= 0 || h < l || c <= 0 || o <= 0 || vol < 0 || issued <= 0) continue;
        const turnover = vol / issued;
        if (turnover < 0 || turnover > 1) continue;
        bars.push([d, o, h, l, c, vol, issued, turnover, '', false]);
      }

      if (!bars.length) {
        throw new CM.ValueError(`${code} 缺少有效日 K 或發行股數資料`);
      }

      const result = {
        code,
        name: stockName,
        bars,
        source: 'FinMind (TaiwanStockPrice + TaiwanStockShareholding)',
        fetched: taipeiNow()
      };
      await CM.fs.writeJson(cachePath, result);
      return result;
    }
  }

  DailyService.FINMIND_API = 'https://api.finmindtrade.com/api/v4/data';
  DailyService.CACHE_TTL_MS = 12 * 3600 * 1000;

  CM.feed = { LocalFeedService, DailyService, parseWeek, parseMonth, calendarUrl, TDCC_URL };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/services/tw-market.js ===
/**
 * 台股／美股個股詳情資料供應器
 * 移植自 scripts/providers/tw_market.py：整合 FinMind 日 K 線、三大法人買賣超與融資融券餘額變化，
 * 以及 Yahoo Finance 美股日線資料，提供本機快取與單位換算（張）。
 */
(function (CM) {
  'use strict';

  const VALID_TW_CODE_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/;
  const VALID_US_CODE_RE = /^[A-Z][A-Z0-9.-]{0,7}$/;

  function taipeiNow() {
    return CM.time.taipeiIso(Date.now(), 'milliseconds');
  }

  class TwMarketService {
    constructor(cacheDir = 'tw-detail-v1') {
      this.cacheDir = cacheDir;
      this._inFlight = new Map();
    }

    async init() {}

    async _fetchFinmind(dataset, code, startDate) {
      const qs = new URLSearchParams({ dataset, data_id: code, start_date: startDate }).toString();
      let payload;
      try {
        const res = await CM.http.getOk(`${TwMarketService.FINMIND_API}?${qs}`, {
          timeoutMs: TwMarketService.REQUEST_TIMEOUT_MS
        });
        payload = res.json();
      } catch (exc) {
        if (exc && exc.status) {
          throw new CM.ValueError(`上游資料 HTTP ${exc.status}`);
        }
        const msg = String((exc && exc.message) || exc || '');
        if (/^連線失敗/.test(msg)) throw new CM.ValueError(msg);
        throw new CM.ValueError(`連線失敗 ${msg || '網路無法使用'}`);
      }

      if (payload.status !== 200) {
        throw new CM.ValueError(payload.msg || `資料服務回應異常 (${payload.status})`);
      }
      return payload.data || [];
    }

    async _fetchUsYahooBars(code) {
      const encoded = encodeURIComponent(code);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=1y&interval=1d`;
      try {
        const res = await CM.http.getOk(url, {
          timeoutMs: TwMarketService.REQUEST_TIMEOUT_MS
        });
        const payload = res.json();
        const r = payload.chart.result[0];
        const tsList = r.timestamp || [];
        const q = ((r.indicators && r.indicators.quote) || [{}])[0] || {};
        const opens = q.open || [];
        const highs = q.high || [];
        const lows = q.low || [];
        const closes = q.close || [];
        const vols = q.volume || [];
        const len = Math.min(tsList.length, opens.length, highs.length, lows.length, closes.length, vols.length);
        const bars = [];
        for (let i = 0; i < len; i++) {
          const ts = tsList[i];
          const o = opens[i];
          const h = highs[i];
          const l = lows[i];
          const c = closes[i];
          const v = vols[i];
          if (ts == null || o == null || h == null || l == null || c == null || o <= 0 || h < l || l <= 0 || c <= 0) {
            continue;
          }
          const d = CM.time.taipeiParts(ts * 1000).date;
          bars.push([
            d,
            CM.util.pyRound(Number(o), 2) || 0,
            CM.util.pyRound(Number(h), 2) || 0,
            CM.util.pyRound(Number(l), 2) || 0,
            CM.util.pyRound(Number(c), 2) || 0,
            Math.trunc(Number(v || 0))
          ]);
        }
        return bars;
      } catch (exc) {
        throw new CM.ValueError(`無法取得美股 ${code} 日線資料：${(exc && exc.message) || exc}`);
      }
    }

    async getDetail(code, forceRefresh = false) {
      const norm = String(code || '').trim().toUpperCase();
      const isTw = VALID_TW_CODE_RE.test(norm);
      const isUs = !isTw && VALID_US_CODE_RE.test(norm);
      if (!isTw && !isUs) {
        throw new CM.ValueError('請輸入有效台股或美股代號（如 2330、2404、0050、NVDA）');
      }

      const cachePath = CM.fs.joinPath(this.cacheDir, `${norm}.json`);
      if (!forceRefresh) {
        const meta = await CM.fs.readJsonMeta(cachePath);
        if (meta && !meta.damaged && meta.value && Date.now() - meta.mtime < TwMarketService.CACHE_TTL_MS) {
          return meta.value;
        }
      }

      if (this._inFlight.has(norm)) return this._inFlight.get(norm);
      const task = this._loadDetail(norm, isTw, cachePath).finally(() => {
        this._inFlight.delete(norm);
      });
      this._inFlight.set(norm, task);
      return task;
    }

    async _loadDetail(code, isTw, cachePath) {
      if (!isTw) {
        const bars = await this._fetchUsYahooBars(code);
        if (!bars.length) {
          throw new CM.ValueError(`查無 ${code} 的有效美股日行情資料`);
        }
        const result = {
          code,
          bars,
          inst: [],
          margin: [],
          source: 'Yahoo Finance (US Daily OHLCV)',
          fetched: taipeiNow()
        };
        await CM.fs.writeJson(cachePath, result);
        return result;
      }

      // 1. 日 K 價量（取 2024-01-01 起完整交易日，供日/週/月 K 與 MA60 計算）
      const rawPrices = await this._fetchFinmind('TaiwanStockPrice', code, '2024-01-01');
      const bars = [];
      for (const p of rawPrices) {
        const o = Number(p.open || 0);
        const h = Number(p.max || 0);
        const l = Number(p.min || 0);
        const c = Number(p.close || 0);
        const volLots = CM.util.pyRound(Number(p.Trading_Volume || 0) / 1000) || 0;
        if (o <= 0 || h < l || l <= 0 || c <= 0) continue;
        bars.push([p.date, o, h, l, c, volLots]);
      }

      if (!bars.length) {
        throw new CM.ValueError(`查無 ${code} 的有效日行情資料`);
      }

      // 2. 三大法人買賣超（近期 45 個交易日，換算為張）
      const instStart = bars[Math.max(0, bars.length - 50)][0];
      let instByDate = Object.create(null);
      try {
        const rawInst = await this._fetchFinmind('TaiwanStockInstitutionalInvestorsBuySell', code, instStart);
        for (const r of rawInst) {
          const d = r.date;
          if (!d) continue;
          const bucket = instByDate[d] || (instByDate[d] = [0, 0, 0]);
          const netLots = CM.util.pyRound((Number(r.buy || 0) - Number(r.sell || 0)) / 1000) || 0;
          const name = r.name || '';
          if (name.includes('Foreign')) {
            bucket[0] += netLots;
          } else if (name === 'Investment_Trust') {
            bucket[1] += netLots;
          } else {
            bucket[2] += netLots;
          }
        }
      } catch {
        instByDate = Object.create(null);
      }
      const inst = Object.entries(instByDate)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([d, vals]) => [d, vals[0], vals[1], vals[2]])
        .slice(-30);

      // 3. 融資融券餘額變化（近期 30 個交易日，單位：張）
      let margin = [];
      try {
        const rawMargin = await this._fetchFinmind('TaiwanStockMarginPurchaseShortSale', code, instStart);
        for (const r of rawMargin) {
          const mb = Math.trunc(Number(r.MarginPurchaseTodayBalance || 0));
          const mp = Math.trunc(Number(r.MarginPurchaseYesterdayBalance || 0));
          const sb = Math.trunc(Number(r.ShortSaleTodayBalance || 0));
          const sp = Math.trunc(Number(r.ShortSaleYesterdayBalance || 0));
          margin.push([r.date, mb, mb - mp, sb, sb - sp]);
        }
      } catch {
        margin = [];
      }
      margin = margin.slice(-30);

      const result = {
        code,
        bars,
        inst,
        margin,
        source: 'FinMind (TaiwanStockPrice / Institutional / Margin)',
        fetched: taipeiNow()
      };
      await CM.fs.writeJson(cachePath, result);
      return result;
    }
  }

  TwMarketService.FINMIND_API = 'https://api.finmindtrade.com/api/v4/data';
  TwMarketService.CACHE_TTL_MS = 4 * 3600 * 1000;
  TwMarketService.REQUEST_TIMEOUT_MS = 25000;

  CM.twMarket = { TwMarketService };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/services/news-briefing.js ===
/**
 * 行動版每日 10:00 台美股自動晨報服務（移植自 scripts/providers/news_briefing.py）
 *
 * 行動版平台適配說明：
 * 1. Gemini API Key 僅保存於 Android Keystore 加密金庫（CM.vault，鍵名 'geminiApiKey'），
 *    絕不寫入一般 JSON 檔；init() 會自動將舊版 briefing-secrets.json 遷移至金庫並刪除原檔。
 * 2. Gemini API 請求改由 HTTP Header 'x-goog-api-key' 傳遞金鑰，避免金鑰出現在 URL 或日誌中。
 * 3. Windows 工作排程器（schtasks）改為本機每日通知（CM.notify，id=1001，預設 10:00）；
 *    為維持前端相容，狀態欄位鍵名仍保留 'windowsTaskStatus'，shouldAutoRun() 維持開啟補抓語意。
 * 4. 透過 CM.http（白名單 HTTPS）與 CM.fs（App 私有目錄相對路徑）執行網路與檔案存取。
 */
(function (CM) {
  'use strict';

  const VAULT_GEMINI_KEY = 'geminiApiKey';
  const DAILY_NOTIFY_ID = 1001;
  const DAILY_NOTIFY_TITLE = '籌碼雷達 每日晨報';
  const DAILY_NOTIFY_BODY = '台美股盤勢與重點財經新聞已就緒，點擊查看今日晨報。';
  const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  const MARKET_INDICES = [
    ['^TWII', '台灣加權', 'TW'],
    ['^GSPC', 'S&P 500', 'US'],
    ['^IXIC', 'Nasdaq', 'US'],
    ['^DJI', '道瓊工業', 'US'],
    ['^SOX', '費城半導體', 'US'],
    ['TSM', '台積電 ADR', 'US']
  ];

  const RSS_SOURCES = [
    ['Yahoo 奇摩股市', 'TW', 'https://tw.stock.yahoo.com/rss'],
    ['中央社財經', 'TW', 'https://feeds.feedburner.com/rsscna/finance'],
    ['CNBC 財經', 'US', 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664']
  ];

  // 過濾非財經生活／娛樂／政治／樂透雜訊
  const NOISE_KEYWORDS = [
    '發票', '樂透', '大樂透', '威力彩', '今彩539', '雙贏彩', '賓果', '開獎', '頭獎',
    '中獎', '幸運門市', '星座', '生肖', '運勢', '氣象', '颱風假', '抽獎', '超商',
    '咖啡買一送一', '美食', '旅遊', '飯店', '演唱會', '穿搭', '感情', '離婚', '網紅',
    '藝人', '球賽', '職棒', 'NBA', '市民之夜', '選舉', '造勢'
  ];

  // 台股／財經正向訊號關鍵字
  const FINANCE_KEYWORDS = [
    '股', '台積', '聯發科', '鴻海', 'ETF', '營收', '獲利', 'EPS', '法說', '外資', '投信',
    '央行', '利率', '降息', '升息', 'Fed', '聯準會', '通膨', 'CPI', '美債', '殖利率', '匯率',
    '美元', '台幣', '黃金', '油價', '半導體', '晶片', '輝達', 'NVIDIA', '蘋果', 'Apple',
    '關稅', '出口', 'GDP', '財報', '除息', '配息', '併購', '上市', '上櫃', '大盤', '指數',
    '買超', '賣超', '融資', '庫藏股', '資本支出', '供應鏈', '伺服器', '記憶體', '航運', '金融',
    '市值', '折價', '溢價', '那斯達克', '道瓊', '標普', '費半', '小摩', '高盛', '商辦', '房貸',
    'stock', 'market', 'Fed', 'tariff', 'earnings', 'chip', 'Nvidia', 'Treasury',
    'inflation', 'GDP', 'economy', 'IPO', 'dividend', 'Wall Street', 'S&P', 'Nasdaq', 'Dow'
  ];
  const FINANCE_KEYWORDS_LOWER = FINANCE_KEYWORDS.map(k => k.toLowerCase());

  const DEFAULT_WATCHLIST = ['2330', '0050', 'TSM', 'NVDA'];

  const BRIEFING_TOPICS = [
    ['ai_semi', 'AI / 半導體', ['ai', '半導體', '晶圓', '台積', '輝達', 'nvidia', '晶片', '伺服器', '記憶體', '封測', 'asml', 'amd', 'intel', 'tsmc', 'chip', 'semiconductor', 'gpu', 'hbm']],
    ['macro_rate', '總經 / 利率 / 匯率', ['fed', '聯準會', '央行', '利率', '降息', '升息', 'cpi', '通膨', '關稅', 'gdp', '匯率', '美元', '台幣', '美債', '殖利率', 'inflation', 'tariff', 'treasury', 'economy', 'rate']],
    ['etf_fin', 'ETF / 高股息 / 金融', ['etf', '高股息', '配息', '除息', '金融', '金控', '銀行', '壽險', '債券', '0050', '0056', '00878', '00919', 'dividend']],
    ['us_tech', '美股科技 / 財報', ['美股', '那斯達克', '標普', '道瓊', '費半', '蘋果', '微軟', '谷歌', '亞馬遜', '特斯拉', 'apple', 'microsoft', 'alphabet', 'amazon', 'meta', 'tesla', 'earnings', 'nasdaq', 's&p', 'wall street']],
    ['tw_trad', '台股傳產 / 航運 / 能源', ['航運', '長榮', '陽明', '萬海', '重電', '綠電', '能源', '鋼鐵', '塑化', '生技', '軍工', '航空', '電價', 'oil', 'energy']]
  ];

  const TOPIC_MAP = Object.fromEntries(BRIEFING_TOPICS.map(([tid, label, kws]) => [tid, [label, kws]]));
  const DEFAULT_TOPIC_IDS = BRIEFING_TOPICS.map(([tid]) => tid);

  // 常見新聞股名／關鍵別名對照表
  const NEWS_STOCK_ALIASES = {
    '台積電': '2330', 'tsmc': '2330',
    '鴻海': '2317', '聯發科': '2454', '台達電': '2308', '廣達': '2382',
    '緯創': '3231', '緯穎': '6669', '日月光': '3711', '聯電': '2303',
    '華碩': '2357', '技嘉': '2376', '微星': '2377', '奇鋐': '3017',
    '雙鴻': '3324', '智邦': '2345', '台光電': '2383', '世芯': '3661',
    '創意': '3443', '光寶科': '2301', '和碩': '4938', '仁寶': '2324',
    '英業達': '2356', '南亞科': '2408', '華邦電': '2344', '旺宏': '2337',
    '群創': '3481', '友達': '2409', '大立光': '3008', '瑞昱': '2379',
    '聯詠': '3034', '力積電': '6770', '群聯': '8299', '欣興': '3037',
    '景碩': '3189', '南電': '8046', '勤誠': '8210', '川湖': '2059',
    '健策': '3653', '貿聯': '3665', '嘉澤': '3533', '華固': '2548', '瓦城': '2729',
    '富邦金': '2881', '國泰金': '2882', '中信金': '2891', '兆豐金': '2886',
    '玉山金': '2884', '凱基金': '2883', '元大金': '2885', '台新金': '2887',
    '長榮': '2603', '陽明': '2609', '萬海': '2615', '華航': '2610',
    '長榮航': '2618', '中鋼': '2002', '中華電': '2412', '台塑': '1301',
    '南亞': '1303', '台化': '1326', '台塑化': '6505', '中興電': '1513',
    '華城': '1519', '士電': '1503', '亞力': '1514', '漢唐': '2404',
    '元大台灣50': '0050', '0050': '0050', '0056': '0056', '00878': '00878',
    '00919': '00919', '00929': '00929', '00713': '00713',
    '輝達': 'NVDA', 'nvidia': 'NVDA', '蘋果': 'AAPL', 'apple': 'AAPL',
    '微軟': 'MSFT', 'microsoft': 'MSFT', '谷歌': 'GOOGL', 'google': 'GOOGL',
    'alphabet': 'GOOGL', '亞馬遜': 'AMZN', 'amazon': 'AMZN', 'meta': 'META',
    '特斯拉': 'TSLA', 'tesla': 'TSLA', '超微': 'AMD', 'amd': 'AMD',
    '英特爾': 'INTC', 'intel': 'INTC', '博通': 'AVGO', 'broadcom': 'AVGO',
    '高通': 'QCOM', 'qualcomm': 'QCOM', '美光': 'MU', 'micron': 'MU',
    '艾司摩爾': 'ASML', 'asml': 'ASML', '美超微': 'SMCI', '甲骨文': 'ORCL',
    'oracle': 'ORCL', 'palantir': 'PLTR', 'netflix': 'NFLX', '網飛': 'NFLX', 'arm': 'ARM',
    '小摩': 'JPM', '摩根大通': 'JPM', 'jpmorgan': 'JPM',
    '大摩': 'MS', '摩根士丹利': 'MS', 'morgan stanley': 'MS',
    '高盛': 'GS', 'goldman': 'GS', '花旗': 'C', 'citigroup': 'C',
    '美銀': 'BAC', 'bank of america': 'BAC', '貝萊德': 'BLK', 'blackrock': 'BLK',
    '波克夏': 'BRK-B', 'berkshire': 'BRK-B', '沃爾瑪': 'WMT', 'walmart': 'WMT',
    '好市多': 'COST', 'costco': 'COST', '禮來': 'LLY', 'eli lilly': 'LLY',
    '波音': 'BA', 'boeing': 'BA', '迪士尼': 'DIS', 'disney': 'DIS',
    '星巴克': 'SBUX', 'starbucks': 'SBUX', '麥當勞': 'MCD', '耐吉': 'NKE', 'nike': 'NKE',
    '艾克森美孚': 'XOM', 'exxon': 'XOM', '雪佛龍': 'CVX', 'chevron': 'CVX',
    '應材': 'AMAT', 'applied materials': 'AMAT', '科林研發': 'LRCX', '思科': 'CSCO', 'cisco': 'CSCO'
  };

  const MACRO_CAT_KWS = ['fed', '聯準會', '央行', 'cpi', '通膨', '利率', '關稅', 'gdp', '匯率', '美債', '油價', '黃金', 'economy', 'tariff', 'inflation'];
  const US_CAT_KWS = ['美股', '華爾街', '道瓊', '那斯達克', '標普', '費半', 'nvidia', 'apple', 'tesla', 'microsoft', 'wall street', 'nasdaq', 's&p'];

  const IGNORE_TICKERS = new Set([
    'AI', 'US', 'TW', 'UK', 'EU', 'CN', 'JP', 'GDP', 'CPI', 'PCE', 'PPI',
    'FED', 'FOMC', 'ETF', 'EPS', 'IPO', 'ADR', 'YOY', 'QOQ', 'MOM', 'SEC',
    'CEO', 'CFO', 'CTO', 'USD', 'TWD', 'NTD', 'RMB', 'JPY', 'EUR', 'PE', 'PB',
    'WSJ', 'CNBC', 'CRN', 'IT', 'PC', 'NB', 'TV', 'EV', 'GPU', 'CPU', 'HBM'
  ]);

  const DEFAULT_US_NAMES = {
    'TSM': '台積電 ADR', 'NVDA': 'NVIDIA', 'AAPL': 'Apple', 'MSFT': 'Microsoft',
    'GOOGL': 'Alphabet', 'AMZN': 'Amazon', 'META': 'Meta', 'TSLA': 'Tesla',
    'AMD': 'AMD', 'AVGO': 'Broadcom', 'JPM': 'JPMorgan', 'GS': 'Goldman Sachs',
    'MS': 'Morgan Stanley', 'BAC': 'Bank of America', 'WMT': 'Walmart',
    'COST': 'Costco', 'LLY': 'Eli Lilly', 'NFLX': 'Netflix', 'BRK-B': 'Berkshire Hathaway',
    'SPY': 'S&P 500 ETF', 'QQQ': 'Nasdaq 100 ETF', 'SOXX': 'iShares 半導體 ETF'
  };

  const pad2 = n => String(n).padStart(2, '0');

  function escapeRegExp(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function isAscii(s) {
    return /^[\x00-\x7F]*$/.test(s);
  }

  function formatDayWithOffset(tsSec, offsetSec) {
    const d = new Date((tsSec + offsetSec) * 1000);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  function fmtSigned(n, digits = 2) {
    return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
  }

  function fmtComma(n, digits = 2) {
    return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function fmtSignedComma(n, digits = 2) {
    return `${n >= 0 ? '+' : '-'}${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }

  function parseTimeHHMM(raw) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(raw || '').trim());
    if (!m) return { hour: 10, minute: 0, text: '10:00' };
    const hour = Number(m[1]);
    const minute = Number(m[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return { hour: 10, minute: 0, text: '10:00' };
    }
    return { hour, minute, text: `${pad2(hour)}:${pad2(minute)}` };
  }

  /**
   * 對應 Python _http_get(url, timeout=12) -> bytes
   * @param {string} url
   * @param {number} [timeoutSec=12]
   * @returns {Promise<Uint8Array>}
   */
  async function httpGet(url, timeoutSec = 12) {
    const res = await CM.http.getOk(url, { timeoutMs: timeoutSec * 1000 });
    return res.bytes;
  }

  /**
   * 對應 Python _fetch_yahoo_quote(yahoo_symbol) -> dict | None
   * 依交易所時區（gmtoffset）分日取得前一個交易日收盤價，避免誤用 range=5d 的 chartPreviousClose。
   * @param {string} yahooSymbol
   * @returns {Promise<object|null>}
   */
  async function fetchYahooQuote(yahooSymbol) {
    const encoded = encodeURIComponent(String(yahooSymbol));
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=5d&interval=1d`;
    try {
      const raw = await httpGet(url, 10);
      const payload = JSON.parse(CM.util.utf8Decode(raw));
      const res = payload.chart.result[0];
      const meta = res.meta;
      const offsetSec = Math.trunc(Number(meta.gmtoffset || 0));

      const rawTs = res.timestamp || [];
      const rawCloses = ((res.indicators && res.indicators.quote && res.indicators.quote[0]) || {}).close || [];
      const dailyByDay = new Map();
      const len = Math.min(rawTs.length, rawCloses.length);
      for (let i = 0; i < len; i++) {
        const t = rawTs[i];
        const c = rawCloses[i];
        if (t === null || t === undefined || c === null || c === undefined) continue;
        const numC = Number(c);
        if (!Number.isFinite(numC)) continue;
        dailyByDay.set(formatDayWithOffset(Number(t), offsetSec), numC);
      }
      const dailyBars = [...dailyByDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

      let price = meta.regularMarketPrice;
      if ((price === null || price === undefined) && dailyBars.length) {
        price = dailyBars[dailyBars.length - 1][1];
      }
      if (price === null || price === undefined) return null;
      price = Number(price);
      if (!Number.isFinite(price)) return null;

      const ts = meta.regularMarketTime;
      const marketDay = ts ? formatDayWithOffset(Number(ts), offsetSec) : '';

      // 取前一個交易日收盤價（嚴禁直接使用 range=5d 的 chartPreviousClose）
      let prev = null;
      if (dailyBars.length) {
        if (marketDay) {
          const earlier = dailyBars.filter(([d]) => d < marketDay);
          if (earlier.length) prev = earlier[earlier.length - 1][1];
        }
        if (prev === null && dailyBars.length >= 2) {
          prev = dailyBars[dailyBars.length - 2][1];
        }
      }
      if (prev === null) {
        const fallbackPrev = meta.previousClose || meta.chartPreviousClose;
        prev = fallbackPrev !== null && fallbackPrev !== undefined ? Number(fallbackPrev) : null;
      }

      const change = prev ? (price - prev) : 0.0;
      const changePct = prev ? ((change / prev) * 100.0) : 0.0;
      let tradeTime = '';
      if (ts) {
        const tp = CM.time.taipeiParts(Number(ts) * 1000);
        tradeTime = `${tp.date} ${tp.time}`;
      }
      return {
        price: CM.util.pyRound(price, 2),
        prevClose: prev !== null ? CM.util.pyRound(prev, 2) : null,
        change: CM.util.pyRound(change, 2),
        changePct: CM.util.pyRound(changePct, 2),
        tradeTime,
        currency: meta.currency || '',
        yahooSymbol
      };
    } catch {
      return null;
    }
  }

  /* ---------- 輕量 XML / RSS 解析與 RFC 2822 日期 ---------- */
  const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  function decodeXmlEntities(text) {
    if (!text || !text.includes('&')) return text || '';
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, code) => {
      if (code[0] === '#') {
        const num = code[1] === 'x' || code[1] === 'X'
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
        if (Number.isFinite(num) && num >= 0 && num <= 0x10ffff) {
          try { return String.fromCodePoint(num); } catch { return m; }
        }
        return m;
      }
      return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, code) ? NAMED_ENTITIES[code] : m;
    });
  }

  function extractTagText(block, tagName) {
    const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'i');
    const m = re.exec(block);
    if (!m) return '';
    const inner = m[1];
    // CDATA 內容保留原樣，其餘段落解碼 XML 實體（與 ElementTree 一致）
    const parts = inner.split(/(<!\[CDATA\[[\s\S]*?\]\]>)/g);
    let out = '';
    for (const part of parts) {
      if (part.startsWith('<![CDATA[') && part.endsWith(']]>')) {
        out += part.slice(9, -3);
      } else {
        out += decodeXmlEntities(part);
      }
    }
    return out;
  }

  function extractRssItems(xmlText) {
    const items = [];
    const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
    let m;
    while ((m = itemRe.exec(xmlText)) !== null) {
      const b = m[1];
      items.push({
        title: extractTagText(b, 'title'),
        link: extractTagText(b, 'link'),
        description: extractTagText(b, 'description'),
        pubDate: extractTagText(b, 'pubDate')
      });
    }
    if (items.length) return items;

    // Atom <entry> 備援
    const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi;
    while ((m = entryRe.exec(xmlText)) !== null) {
      const b = m[1];
      let link = extractTagText(b, 'link').trim();
      if (!link) {
        const hm = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i.exec(b);
        if (hm) link = decodeXmlEntities(hm[1]);
      }
      items.push({
        title: extractTagText(b, 'title'),
        link,
        description: extractTagText(b, 'summary') || extractTagText(b, 'content'),
        pubDate: extractTagText(b, 'published') || extractTagText(b, 'updated')
      });
    }
    return items;
  }

  function parsePubDate(raw) {
    const text = String(raw || '').trim();
    if (!text) return ['', 0.0];
    try {
      let normalized = text.replace(/\bUT$/i, 'GMT');
      const hasTz = /(?:[+-]\d{2}:?\d{2}|Z|\b(?:GMT|UTC|EST|EDT|CST|CDT|MST|MDT|PST|PDT))$/i.test(normalized);
      if (!hasTz) normalized += ' GMT';
      const ms = Date.parse(normalized);
      if (!Number.isFinite(ms)) return [text.slice(0, 16), 0.0];
      const p = CM.time.taipeiParts(ms);
      return [`${pad2(p.month)}/${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`, ms / 1000];
    } catch {
      return [text.slice(0, 16), 0.0];
    }
  }

  function cleanText(text) {
    if (!text) return '';
    return String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function isRelevantFinance(title, desc, marketHint) {
    const combined = `${title} ${desc}`;
    if (NOISE_KEYWORDS.some(bad => title.includes(bad))) return false;
    if (marketHint === 'US') return true;
    const lower = combined.toLowerCase();
    return FINANCE_KEYWORDS_LOWER.some(kw => lower.includes(kw));
  }

  function normalizeTitle(title) {
    // 對應 Python 3 re.sub(r'[\W_]+', '', title.lower())[:24]
    return String(title || '').toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '').slice(0, 24);
  }

  function classifyCategory(title, defaultMarket) {
    const lower = title.toLowerCase();
    if (MACRO_CAT_KWS.some(k => lower.includes(k))) return '總經';
    if (defaultMarket === 'US' || US_CAT_KWS.some(k => lower.includes(k))) return '美股';
    return '台股';
  }

  function matchItemTopics(title, desc) {
    const text = `${title} ${desc}`.toLowerCase();
    const matched = [];
    for (const [tid, , kws] of BRIEFING_TOPICS) {
      if (kws.some(k => text.includes(k))) matched.push(tid);
    }
    return matched;
  }

  async function fetchNewsPool(maxItems = 10, selectedTopics = null) {
    let activeTopics = (selectedTopics || DEFAULT_TOPIC_IDS).filter(t => Object.prototype.hasOwnProperty.call(TOPIC_MAP, t));
    if (!activeTopics.length) activeTopics = [...DEFAULT_TOPIC_IDS];
    const activeSet = new Set(activeTopics);
    const isCustomTopics = activeSet.size !== DEFAULT_TOPIC_IDS.length || DEFAULT_TOPIC_IDS.some(t => !activeSet.has(t));

    const buckets = { TW: [], US: [] };
    const seenKeys = new Set();

    for (const [sourceName, marketHint, url] of RSS_SOURCES) {
      try {
        const raw = await httpGet(url, 10);
        const xmlText = CM.util.utf8Decode(raw);
        for (const item of extractRssItems(xmlText)) {
          const title = cleanText(item.title || '');
          const link = String(item.link || '').trim();
          const desc = cleanText(item.description || '');
          const [pubStr, pubTs] = parsePubDate(item.pubDate || '');
          if (!title || !link.startsWith('https://')) continue;
          if (!isRelevantFinance(title, desc, marketHint)) continue;
          const key = normalizeTitle(title);
          if (!key || seenKeys.has(key)) continue;
          seenKeys.add(key);
          const snippet = desc && desc !== title ? (desc.slice(0, 120) + (desc.length > 120 ? '…' : '')) : '';
          const itemTopics = matchItemTopics(title, desc);
          const topicHits = itemTopics.reduce((acc, t) => acc + (activeSet.has(t) ? 1 : 0), 0);
          buckets[marketHint].push({
            title,
            url: link,
            source: sourceName,
            category: classifyCategory(title, marketHint),
            published: pubStr,
            ts: pubTs,
            snippet,
            topicHits,
            topics: itemTopics.filter(t => activeSet.has(t)).map(t => TOPIC_MAP[t][0])
          });
        }
      } catch {
        continue;
      }
    }

    buckets.TW.sort((a, b) => b.ts - a.ts);
    buckets.US.sort((a, b) => b.ts - a.ts);

    const allItems = [...buckets.TW, ...buckets.US];
    allItems.sort((a, b) => {
      const ha = isCustomTopics ? a.topicHits : 0;
      const hb = isCustomTopics ? b.topicHits : 0;
      if (hb !== ha) return hb - ha;
      return b.ts - a.ts;
    });

    let merged;
    if (isCustomTopics) {
      const matched = allItems.filter(x => x.topicHits > 0);
      merged = matched.slice(0, maxItems);
      if (merged.length < 4) {
        const fallback = allItems.filter(x => x.topicHits === 0).sort((a, b) => b.ts - a.ts);
        merged.push(...fallback.slice(0, 4 - merged.length));
      }
    } else {
      const twPick = buckets.TW.slice(0, 6);
      const usPick = buckets.US.slice(0, 4);
      merged = [...twPick, ...usPick];
      if (merged.length < maxItems) {
        const rest = [...buckets.TW.slice(6), ...buckets.US.slice(4)].sort((a, b) => b.ts - a.ts);
        merged.push(...rest.slice(0, maxItems - merged.length));
      }
      merged.sort((a, b) => b.ts - a.ts);
    }

    const strip = lst => lst.map(item => {
      const { ts: _ts, topicHits: _th, ...rest } = item;
      return rest;
    });
    return [strip(merged.slice(0, maxItems)), strip(allItems)];
  }

  async function summarizeWithGemini(apiKey, indices, news, tracked) {
    if (!apiKey) return null;
    const idxLines = indices
      .filter(x => x.price !== null && x.price !== undefined)
      .map(x => `- ${x.name} (${x.symbol}): ${x.price} (${fmtSigned(x.changePct, 2)}%)`)
      .join('\n');
    const newsLines = news
      .map(n => `- [${n.category}｜${n.source}] ${n.title}`)
      .join('\n');
    const trackLines = tracked
      .filter(t => t.price !== null && t.price !== undefined)
      .map(t => `- ${t.code} ${t.name}: ${t.price} (${fmtSigned(t.changePct, 2)}%) ${t.chipNote || ''}`)
      .join('\n');
    const prompt =
      '你是專業台美股財經晨報編輯。請嚴格根據以下已查證的即時報價與新聞標題，撰寫 3 到 4 條精簡繁體中文重點摘要（每條不超過 60 字），' +
      '絕對禁止捏造未出現的數據或媒體，每條結尾請括號標示消息來源（例如：（Yahoo 奇摩股市）或（CNBC 財經））。' +
      '請直接輸出 JSON 陣列（例如 ["重點1", "重點2"]），不要加 Markdown 程式碼區塊。\n\n' +
      `【指數報價】\n${idxLines}\n\n【重點新聞】\n${newsLines}\n\n【追蹤標的】\n${trackLines}`;

    try {
      const res = await CM.http.postJson(
        GEMINI_ENDPOINT,
        { contents: [{ parts: [{ text: prompt }] }] },
        { timeoutMs: 20000, headers: { 'x-goog-api-key': apiKey } }
      );
      if (!res.ok) return null;
      const payload = res.json();
      let text = String(payload.candidates[0].content.parts[0].text || '').trim();
      text = text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length && parsed.every(x => typeof x === 'string')) {
        const cleaned = parsed.slice(0, 5).map(x => x.trim()).filter(Boolean);
        return cleaned.length ? cleaned : null;
      }
    } catch {
      return null;
    }
    return null;
  }

  function buildRuleSummary(indices, news, tracked) {
    const bullets = [];
    const usIdx = indices.filter(x => x.market === 'US' && x.price !== null && x.price !== undefined);
    const twIdx = indices.find(x => x.symbol === '^TWII' && x.price !== null && x.price !== undefined) || null;

    if (usIdx.length) {
      const parts = usIdx.slice(0, 4).map(x => `${x.name} ${fmtSigned(x.changePct, 2)}%`);
      bullets.push('隔夜美股表現：' + parts.join('、') + '（Yahoo Finance）。');
    }
    if (twIdx) {
      bullets.push(
        `台股加權指數目前 ${fmtComma(twIdx.price, 2)} 點（${fmtSigned(twIdx.change, 2)} / ${fmtSigned(twIdx.changePct, 2)}%，資料時間 ${twIdx.tradeTime || '最新'}，Yahoo Finance）。`
      );
    }
    if (tracked && tracked.length) {
      const validT = tracked.filter(t => t.price !== null && t.price !== undefined);
      if (validT.length) {
        const movers = [...validT].sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 3);
        const desc = movers.map(m => `${m.code} ${m.name} (${fmtSigned(m.changePct, 2)}%)`).join('、');
        bullets.push(`追蹤標的波動焦點：${desc}。`);
      }
    }
    if (news && news.length) {
      const topTw = news.find(n => n.category === '台股') || null;
      const topUs = news.find(n => n.category === '美股' || n.category === '總經') || null;
      if (topTw) bullets.push(`台股焦點：${topTw.title}（${topTw.source}）。`);
      if (topUs) bullets.push(`國際／總經焦點：${topUs.title}（${topUs.source}）。`);
    }
    return bullets.length ? bullets : ['目前暫無可彙總之最新市場資訊，請稍後重試。'];
  }

  function appendMdStockTable(lines, heading, items) {
    if (!items || !items.length) return;
    lines.push('', heading, '', '| 代號 | 名稱 | 最新價 | 漲跌幅 | 籌碼／備註 |', '| --- | --- | ---: | ---: | --- |');
    for (const t of items) {
      const hasVal = t.price !== null && t.price !== undefined;
      const p = hasVal ? fmtComma(t.price, 2) : '—';
      const cp = hasVal ? `${fmtSigned(t.changePct, 2)}%` : '—';
      lines.push(`| \`${t.code}\` | ${t.name} | ${p} | ${cp} | ${t.chipNote || '—'} |`);
    }
  }

  function renderMarkdown(report) {
    const topicStr = (report.topicLabels && report.topicLabels.length) ? report.topicLabels.join('、') : '預設均衡';
    const lines = [
      `# 台美股財經晨報｜${report.date}`,
      `> 產出時間（台北）：${report.generatedAt} · 摘要模式：${report.summaryMode} · 觸發方式：${report.trigger} · 題材：${topicStr}`,
      '',
      '## 一、一分鐘重點總結'
    ];
    for (const b of report.summary) {
      lines.push(`- ${b}`);
    }
    lines.push('', '## 二、台美股盤勢快照', '', '| 指數／標的 | 市場 | 最新價 | 漲跌 | 漲跌幅 |', '| --- | --- | ---: | ---: | ---: |');
    for (const idx of report.indices) {
      const hasVal = idx.price !== null && idx.price !== undefined;
      const p = hasVal ? fmtComma(idx.price, 2) : '—';
      const c = hasVal ? fmtSignedComma(idx.change, 2) : '—';
      const cp = hasVal ? `${fmtSigned(idx.changePct, 2)}%` : '—';
      lines.push(`| ${idx.name} (\`${idx.symbol}\`) | ${idx.market} | ${p} | ${c} | ${cp} |`);
    }

    appendMdStockTable(lines, '## 三、自訂追蹤標的異動速覽', report.tracked || []);
    appendMdStockTable(lines, '## 四、晨報重點股票異動速覽', report.newsStocks || []);

    lines.push('', '## 五、重點新聞精選（附消息來源）');
    for (const n of report.news) {
      const pub = n.published ? ` · ${n.published}` : '';
      lines.push(`- **[${n.category}]** [${n.title}](${n.url}) — *${n.source}${pub}*`);
    }
    lines.push('');
    return lines.join('\n');
  }

  class BriefingService {
    constructor(appDataDir = '', stockNames = {}) {
      this.appDataDir = String(appDataDir || '');
      this.stockNames = stockNames || {};
      this.userDir = CM.fs.joinPath(this.appDataDir, 'user-v1');
      this.briefingsDir = CM.fs.joinPath(this.appDataDir, 'briefings-v1');
      this.configFile = CM.fs.joinPath(this.userDir, 'briefing-config.json');
      this.secretsFile = CM.fs.joinPath(this.userDir, 'briefing-secrets.json');
      this._generateInFlight = null;
    }

    /** 啟動初始化：若存在舊版明文金鑰檔，遷移至 CM.vault 後刪除 */
    async init() {
      const meta = await CM.fs.readJsonMeta(this.secretsFile);
      if (meta !== null) {
        if (!meta.damaged && meta.value && typeof meta.value === 'object') {
          const legacyKey = String(meta.value.geminiApiKey || '').trim();
          if (legacyKey) {
            const existing = await CM.vault.get(VAULT_GEMINI_KEY);
            if (!existing) await CM.vault.set(VAULT_GEMINI_KEY, legacyKey);
          }
        }
        await CM.fs.remove(this.secretsFile);
      }
    }

    _getStockNames() {
      if (this.stockNames && Object.keys(this.stockNames).length) return this.stockNames;
      return (CM.base && CM.base.stocks) || {};
    }

    async _readConfigRaw() {
      const data = await CM.fs.readJson(this.configFile, null);
      return (data && typeof data === 'object' && !Array.isArray(data)) ? { ...data } : {};
    }

    async _getApiKey() {
      return String((await CM.vault.get(VAULT_GEMINI_KEY)) || '').trim();
    }

    async _queryNotifyStatus(enabled, timeStr) {
      if (!enabled) return '已停用每日通知';
      const perm = await CM.notify.permission(false);
      if (perm !== 'granted') return '通知權限未開啟，請至系統設定允許通知';
      const { text } = parseTimeHHMM(timeStr);
      const pending = await CM.notify.pending();
      return pending.includes(DAILY_NOTIFY_ID) ? `已排程每日 ${text} 通知` : `未排程每日 ${text} 通知`;
    }

    async _syncNotification(enabled, timeStr, requestPermission = false) {
      if (!enabled) {
        await CM.notify.cancel(DAILY_NOTIFY_ID);
        return '已停用每日通知';
      }
      const perm = await CM.notify.permission(requestPermission);
      if (perm !== 'granted') return '通知權限未開啟，請至系統設定允許通知';
      const { hour, minute, text } = parseTimeHHMM(timeStr);
      const ok = await CM.notify.scheduleDaily({
        id: DAILY_NOTIFY_ID,
        hour,
        minute,
        title: DAILY_NOTIFY_TITLE,
        body: DAILY_NOTIFY_BODY
      });
      return ok ? `已排程每日 ${text} 通知` : '通知權限未開啟，請至系統設定允許通知';
    }

    async getConfig() {
      const raw = await this._readConfigRaw();
      const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : true;
      const { text: time } = parseTimeHHMM(raw.time || '10:00');
      let watchlist = Array.isArray(raw.watchlist) ? raw.watchlist : [...DEFAULT_WATCHLIST];
      watchlist = watchlist
        .map(s => String(s).trim().toUpperCase())
        .filter(s => /^[A-Za-z0-9]{2,8}$/.test(s));

      let topics;
      if (!Array.isArray(raw.topics)) {
        topics = [...DEFAULT_TOPIC_IDS];
      } else {
        topics = raw.topics
          .map(t => String(t).trim())
          .filter(t => Object.prototype.hasOwnProperty.call(TOPIC_MAP, t));
        if (!topics.length) topics = [...DEFAULT_TOPIC_IDS];
      }

      const key = await this._getApiKey();
      const masked = key.length >= 6 ? ('••••' + key.slice(-4)) : (key ? '已設定' : '');
      const windowsTaskStatus = await this._queryNotifyStatus(enabled, time);

      return {
        enabled,
        time,
        watchlist,
        topics,
        availableTopics: BRIEFING_TOPICS.map(([id, label]) => ({ id, label })),
        hasGeminiKey: Boolean(key),
        geminiKeyHint: masked,
        windowsTaskStatus
      };
    }

    async updateConfig(body) {
      const updates = (body && typeof body === 'object') ? body : {};
      const raw = await this._readConfigRaw();
      const current = {
        enabled: true,
        time: '10:00',
        watchlist: [...DEFAULT_WATCHLIST],
        topics: [...DEFAULT_TOPIC_IDS],
        ...raw
      };

      let needNotifySync = false;
      if ('enabled' in updates) {
        current.enabled = Boolean(updates.enabled);
        needNotifySync = true;
      }
      if ('time' in updates) {
        current.time = parseTimeHHMM(updates.time).text;
        needNotifySync = true;
      }
      if ('watchlist' in updates) {
        let items = updates.watchlist;
        if (typeof items === 'string') {
          items = items.split(/[\s,，、;；]+/);
        }
        if (Array.isArray(items)) {
          const cleaned = [];
          for (const sym of items) {
            const s = String(sym).trim().toUpperCase();
            if (/^[A-Za-z0-9]{2,8}$/.test(s) && !cleaned.includes(s)) {
              cleaned.push(s);
            }
          }
          current.watchlist = cleaned.slice(0, 15);
        }
      }
      if ('topics' in updates && Array.isArray(updates.topics)) {
        const cleanedTopics = [];
        for (const t of updates.topics) {
          const tid = String(t).trim();
          if (Object.prototype.hasOwnProperty.call(TOPIC_MAP, tid) && !cleanedTopics.includes(tid)) {
            cleanedTopics.push(tid);
          }
        }
        current.topics = cleanedTopics.length ? cleanedTopics : [...DEFAULT_TOPIC_IDS];
      }

      await CM.fs.writeJson(this.configFile, current);

      if (needNotifySync) {
        await this._syncNotification(Boolean(current.enabled), current.time, Boolean(current.enabled));
      }

      if ('geminiApiKey' in updates) {
        const newKey = String(updates.geminiApiKey || '').trim();
        if (newKey) {
          await CM.vault.set(VAULT_GEMINI_KEY, newKey);
        } else {
          await CM.vault.remove(VAULT_GEMINI_KEY);
        }
      } else if (updates.clearGeminiKey) {
        await CM.vault.remove(VAULT_GEMINI_KEY);
      }

      return this.getConfig();
    }

    async listDates() {
      const files = await CM.fs.list(this.briefingsDir);
      const dates = [];
      for (const f of files) {
        const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f.name);
        if (m) dates.push(m[1]);
      }
      dates.sort((a, b) => (b < a ? -1 : b > a ? 1 : 0));
      return dates;
    }

    async readReport(day = null) {
      const dates = await this.listDates();
      const target = (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) ? day : (dates[0] || null);
      if (!target) return null;
      return CM.fs.readJson(CM.fs.joinPath(this.briefingsDir, `${target}.json`), null);
    }

    async shouldAutoRun() {
      const cfg = await this.getConfig();
      if (!cfg.enabled) return false;
      const now = CM.time.taipeiParts();
      const { hour, minute } = parseTimeHHMM(cfg.time);
      if (now.hour < hour || (now.hour === hour && now.minute < minute)) return false;
      const existing = await CM.fs.readText(CM.fs.joinPath(this.briefingsDir, `${now.date}.json`));
      return !(existing && existing.exists);
    }

    _loadUsNameMap() {
      const nameMap = { ...DEFAULT_US_NAMES };
      const keywords = [];
      const universe = (CM.base && Array.isArray(CM.base.usUniverse)) ? CM.base.usUniverse : [];
      for (const item of universe) {
        let code = '';
        let disp = '';
        let enName = '';
        if (Array.isArray(item)) {
          code = String(item[0] || '').trim().toUpperCase();
          disp = String(item[1] || code).trim();
          enName = String(item[3] || disp.replace(/[\u4e00-\u9fff]+/g, '')).trim();
        } else if (item && typeof item === 'object') {
          code = String(item.code || '').trim().toUpperCase();
          disp = String(item.name || code).trim();
          enName = String(item.enName || '').trim();
        }
        if (!code) continue;
        if (!Object.prototype.hasOwnProperty.call(nameMap, code)) {
          nameMap[code] = disp;
        }
        const cleanEn = enName.replace(/,?\s+(?:Inc\.?|Corp\.?|Corporation|Ltd\.?|PLC|Co\.?|Group|Holdings)$/i, '').trim();
        if (cleanEn.length >= 6) {
          keywords.push([cleanEn, code]);
        }
      }
      return [nameMap, keywords];
    }

    async _fetchOneTrackedQuote(code, usNames) {
      const isTw = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(code);
      let quote;
      if (isTw) {
        quote = (await fetchYahooQuote(`${code}.TW`)) || (await fetchYahooQuote(`${code}.TWO`));
      } else {
        quote = await fetchYahooQuote(code);
      }

      const stockNames = this._getStockNames();
      let name;
      let market;
      if (isTw) {
        const info = stockNames[code];
        name = (Array.isArray(info) && info.length) ? info[0] : (code.startsWith('00') ? 'ETF' : code);
        market = (Array.isArray(info) && info.length > 1) ? info[1] : 'TWSE';
      } else {
        name = Object.prototype.hasOwnProperty.call(usNames, code) ? usNames[code] : code;
        market = 'US';
      }

      return {
        code,
        name,
        market,
        price: quote ? quote.price : null,
        change: quote ? quote.change : null,
        changePct: quote ? quote.changePct : null,
        tradeTime: quote ? quote.tradeTime : '',
        chipNote: isTw ? '台股集保可於個股頁核對' : '美股即時／收盤報價'
      };
    }

    async _fetchTrackedQuotes(symbols) {
      if (!symbols || !symbols.length) return [];
      const [usNames] = this._loadUsNameMap();
      return CM.util.pool(symbols, 6, sym => this._fetchOneTrackedQuote(sym, usNames));
    }

    async _extractNewsStocks(news, excludeCodes, maxCount = 8, extraNews = null) {
      const [, spKeywords] = this._loadUsNameMap();
      const stockNames = this._getStockNames();
      const longTwNames = [];
      const shortTwNames = [];
      for (const [code, info] of Object.entries(stockNames)) {
        if (!Array.isArray(info) || !info.length) continue;
        const nm = String(info[0]).trim();
        const upCode = String(code).toUpperCase();
        if (nm.length >= 3) longTwNames.push([nm, upCode]);
        else if (nm.length === 2) shortTwNames.push([nm, upCode]);
      }

      const hits = new Map();
      const softHits = new Map();

      function register(code, article) {
        const sym = String(code || '').trim().toUpperCase();
        if (!sym) return;
        const src = article.source || '財經新聞';
        let titleShort = article.title || '';
        if (titleShort.length > 26) titleShort = titleShort.slice(0, 26) + '…';
        const meta = { mentionedIn: `${src}：${titleShort}` };
        if (excludeCodes.has(sym)) {
          if (!softHits.has(sym)) softHits.set(sym, meta);
          return;
        }
        if (!hits.has(sym)) hits.set(sym, meta);
      }

      const seenTitles = new Set();
      const orderedArticles = [];
      for (const lst of [news, extraNews || []]) {
        for (const art of lst) {
          const tkey = art.title || '';
          if (tkey && !seenTitles.has(tkey)) {
            seenTitles.add(tkey);
            orderedArticles.push(art);
          }
        }
      }

      const aliasEntries = Object.entries(NEWS_STOCK_ALIASES);
      const codeRe = /(\()?(?<![\p{L}\p{N}_])(\d{4})(?![\p{L}\p{N}_])(\))?/gu;
      const usTickerRe = /(?:\(|(?:NASDAQ|NYSE)\s*[:：]\s*)([A-Z]{2,5}(?:-[A-Z])?)(?:\)|(?![\p{L}\p{N}_]))/gu;

      for (const n of orderedArticles) {
        const text = `${n.title || ''} ${n.snippet || ''}`;
        const lower = text.toLowerCase();

        // 1. 別名關鍵字
        for (const [alias, sym] of aliasEntries) {
          if (isAscii(alias)) {
            if (new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(alias)}(?![A-Za-z0-9])`).test(lower)) {
              register(sym, n);
            }
          } else if (text.includes(alias)) {
            register(sym, n);
          }
        }

        // 2. 明確 4 碼台股代號（排除單純年份 2020~2035）
        for (const m of text.matchAll(codeRe)) {
          const code = m[2];
          if (!Object.prototype.hasOwnProperty.call(stockNames, code)) continue;
          const codeNum = Number(code);
          const isYearLike = codeNum >= 2020 && codeNum <= 2035;
          const info = stockNames[code] || [];
          const nm = info[0] || '';
          if (isYearLike && !(m[1] && m[3]) && !(nm && text.includes(nm))) continue;
          register(code, n);
        }

        // 3. 完整 3 字以上台股公司名稱
        for (const [nm, code] of longTwNames) {
          if (text.includes(nm)) {
            register(code, n);
            if (hits.size >= maxCount) break;
          }
        }

        // 4. 安全比對 2 字台股公告語境
        if (hits.size < maxCount) {
          for (const [nm, code] of shortTwNames) {
            if (
              text.includes(nm) &&
              new RegExp(`(?:^|[，、\\s「『(（【])${escapeRegExp(nm)}(?:：|:|股價|營收|獲利|法說|財報|董事|買回|庫藏|增持|買超|賣超|大漲|重挫|跳空|領漲|除息)`).test(text)
            ) {
              register(code, n);
              if (hits.size >= maxCount) break;
            }
          }
        }

        // 5. S&P 500 英文完整公司名與括號／交易所美股代號
        for (const [kw, sym] of spKeywords) {
          if (new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(kw)}(?![A-Za-z0-9])`).test(text)) {
            register(sym, n);
            if (hits.size >= maxCount) break;
          }
        }

        for (const m of text.matchAll(usTickerRe)) {
          const sym = m[1];
          if (!IGNORE_TICKERS.has(sym)) register(sym, n);
        }

        if (hits.size >= maxCount) break;
      }

      const chosenHits = hits.size ? hits : softHits;
      if (!chosenHits.size) return [];
      const orderedCodes = [...chosenHits.keys()].slice(0, maxCount);
      const quotes = await this._fetchTrackedQuotes(orderedCodes);
      const validQuotes = [];
      for (const q of quotes) {
        if (!q || q.price === null || q.price === undefined) continue;
        const meta = chosenHits.get(q.code) || {};
        q.mentionedIn = meta.mentionedIn || '';
        if (meta.mentionedIn) q.chipNote = meta.mentionedIn;
        validQuotes.push(q);
      }
      return validQuotes;
    }

    async _generateImpl({ featuredCode = '', trigger = '手動馬上製作' } = {}) {
      void featuredCode; // 保留參數與 API 介面相容
      const now = CM.time.taipeiParts();
      const today = now.date;
      const cfg = await this.getConfig();

      const indices = await CM.util.pool(MARKET_INDICES, 6, async ([sym, name, mkt]) => {
        const q = await fetchYahooQuote(sym);
        return {
          symbol: sym,
          name,
          market: mkt,
          price: q ? q.price : null,
          change: q ? q.change : null,
          changePct: q ? q.changePct : null,
          tradeTime: q ? q.tradeTime : ''
        };
      });

      const selectedTopics = (cfg.topics && cfg.topics.length) ? cfg.topics : [...DEFAULT_TOPIC_IDS];
      const selSet = new Set(selectedTopics);
      const isDefaultTopics = selSet.size === DEFAULT_TOPIC_IDS.length && DEFAULT_TOPIC_IDS.every(t => selSet.has(t));
      const topicLabels = isDefaultTopics
        ? ['預設均衡（全部題材）']
        : selectedTopics.filter(t => Object.prototype.hasOwnProperty.call(TOPIC_MAP, t)).map(t => TOPIC_MAP[t][0]);

      const [news, allNewsPool] = await fetchNewsPool(10, selectedTopics);

      const trackCodes = [];
      for (const s of cfg.watchlist) {
        if (!trackCodes.includes(s)) trackCodes.push(s);
      }
      const tracked = await this._fetchTrackedQuotes(trackCodes.slice(0, 10));
      const newsStocks = await this._extractNewsStocks(
        news,
        new Set(trackCodes),
        8,
        allNewsPool
      );

      const apiKey = await this._getApiKey();
      const aiBullets = apiKey
        ? await summarizeWithGemini(apiKey, indices, news, [...tracked, ...newsStocks.slice(0, 3)])
        : null;
      let summary;
      let summaryMode;
      if (aiBullets) {
        summary = aiBullets;
        summaryMode = 'Gemini AI 濃縮摘要';
      } else {
        summary = buildRuleSummary(indices, news, tracked.length ? tracked : newsStocks);
        summaryMode = '規則式重點彙整（免 Key）';
      }

      const report = {
        date: today,
        generatedAt: `${today} ${pad2(now.hour)}:${pad2(now.minute)}:${pad2(now.second)} +08:00`,
        trigger: trigger || '手動馬上製作',
        topics: selectedTopics,
        topicLabels,
        summaryMode,
        summary,
        indices,
        tracked,
        newsStocks,
        news
      };
      report.markdown = renderMarkdown(report);

      await CM.fs.writeJson(CM.fs.joinPath(this.briefingsDir, `${today}.json`), report);
      await CM.fs.writeText(CM.fs.joinPath(this.briefingsDir, `${today}.md`), report.markdown);
      return report;
    }

    async generate(opts = {}) {
      if (this._generateInFlight) return this._generateInFlight;
      this._generateInFlight = this._generateImpl(opts).finally(() => {
        this._generateInFlight = null;
      });
      return this._generateInFlight;
    }
  }

  CM.news = {
    BriefingService,
    httpGet,
    fetchYahooQuote,
    BRIEFING_TOPICS,
    NEWS_STOCK_ALIASES,
    MARKET_INDICES,
    RSS_SOURCES,
    DEFAULT_WATCHLIST,
    TOPIC_MAP,
    DEFAULT_TOPIC_IDS,
    NOISE_KEYWORDS,
    FINANCE_KEYWORDS
  };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/services/us-market.js ===
/**
 * 美股全市場（S&P 500 + 關鍵 ADR/ETF）資料與雙模式量化篩選服務
 * 移植自 scripts/providers/us_market.py：
 * 1. 美股總覽（四大指數、10 年期美債殖利率、VIX 恐慌指數與產業強弱快照）
 * 2. S&P 500 全市場雙模式篩選（機構資金吸籌／超跌估值修正），背景漸進掃描併發上限為 6
 * 3. 任意美股個股 2 年日 K、MA5/10/20/60/200、RSI(14)、MACD(12,26,9)、CMF(20)、52 週位階與結構評析
 */
(function (CM) {
  'use strict';

  const VALID_US_SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,7}$/;

  const US_OVERVIEW_INDICES = [
    ['^GSPC', 'S&P 500', '指數'],
    ['^IXIC', 'Nasdaq', '指數'],
    ['^DJI', '道瓊工業', '指數'],
    ['^SOX', '費城半導體', '半導體'],
    ['^TNX', '美債10Y殖利率', '利率%'],
    ['^VIX', 'VIX 恐慌指數', '波動']
  ];

  // 32 檔優先掃描旗艦代表（確保首次載入數秒內即可呈現重點標的，同時背景續掃全部 S&P 500）
  const US_UNIVERSE = [
    ['AAPL', 'Apple 蘋果', '資訊科技'],
    ['MSFT', 'Microsoft 微軟', '資訊科技'],
    ['NVDA', 'NVIDIA 輝達', '資訊科技'],
    ['GOOGL', 'Alphabet 谷歌 A', '通訊服務'],
    ['AMZN', 'Amazon 亞馬遜', '非必需消費'],
    ['META', 'Meta 臉書', '通訊服務'],
    ['TSLA', 'Tesla 特斯拉', '非必需消費'],
    ['TSM', 'TSMC 台積電 ADR', '半導體 ADR / ETF'],
    ['AVGO', 'Broadcom 博通', '資訊科技'],
    ['AMD', 'AMD 超微', '資訊科技'],
    ['INTC', 'Intel 英特爾', '資訊科技'],
    ['MU', 'Micron 美光', '資訊科技'],
    ['ASML', 'ASML 艾司摩爾', '半導體 ADR / ETF'],
    ['QCOM', 'Qualcomm 高通', '資訊科技'],
    ['ARM', 'Arm 安謀', '半導體 ADR / ETF'],
    ['ORCL', 'Oracle 甲骨文', '資訊科技'],
    ['PLTR', 'Palantir', '資訊科技'],
    ['SMCI', 'Super Micro 美超微', '資訊科技'],
    ['SPY', 'SPDR S&P 500 ETF', '半導體 ADR / ETF'],
    ['QQQ', 'Invesco Nasdaq 100', '半導體 ADR / ETF'],
    ['SOXX', 'iShares 半導體 ETF', '半導體 ADR / ETF'],
    ['VOO', 'Vanguard S&P 500', '半導體 ADR / ETF'],
    ['TLT', '20年期美債 ETF', '半導體 ADR / ETF'],
    ['GLD', 'SPDR 黃金 ETF', '半導體 ADR / ETF'],
    ['BRK-B', '波克夏海瑟威 B', '金融'],
    ['JPM', 'JPMorgan 摩根大通', '金融'],
    ['V', 'Visa 威士卡', '金融'],
    ['COST', 'Costco 好市多', '必需消費'],
    ['NFLX', 'Netflix 網飛', '通訊服務'],
    ['LLY', 'Eli Lilly 禮來', '醫療保健'],
    ['UNH', 'UnitedHealth 聯合健康', '醫療保健'],
    ['XOM', 'ExxonMobil 埃克森美孚', '能源']
  ];

  function roundPy(x, digits = 0) {
    const v = CM.util.pyRound(x, digits);
    return Object.is(v, -0) ? 0 : v;
  }

  function fmtFixed(x, digits) {
    return roundPy(x, digits).toFixed(digits);
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function taipeiNowStr() {
    const p = CM.time.taipeiParts();
    return `${p.date} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)} +08:00`;
  }

  function tsToDay(ts, gmtOffsetSec) {
    const dt = new Date((ts + gmtOffsetSec) * 1000);
    return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  }

  /**
   * 載入完整 S&P 500（+ 關鍵 ADR/ETF）清單，優先排列 32 檔旗艦代表便於漸進式先出結果。
   * 行動版改自 CM.base.usUniverse 讀取，不足 400 檔時回退至 32 檔旗艦清單。
   */
  function loadSp500Universe() {
    const priorityRank = new Map();
    for (let i = 0; i < US_UNIVERSE.length; i++) {
      priorityRank.set(US_UNIVERSE[i][0], i);
    }
    const raw = CM.base && Array.isArray(CM.base.usUniverse) ? CM.base.usUniverse : null;
    if (raw && raw.length > 0) {
      try {
        const tuples = [];
        for (let i = 0; i < raw.length; i++) {
          const item = raw[i];
          let code, name, sector;
          if (Array.isArray(item)) {
            code = item[0];
            name = item[1];
            sector = item[2];
          } else if (item && typeof item === 'object') {
            code = item.code;
            name = item.name;
            sector = item.sector;
          }
          if (code) {
            tuples.push([String(code), String(name ?? ''), String(sector ?? '')]);
          }
        }
        tuples.sort((a, b) => {
          const ra = priorityRank.has(a[0]) ? priorityRank.get(a[0]) : 9999;
          const rb = priorityRank.has(b[0]) ? priorityRank.get(b[0]) : 9999;
          if (ra !== rb) return ra - rb;
          return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
        });
        if (tuples.length >= 400) return tuples;
      } catch {
        // 回退至預設 32 檔旗艦代表
      }
    }
    return US_UNIVERSE.map(entry => [entry[0], entry[1], entry[2]]);
  }

  let _cachedUniverse = null;
  let _cachedUniverseMap = null;

  function getFullUniverse() {
    if (_cachedUniverse === null) {
      _cachedUniverse = loadSp500Universe();
    }
    return _cachedUniverse;
  }

  function getUniverseMap() {
    if (_cachedUniverseMap === null) {
      const map = Object.create(null);
      const list = getFullUniverse();
      for (let i = 0; i < list.length; i++) {
        map[list[i][0]] = [list[i][1], list[i][2]];
      }
      _cachedUniverseMap = map;
    }
    return _cachedUniverseMap;
  }

  function computeSma(values, period) {
    const out = new Array(values.length);
    let running = 0.0;
    for (let i = 0; i < values.length; i++) {
      running += values[i];
      if (i >= period) {
        running -= values[i - period];
      }
      out[i] = i + 1 >= period ? roundPy(running / period, 4) : null;
    }
    return out;
  }

  function computeEma(values, period) {
    if (!values.length) return [];
    const k = 2.0 / (period + 1);
    const out = new Array(values.length);
    let emaVal = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (i + 1 < period) {
        out[i] = null;
      } else if (i + 1 === period) {
        let sum = 0.0;
        for (let j = 0; j < period; j++) sum += values[j];
        emaVal = sum / period;
        out[i] = emaVal;
      } else {
        emaVal = (v - emaVal) * k + emaVal;
        out[i] = emaVal;
      }
    }
    return out;
  }

  function computeRsiSeries(closes, period = 14) {
    const n = closes.length;
    const out = new Array(n).fill(null);
    if (n <= period) return out;

    const gains = new Array(n).fill(0.0);
    const losses = new Array(n).fill(0.0);
    for (let i = 1; i < n; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains[i] = diff;
      else losses[i] = -diff;
    }

    let gainSum = 0.0;
    let lossSum = 0.0;
    for (let i = 1; i <= period; i++) {
      gainSum += gains[i];
      lossSum += losses[i];
    }
    let avgGain = gainSum / period;
    let avgLoss = lossSum / period;
    out[period] = avgLoss === 0 ? 100.0 : roundPy(100.0 - 100.0 / (1.0 + avgGain / avgLoss), 2);

    for (let i = period + 1; i < n; i++) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
      out[i] = avgLoss === 0 ? 100.0 : roundPy(100.0 - 100.0 / (1.0 + avgGain / avgLoss), 2);
    }
    return out;
  }

  function computeMacdSeries(closes) {
    const n = closes.length;
    const ema12 = computeEma(closes, 12);
    const ema26 = computeEma(closes, 26);
    const dif = new Array(n);
    const validDif = [];
    for (let i = 0; i < n; i++) {
      const a = ema12[i];
      const b = ema26[i];
      if (a !== null && b !== null) {
        const d = roundPy(a - b, 4);
        dif[i] = d;
        validDif.push([i, d]);
      } else {
        dif[i] = null;
      }
    }
    const dea = new Array(n).fill(null);
    const hist = new Array(n).fill(null);
    if (validDif.length >= 9) {
      const k = 2.0 / 10.0;
      let sum = 0.0;
      for (let j = 0; j < 9; j++) sum += validDif[j][1];
      let emaD = sum / 9.0;
      const firstIdx = validDif[8][0];
      dea[firstIdx] = roundPy(emaD, 4);
      hist[firstIdx] = roundPy(dif[firstIdx] - emaD, 4);
      for (let j = 9; j < validDif.length; j++) {
        const [idx, val] = validDif[j];
        emaD = (val - emaD) * k + emaD;
        dea[idx] = roundPy(emaD, 4);
        hist[idx] = roundPy(val - emaD, 4);
      }
    }
    return { dif, dea, hist };
  }

  /** Chaikin Money Flow (20 日機構資金流向指標)，範圍 [-1, +1] */
  function _computeCmf20(bars) {
    const win = bars.slice(-20);
    if (win.length < 15) return null;
    let mfVolSum = 0.0;
    let volSum = 0.0;
    for (let i = 0; i < win.length; i++) {
      const b = win[i];
      const h = Number(b[2]);
      const l = Number(b[3]);
      const c = Number(b[4]);
      const v = Number(b[5]);
      if (v <= 0) continue;
      const mult = h > l ? ((c - l) - (h - c)) / (h - l) : 0.0;
      mfVolSum += mult * v;
      volSum += v;
    }
    if (volSum <= 0) return null;
    return roundPy(mfVolSum / volSum, 3);
  }

  /** 20 日上漲成交量／下跌成交量比（IBD 機構吃貨量比） */
  function _computeUdVolRatio(bars) {
    if (bars.length < 16) return null;
    const win = bars.slice(-21);
    let upV = 0.0;
    let dnV = 0.0;
    for (let i = 1; i < win.length; i++) {
      const cCur = Number(win[i][4]);
      const cPrev = Number(win[i - 1][4]);
      const v = Number(win[i][5]);
      if (cCur > cPrev) upV += v;
      else if (cCur < cPrev) dnV += v;
    }
    if (upV <= 0 && dnV <= 0) return null;
    if (dnV <= 0) return 5.0;
    return roundPy(Math.min(9.99, upV / dnV), 2);
  }

  /** OBV 能量潮是否站上 20 日均線且近 20 日淨上升 */
  function _computeObvRising(bars) {
    if (bars.length < 25) return false;
    const obv = [0.0];
    for (let i = 1; i < bars.length; i++) {
      const curC = Number(bars[i][4]);
      const prevC = Number(bars[i - 1][4]);
      const v = Number(bars[i][5]);
      const prevObv = obv[obv.length - 1];
      if (curC > prevC) obv.push(prevObv + v);
      else if (curC < prevC) obv.push(prevObv - v);
      else obv.push(prevObv);
    }
    let sum20 = 0.0;
    for (let i = obv.length - 20; i < obv.length; i++) sum20 += obv[i];
    const obvMa20 = sum20 / 20.0;
    const lastObv = obv[obv.length - 1];
    return lastObv > obvMa20 && lastObv > obv[obv.length - 21];
  }

  /** 20 日 2 倍標準差布林通道 %B 位階（0 = 下軌、0.5 = 中軌、1 = 上軌） */
  function _computeBbPos(closes) {
    if (closes.length < 20) return null;
    const w = closes.slice(-20);
    let sum = 0.0;
    for (let i = 0; i < 20; i++) sum += w[i];
    const mean = sum / 20.0;
    let varSum = 0.0;
    for (let i = 0; i < 20; i++) {
      const d = w[i] - mean;
      varSum += d * d;
    }
    const std = Math.sqrt(varSum / 20.0);
    if (std <= 1e-9) return 0.5;
    const lower = mean - 2.0 * std;
    const upper = mean + 2.0 * std;
    return roundPy((closes[closes.length - 1] - lower) / (upper - lower), 3);
  }

  /** 從美股日 K 陣列 [date, o, h, l, c, v] 計算六大技術維度與「大資金進場／跌深撿便宜」雙模式評分 */
  function analyzeUsBars(bars, meta = null) {
    const closes = bars.map(b => Number(b[4]));
    const vols = bars.map(b => Number(b[5]));
    const last = bars[bars.length - 1];
    const prev = bars.length >= 2 ? bars[bars.length - 2] : last;
    const close = Number(last[4]);
    const openP = Number(last[1]);
    const highP = Number(last[2]);
    const lowP = Number(last[3]);
    const prevClose = Number(prev[4]);
    const chg = roundPy(close - prevClose, 2);
    const chgPct = roundPy(prevClose ? (chg / prevClose) * 100.0 : 0.0, 2);
    const ret20Pct =
      closes.length >= 21 && closes[closes.length - 21] > 0
        ? roundPy(((close - closes[closes.length - 21]) / closes[closes.length - 21]) * 100.0, 2)
        : null;

    const ma5 = computeSma(closes, 5).at(-1);
    const ma10 = computeSma(closes, 10).at(-1);
    const ma20 = computeSma(closes, 20).at(-1);
    const ma60 = computeSma(closes, 60).at(-1);
    const ma200 = computeSma(closes, 200).at(-1);
    const mv5 = computeSma(vols, 5).at(-1);
    const mv20 = computeSma(vols, 20).at(-1);
    const rsiArr = computeRsiSeries(closes, 14);
    const rsi14 = rsiArr.at(-1);
    const macdObj = computeMacdSeries(closes);
    const difLast = macdObj.dif.at(-1);
    const deaLast = macdObj.dea.at(-1);
    const histLast = macdObj.hist.at(-1);
    const histPrev = bars.length >= 2 ? macdObj.hist[macdObj.hist.length - 2] : null;

    const cmf20 = _computeCmf20(bars);
    const udVolRatio = _computeUdVolRatio(bars);
    const obvRising = _computeObvRising(bars);
    const bbPos = _computeBbPos(closes);
    const volTrend = mv5 && mv20 && mv20 > 0 ? roundPy(mv5 / mv20, 2) : 1.0;

    const recentYear = bars.slice(-252);
    let maxH = -Infinity;
    let minL = Infinity;
    for (let i = 0; i < recentYear.length; i++) {
      if (recentYear[i][2] > maxH) maxH = recentYear[i][2];
      if (recentYear[i][3] < minL) minL = recentYear[i][3];
    }
    const hi52 = Number((meta && meta.fiftyTwoWeekHigh) || maxH);
    const lo52 = Number((meta && meta.fiftyTwoWeekLow) || minL);
    const pos52 = hi52 > lo52 ? roundPy(((close - lo52) / (hi52 - lo52)) * 100.0, 1) : 50.0;
    const fromHi52Pct = hi52 > 0 ? roundPy(((close - hi52) / hi52) * 100.0, 2) : 0.0;

    const bias5 = ma5 ? roundPy(((close - ma5) / ma5) * 100.0, 2) : null;
    const bias10 = ma10 ? roundPy(((close - ma10) / ma10) * 100.0, 2) : null;
    const bias20 = ma20 ? roundPy(((close - ma20) / ma20) * 100.0, 2) : null;
    const bias60 = ma60 ? roundPy(((close - ma60) / ma60) * 100.0, 2) : null;
    const bias200 = ma200 ? roundPy(((close - ma200) / ma200) * 100.0, 2) : null;

    const belowMa5 = ma5 !== null && close < ma5;
    const belowMa10 = ma10 !== null && close < ma10;
    const aboveMa200 = ma200 !== null && close >= ma200;

    let shortStatus, shortTone;
    if (ma5 === null || ma10 === null) {
      shortStatus = '均線天數不足';
      shortTone = 'neutral';
    } else if (!belowMa5 && !belowMa10) {
      shortStatus = '站上 5日 / 10日線';
      shortTone = 'up';
    } else if (belowMa5 && belowMa10) {
      shortStatus = '低於 5日與 10日線';
      shortTone = 'down';
    } else if (belowMa5) {
      shortStatus = '低於 5日線、守 10日線';
      shortTone = 'neutral';
    } else {
      shortStatus = '站上 5日線、壓 10日線';
      shortTone = 'neutral';
    }

    let midStatus, midTone;
    if (ma20 === null || ma60 === null) {
      midStatus = '均線天數不足';
      midTone = 'neutral';
    } else if (close >= ma20 && close >= ma60 && (ma200 === null || close >= ma200)) {
      midStatus = '站穩月線、季線與年線';
      midTone = 'up';
    } else if (close < ma20 && close < ma60) {
      midStatus = '位於月季線之下' + (ma200 && close < ma200 ? '（失守年線）' : '');
      midTone = 'down';
    } else {
      midStatus = '中期均線震盪整理';
      midTone = 'neutral';
    }

    let rsiStatus, rsiTone;
    if (rsi14 === null) {
      rsiStatus = 'RSI 資料不足';
      rsiTone = 'neutral';
    } else if (rsi14 >= 70) {
      rsiStatus = `高檔超買 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'up';
    } else if (rsi14 >= 55) {
      rsiStatus = `動能偏強 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'up';
    } else if (rsi14 <= 30) {
      rsiStatus = `低檔超賣 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'down';
    } else if (rsi14 <= 45) {
      rsiStatus = `動能偏弱 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'down';
    } else {
      rsiStatus = `動能中性 (${fmtFixed(rsi14, 1)})`;
      rsiTone = 'neutral';
    }

    let macdStatus, macdTone;
    if (histLast === null) {
      macdStatus = 'MACD 資料不足';
      macdTone = 'neutral';
    } else if (histPrev !== null && histPrev <= 0 && histLast > 0) {
      macdStatus = 'MACD 黃金交叉轉強';
      macdTone = 'up';
    } else if (histPrev !== null && histPrev >= 0 && histLast < 0) {
      macdStatus = 'MACD 死亡交叉轉弱';
      macdTone = 'down';
    } else if (histLast > 0) {
      macdStatus = 'MACD 多頭紅柱';
      macdTone = 'up';
    } else {
      macdStatus = 'MACD 空頭綠柱';
      macdTone = 'down';
    }

    const vol = Math.trunc(Number(last[5]));
    const volRatio = mv5 && mv5 > 0 ? roundPy(vol / mv5, 2) : 1.0;
    let volStatus, volTone;
    if (chg > 0 && volRatio >= 1.2) {
      volStatus = `價漲量增 (${fmtFixed(volRatio, 2)}x)`;
      volTone = 'up';
    } else if (chg < 0 && volRatio >= 1.2) {
      volStatus = `帶量回檔 (${fmtFixed(volRatio, 2)}x)`;
      volTone = 'down';
    } else if (volRatio < 0.75) {
      volStatus = `量縮整理 (${fmtFixed(volRatio, 2)}x)`;
      volTone = 'neutral';
    } else {
      volStatus = `量能溫和 (${fmtFixed(volRatio, 2)}x)`;
      volTone = 'neutral';
    }

    let posStatus, posTone;
    if (pos52 >= 80) {
      posStatus = `52週高檔區 (${fmtFixed(pos52, 0)}%)`;
      posTone = 'up';
    } else if (pos52 <= 25) {
      posStatus = `52週低檔區 (${fmtFixed(pos52, 0)}%)`;
      posTone = 'down';
    } else {
      posStatus = `52週中軸區 (${fmtFixed(pos52, 0)}%)`;
      posTone = 'neutral';
    }

    // ----- 模式 A：大資金進場 (Smart Money Accumulation) -----
    let smartScore = 0;
    const smartReasons = [];
    if (cmf20 !== null) {
      if (cmf20 >= 0.12) {
        smartScore += 30;
        smartReasons.push(`CMF強吸籌 +${fmtFixed(cmf20, 2)}`);
      } else if (cmf20 >= 0.05) {
        smartScore += 20;
        smartReasons.push(`CMF資金淨流入 +${fmtFixed(cmf20, 2)}`);
      } else if (cmf20 > 0) {
        smartScore += 8;
      }
    }
    if (udVolRatio !== null) {
      if (udVolRatio >= 1.5) {
        smartScore += 25;
        smartReasons.push(`20日買賣量比 ${fmtFixed(udVolRatio, 2)}x`);
      } else if (udVolRatio >= 1.2) {
        smartScore += 16;
        smartReasons.push(`買盤量佔優 ${fmtFixed(udVolRatio, 2)}x`);
      }
    }
    if (obvRising) {
      smartScore += 15;
      smartReasons.push('OBV能量潮走揚');
    }
    if (ma20 !== null && close >= ma20) {
      if (ma60 !== null && close >= ma60) {
        smartScore += 15;
        smartReasons.push('站穩月季線');
      } else {
        smartScore += 8;
        smartReasons.push('站上月線');
      }
    }
    if (aboveMa200) {
      smartScore += 5;
    }
    if (volTrend >= 1.15 || (close > openP && volRatio >= 1.25)) {
      smartScore += 10;
      smartReasons.push('量能升溫放量');
    }
    const smartPass =
      cmf20 !== null &&
      cmf20 >= 0.05 &&
      udVolRatio !== null &&
      udVolRatio >= 1.2 &&
      ma20 !== null &&
      close >= ma20 &&
      smartScore >= 55;

    // ----- 模式 B：跌深撿便宜 (Deep Oversold / Mean-Reversion Dip) -----
    let dipScore = 0;
    const dipReasons = [];
    if (fromHi52Pct <= -25.0) {
      dipScore += 25;
      dipReasons.push(`距高點回檔 ${fmtFixed(fromHi52Pct, 1)}%`);
    } else if (fromHi52Pct <= -15.0) {
      dipScore += 18;
      dipReasons.push(`自高點修正 ${fmtFixed(fromHi52Pct, 1)}%`);
    } else if (fromHi52Pct <= -10.0) {
      dipScore += 10;
      dipReasons.push(`回檔 ${fmtFixed(fromHi52Pct, 1)}%`);
    }
    if (rsi14 !== null) {
      if (rsi14 <= 30) {
        dipScore += 30;
        dipReasons.push(`RSI深度超賣 ${fmtFixed(rsi14, 1)}`);
      } else if (rsi14 <= 38) {
        dipScore += 20;
        dipReasons.push(`RSI低檔 ${fmtFixed(rsi14, 1)}`);
      } else if (rsi14 <= 45) {
        dipScore += 10;
      }
    }
    if (bbPos !== null) {
      if (bbPos <= 0.12) {
        dipScore += 20;
        dipReasons.push('觸及布林下軌');
      } else if (bbPos <= 0.25) {
        dipScore += 12;
        dipReasons.push('近布林下緣');
      }
    }
    if (bias20 !== null && bias20 <= -6.0) {
      dipScore += 10;
      dipReasons.push(`負乖離 ${fmtFixed(bias20, 1)}%`);
    } else if (bias20 !== null && bias20 <= -3.0) {
      dipScore += 5;
    }
    if (aboveMa200) {
      dipScore += 10;
      dipReasons.push('守200日年線');
    } else if (cmf20 !== null && cmf20 > -0.05) {
      dipScore += 10;
      dipReasons.push('修正期間資金穩定');
    }
    const lowerWick = highP > lowP ? (Math.min(openP, close) - lowP) / (highP - lowP) : 0.0;
    if (lowerWick >= 0.4) {
      dipScore += 5;
      dipReasons.push('下影線承接');
    }
    const dipPass =
      fromHi52Pct <= -12.0 &&
      ((rsi14 !== null && rsi14 <= 38) || (bbPos !== null && bbPos <= 0.15)) &&
      dipScore >= 50;

    // 綜合結構與背離提醒
    const shortBull = ma5 !== null && ma10 !== null && !belowMa5 && !belowMa10;
    let divergence = '';
    let ovLabel, ovTone, ovSummary;
    if ((belowMa5 || belowMa10) && rsi14 !== null && rsi14 <= 32) {
      ovLabel = '短線超賣區（留意止跌反彈）';
      ovTone = 'neutral';
      divergence = `RSI 超賣提醒 (${fmtFixed(rsi14, 1)})`;
      ovSummary = `收盤低於短期均線且 RSI(14) 進入 ${fmtFixed(rsi14, 1)} 超賣區，可留意量縮止跌或站回 5 日線訊號。`;
    } else if (smartPass) {
      ovLabel = '機構資金吸籌偏多結構';
      ovTone = 'up';
      ovSummary = `符合機構資金吸籌條件（${smartReasons.slice(0, 3).join(' · ')}），量價與資金流向一致偏多。`;
    } else if (shortBull && macdTone === 'up') {
      ovLabel = '美股均線與 MACD 多頭共振';
      ovTone = 'up';
      ovSummary = `站上 5 日與 10 日均線且 ${macdStatus}，RSI(14)=${rsi14 !== null ? rsi14 : '—'}，多方動能一致。`;
    } else if (shortBull && rsi14 !== null && rsi14 >= 72) {
      ovLabel = '強勢高檔（RSI 過熱留意乖離）';
      ovTone = 'up';
      divergence = `RSI 過熱警戒 (${fmtFixed(rsi14, 1)})`;
      ovSummary = `股價維持多頭但 RSI(14) 達 ${fmtFixed(rsi14, 1)} 且 52 週位階 ${fmtFixed(pos52, 0)}%，宜留意短線乖離修正。`;
    } else if (!shortBull && macdTone === 'down') {
      ovLabel = '短均承壓且 MACD 偏空';
      ovTone = 'down';
      ovSummary = '收盤位於 5 日／10 日均線之下且 MACD 維持空方柱，建議靜待均線重新站回與動能翻多。';
    } else {
      ovLabel = '均線震盪整理格局';
      ovTone = 'neutral';
      ovSummary = `短中期均線與指標呈分歧震盪（${shortStatus}、${macdStatus}），宜觀察量能變化與支撐守穩情況。`;
    }

    return {
      price: roundPy(close, 2),
      prevClose: roundPy(prevClose, 2),
      change: chg,
      changePct: chgPct,
      ret20Pct: ret20Pct,
      tradeDate: last[0],
      ma5: ma5 !== null ? roundPy(ma5, 2) : null,
      ma10: ma10 !== null ? roundPy(ma10, 2) : null,
      ma20: ma20 !== null ? roundPy(ma20, 2) : null,
      ma60: ma60 !== null ? roundPy(ma60, 2) : null,
      ma200: ma200 !== null ? roundPy(ma200, 2) : null,
      bias5Pct: bias5,
      bias10Pct: bias10,
      bias20Pct: bias20,
      bias60Pct: bias60,
      bias200Pct: bias200,
      belowMa5,
      belowMa10,
      aboveMa200,
      cmf20,
      udVolRatio,
      obvRising,
      bbPos,
      volTrend,
      smartMoney: { pass: smartPass, score: Math.min(100, smartScore), reasons: smartReasons },
      dipBuy: { pass: dipPass, score: Math.min(100, dipScore), reasons: dipReasons },
      shortMa: {
        ma5: ma5 ? roundPy(ma5, 2) : null,
        ma10: ma10 ? roundPy(ma10, 2) : null,
        bias5Pct: bias5,
        bias10Pct: bias10,
        belowMa5,
        belowMa10,
        status: shortStatus,
        tone: shortTone
      },
      midMa: {
        ma20: ma20 ? roundPy(ma20, 2) : null,
        ma60: ma60 ? roundPy(ma60, 2) : null,
        ma200: ma200 ? roundPy(ma200, 2) : null,
        bias20Pct: bias20,
        bias60Pct: bias60,
        bias200Pct: bias200,
        status: midStatus,
        tone: midTone
      },
      rsi: { value: rsi14, status: rsiStatus, tone: rsiTone },
      macd: {
        dif: difLast !== null ? roundPy(difLast, 3) : null,
        dea: deaLast !== null ? roundPy(deaLast, 3) : null,
        hist: histLast !== null ? roundPy(histLast, 3) : null,
        status: macdStatus,
        tone: macdTone
      },
      volume: {
        vol,
        mv5: mv5 ? roundPy(mv5, 0) : null,
        volRatio,
        status: volStatus,
        tone: volTone
      },
      range52w: {
        high: roundPy(hi52, 2),
        low: roundPy(lo52, 2),
        posPct: pos52,
        fromHighPct: fromHi52Pct,
        status: posStatus,
        tone: posTone
      },
      overall: {
        label: ovLabel,
        tone: ovTone,
        summary: ovSummary,
        divergenceAlert: divergence
      },
      rsiSeries: rsiArr.slice(-60),
      macdSeries: {
        dates: bars.slice(-60).map(b => b[0]),
        dif: macdObj.dif.slice(-60),
        dea: macdObj.dea.slice(-60),
        hist: macdObj.hist.slice(-60)
      }
    };
  }

  function _summarizeScreenerRows(rows, totalUniverse, done, scanning, updatedAt) {
    const sectorBuckets = Object.create(null);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!sectorBuckets[r.sector]) sectorBuckets[r.sector] = [];
      sectorBuckets[r.sector].push(r);
    }
    const sortedSectors = Object.entries(sectorBuckets).sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length;
      return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
    });
    const sectors = sortedSectors.map(([secName, secRows]) => {
      let chgSum = 0.0;
      let upCnt = 0;
      for (let i = 0; i < secRows.length; i++) {
        chgSum += secRows[i].changePct;
        if (secRows[i].changePct > 0) upCnt++;
      }
      return {
        name: secName,
        count: secRows.length,
        avgChangePct: roundPy(chgSum / secRows.length, 2),
        upCount: upCnt,
        downCount: secRows.length - upCnt
      };
    });

    let smartCnt = 0;
    let dipCnt = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].smartPass) smartCnt++;
      if (rows[i].dipPass) dipCnt++;
    }
    return {
      updatedAt,
      count: rows.length,
      universeTotal: totalUniverse,
      scanning,
      progress: { done, total: totalUniverse },
      counts: { total: rows.length, smartMoney: smartCnt, dipBuy: dipCnt },
      sectors,
      rows
    };
  }

  class UsMarketService {
    constructor(cacheDir = 'us-cache-v1') {
      this.cacheDir = String(cacheDir || 'us-cache-v1').replace(/\/+$/, '');
      this._scanning = false;
      this._scanDone = 0;
      this._scanTotal = 0;
      this._scanRows = [];
      this._scanUpdatedAt = '';
      this._scanPromise = null;
      this._firstBatchPromise = null;
      this._resolveFirstBatch = null;
      this._detailInFlight = new Map();
    }

    async init() {
      this._scanTotal = getFullUniverse().length;
    }

    _cachePath(name) {
      return CM.fs.joinPath(this.cacheDir, name);
    }

    async _readFresh(relPath, ttlSec) {
      const meta = await CM.fs.readJsonMeta(relPath);
      if (!meta || meta.damaged || !meta.value) return null;
      if (Date.now() - meta.mtime < ttlSec * 1000) return meta.value;
      return null;
    }

    async _readAny(relPath) {
      return CM.fs.readJson(relPath, null);
    }

    async _writeJson(relPath, payload) {
      await CM.fs.writeJson(relPath, payload);
    }

    async _fetchChartRaw(code, rangeStr = '1y') {
      const encoded = encodeURIComponent(code);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=${rangeStr}&interval=1d`;
      let lastErr = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const rawBytes = await CM.news.httpGet(url, 11);
          const payload = JSON.parse(CM.util.utf8Decode(rawBytes));
          const chart = (payload && payload.chart) || {};
          const results = chart.result;
          if (!results || !results.length) {
            const errMsg = (chart.error && chart.error.description) || `查無美股代號 ${code}`;
            throw new CM.ValueError(errMsg);
          }
          const res = results[0];
          const meta = res.meta || {};
          const gmtOffset = parseInt(meta.gmtoffset, 10) || -18000;
          const tsList = res.timestamp || [];
          const q = ((res.indicators && res.indicators.quote) || [{}])[0] || {};
          const opens = q.open || [];
          const highs = q.high || [];
          const lows = q.low || [];
          const closes = q.close || [];
          const vols = q.volume || [];

          const len = Math.min(tsList.length, opens.length, highs.length, lows.length, closes.length, vols.length);
          const byDay = Object.create(null);
          for (let i = 0; i < len; i++) {
            const ts = tsList[i];
            const o = opens[i];
            const h = highs[i];
            const l = lows[i];
            const c = closes[i];
            const v = vols[i];
            if (ts == null || o == null || h == null || l == null || c == null) continue;
            if (o <= 0 || h < l || l <= 0 || c <= 0) continue;
            const d = tsToDay(ts, gmtOffset);
            byDay[d] = [
              d,
              roundPy(Number(o), 2),
              roundPy(Number(h), 2),
              roundPy(Number(l), 2),
              roundPy(Number(c), 2),
              Math.trunc(Number(v || 0))
            ];
          }
          const days = Object.keys(byDay).sort();
          const bars = days.map(k => byDay[k]);
          if (!bars.length) {
            throw new CM.ValueError(`查無 ${code} 的有效美股日行情資料`);
          }
          return [bars, meta];
        } catch (err) {
          lastErr = err;
          if (err && typeof err.status === 'number') {
            if (err.status === 429 && attempt === 0) {
              await CM.util.sleep(700);
              continue;
            }
            throw err;
          }
          if (attempt === 0) {
            await CM.util.sleep(350);
            continue;
          }
          throw err;
        }
      }
      throw lastErr || new CM.ValueError(`無法取得 ${code}`);
    }

    async getDetail(code, forceRefresh = false) {
      const sym = String(code || '').trim().toUpperCase().replace(/\./g, '-');
      if (!VALID_US_SYMBOL_RE.test(sym)) {
        throw new CM.ValueError('請輸入有效美股代號（如 NVDA、AAPL、TSM、SPY、BRK-B）');
      }

      const cacheFile = this._cachePath(`detail-${sym}.json`);
      if (!forceRefresh) {
        const cached = await this._readFresh(cacheFile, UsMarketService.DETAIL_TTL);
        if (cached && cached.tech && 'cmf20' in cached.tech) {
          return cached;
        }
      }

      const flightKey = `${sym}:${forceRefresh ? '1' : '0'}`;
      if (this._detailInFlight.has(flightKey)) {
        return this._detailInFlight.get(flightKey);
      }

      const task = (async () => {
        const [bars, meta] = await this._fetchChartRaw(sym, '2y');
        const tech = analyzeUsBars(bars, meta);
        const uMap = getUniverseMap();
        const preset = uMap[sym] || ['', ''];
        const presetName = preset[0];
        const presetSector = preset[1];
        const displayName = presetName || meta.longName || meta.shortName || sym;
        const result = {
          code: sym,
          name: displayName,
          sector: presetSector || meta.instrumentType || 'EQUITY',
          exchange: meta.fullExchangeName || meta.exchangeName || 'US',
          currency: meta.currency || 'USD',
          bars,
          tech,
          source: 'Yahoo Finance (US 2Y Daily OHLCV)',
          fetched: taipeiNowStr()
        };
        await this._writeJson(cacheFile, result);
        return result;
      })();

      this._detailInFlight.set(flightKey, task);
      try {
        return await task;
      } finally {
        this._detailInFlight.delete(flightKey);
      }
    }

    async _scanOneScreener(entry) {
      const [sym, name, sector] = entry;
      try {
        const [bars, meta] = await this._fetchChartRaw(sym, '1y');
        const tech = analyzeUsBars(bars, meta);
        const flags = [];
        if (!tech.belowMa5 && !tech.belowMa10) flags.push('aboveShortMa');
        if (tech.belowMa5) flags.push('belowMa5');
        if (tech.belowMa10) flags.push('belowMa10');
        if (tech.aboveMa200) flags.push('aboveMa200');
        if (tech.macd.tone === 'up') flags.push('macdBull');
        if (tech.cmf20 !== null && tech.cmf20 >= 0.05) flags.push('cmfPos');
        const rsiVal = tech.rsi.value;
        if (rsiVal !== null && rsiVal >= 60) flags.push('rsiStrong');
        if (rsiVal !== null && rsiVal <= 35) flags.push('rsiLow');
        if (tech.volume.volRatio >= 1.3) flags.push('volSurge');
        if (tech.smartMoney.pass) flags.push('smartMoney');
        if (tech.dipBuy.pass) flags.push('dipBuy');
        return {
          code: sym,
          name,
          sector,
          exchange: meta.fullExchangeName || 'US',
          price: tech.price,
          change: tech.change,
          changePct: tech.changePct,
          ret20Pct: tech.ret20Pct,
          tradeDate: tech.tradeDate,
          ma5: tech.ma5,
          ma10: tech.ma10,
          ma20: tech.ma20,
          ma60: tech.ma60,
          ma200: tech.ma200,
          rsi14: rsiVal,
          cmf20: tech.cmf20,
          udVolRatio: tech.udVolRatio,
          obvRising: tech.obvRising,
          bbPos: tech.bbPos,
          macdStatus: tech.macd.status,
          macdTone: tech.macd.tone,
          vol: tech.volume.vol,
          volRatio: tech.volume.volRatio,
          pos52w: tech.range52w.posPct,
          fromHighPct: tech.range52w.fromHighPct,
          shortStatus: tech.shortMa.status,
          shortTone: tech.shortMa.tone,
          smartPass: tech.smartMoney.pass,
          smartScore: tech.smartMoney.score,
          smartReasons: tech.smartMoney.reasons,
          dipPass: tech.dipBuy.pass,
          dipScore: tech.dipBuy.score,
          dipReasons: tech.dipBuy.reasons,
          overallLabel: tech.overall.label,
          overallTone: tech.overall.tone,
          flags
        };
      } catch {
        return null;
      }
    }

    async _runFullScanWorker() {
      const cacheFile = this._cachePath('sp500-screener.json');
      const universe = getFullUniverse();
      const total = universe.length;
      const collected = [];
      let done = 0;
      const batchSize = 36;

      try {
        for (let start = 0; start < total; start += batchSize) {
          await CM.lifecycle.waitActive();
          const chunk = universe.slice(start, start + batchSize);
          const results = await CM.util.pool(chunk, 6, async entry => {
            await CM.lifecycle.waitActive();
            return this._scanOneScreener(entry);
          });
          for (let i = 0; i < results.length; i++) {
            if (results[i]) collected.push(results[i]);
          }
          done = Math.min(total, start + chunk.length);
          this._scanDone = done;
          this._scanRows = collected.slice();
          this._scanUpdatedAt = taipeiNowStr();
          if (this._resolveFirstBatch) {
            this._resolveFirstBatch();
            this._resolveFirstBatch = null;
          }
        }

        const finalTs = taipeiNowStr();
        const payload = _summarizeScreenerRows(collected, total, total, false, finalTs);
        if (collected.length >= 30) {
          await this._writeJson(cacheFile, payload);
          // 完整掃描完成後清除舊的總覽快取，確保總覽與全市場篩選數字完全同步
          try {
            await CM.fs.remove(this._cachePath('overview.json'));
          } catch {
            // 忽略不存在或刪除錯誤
          }
        }
      } finally {
        this._scanning = false;
        this._scanDone = total;
        this._scanPromise = null;
        if (this._resolveFirstBatch) {
          this._resolveFirstBatch();
          this._resolveFirstBatch = null;
        }
      }
    }

    async startBackgroundScan() {
      if (this._scanning) return false;
      this._scanning = true;
      this._scanDone = 0;
      this._scanTotal = getFullUniverse().length;

      let resolveFirst;
      this._firstBatchPromise = new Promise(resolve => {
        resolveFirst = resolve;
      });
      this._resolveFirstBatch = resolveFirst;

      if (!this._scanRows.length) {
        // 若有舊快取先留著顯示，避免畫面空白
        const old = await this._readAny(this._cachePath('sp500-screener.json'));
        if (old && Array.isArray(old.rows) && old.rows.length) {
          this._scanRows = old.rows.slice();
          this._scanUpdatedAt = old.updatedAt || '';
        }
      }

      this._scanPromise = this._runFullScanWorker().catch(() => {});
      return true;
    }

    async _waitForInitialBatch() {
      if (this._scanRows.length || !this._scanning || !this._firstBatchPromise) return;
      await Promise.race([this._firstBatchPromise, CM.util.sleep(3000)]);
    }

    async getScreener(forceRefresh = false) {
      const cacheFile = this._cachePath('sp500-screener.json');
      const universeLen = getFullUniverse().length;
      if (!forceRefresh) {
        if (this._scanning) {
          return _summarizeScreenerRows(
            this._scanRows.slice(),
            this._scanTotal || universeLen,
            this._scanDone,
            true,
            this._scanUpdatedAt || taipeiNowStr()
          );
        }
        const cached = await this._readFresh(cacheFile, UsMarketService.SCREENER_TTL);
        if (cached && (cached.count || 0) >= 400 && cached.counts) {
          return {
            ...cached,
            scanning: false,
            progress: { done: cached.count, total: universeLen }
          };
        }
      }

      await this.startBackgroundScan();
      await this._waitForInitialBatch();

      return _summarizeScreenerRows(
        this._scanRows.slice(),
        this._scanTotal || universeLen,
        this._scanDone,
        this._scanning,
        this._scanUpdatedAt || taipeiNowStr()
      );
    }

    async getOverview(forceRefresh = false) {
      const cacheFile = this._cachePath('overview.json');
      const universeLen = getFullUniverse().length;
      const spCache = await this._readFresh(this._cachePath('sp500-screener.json'), UsMarketService.SCREENER_TTL);
      const spReady = Boolean(spCache && (spCache.count || 0) >= 400 && spCache.counts);

      if (!forceRefresh) {
        const cached = await this._readFresh(cacheFile, UsMarketService.OVERVIEW_TTL);
        if (cached && cached.indices && cached.indices.length && !this._scanning) {
          if ((cached.universeCount || 0) >= 400) {
            return cached;
          }
          if (spReady) {
            const rows = spCache.rows || [];
            const ranked = rows.slice().sort((a, b) => b.changePct - a.changePct);
            const synced = {
              ...cached,
              sectors: (spCache.sectors || []).slice(0, 8),
              counts: spCache.counts,
              leaders: ranked.slice(0, 5),
              laggards: ranked.length >= 5 ? ranked.slice(-5).reverse() : [],
              universeCount: spCache.count,
              scanning: false,
              progress: { done: spCache.count, total: universeLen }
            };
            await this._writeJson(cacheFile, synced);
            return synced;
          }
        }
      }

      const indices = await CM.util.pool(US_OVERVIEW_INDICES, 6, async ([sym, name, tag]) => {
        let q = null;
        try {
          q = await CM.news.fetchYahooQuote(sym);
        } catch {
          q = null;
        }
        return {
          symbol: sym,
          name,
          tag,
          price: q ? q.price : null,
          change: q ? q.change : null,
          changePct: q ? q.changePct : null,
          tradeTime: q ? q.tradeTime : ''
        };
      });

      let scanningNow = false;
      let doneCnt = universeLen;
      let rows, sectors, counts;
      if (!forceRefresh && spReady) {
        rows = spCache.rows || [];
        sectors = spCache.sectors || [];
        counts = spCache.counts || {};
        doneCnt = rows.length;
      } else {
        await this.startBackgroundScan();
        await this._waitForInitialBatch();
        rows = this._scanRows.slice();
        scanningNow = this._scanning;
        doneCnt = this._scanDone || rows.length;
        const summary = _summarizeScreenerRows(rows, universeLen, doneCnt, scanningNow, '');
        sectors = summary.sectors;
        counts = summary.counts;
      }

      const ranked = rows.slice().sort((a, b) => b.changePct - a.changePct);
      const result = {
        updatedAt: taipeiNowStr(),
        indices,
        sectors: sectors.slice(0, 8),
        counts,
        leaders: ranked.slice(0, 5),
        laggards: ranked.length >= 5 ? ranked.slice(-5).reverse() : [],
        universeCount: rows.length,
        scanning: scanningNow,
        progress: { done: doneCnt, total: universeLen }
      };
      // 僅在掃描完成且覆蓋完整母體時才寫入長效總覽快取，避免過渡數字殘留
      if (!scanningNow && rows.length >= 400) {
        await this._writeJson(cacheFile, result);
      }
      return result;
    }
  }

  UsMarketService.OVERVIEW_TTL = 10 * 60;
  UsMarketService.SCREENER_TTL = 4 * 3600;
  UsMarketService.DETAIL_TTL = 2 * 3600;

  const api = {
    UsMarketService,
    analyzeUsBars,
    computeSma,
    computeEma,
    computeRsiSeries,
    computeMacdSeries,
    loadSp500Universe,
    VALID_US_SYMBOL_RE,
    US_OVERVIEW_INDICES,
    US_UNIVERSE
  };

  Object.defineProperty(api, 'FULL_US_UNIVERSE', {
    enumerable: true,
    configurable: true,
    get: getFullUniverse
  });

  Object.defineProperty(api, 'US_UNIVERSE_MAP', {
    enumerable: true,
    configurable: true,
    get: getUniverseMap
  });

  CM.usMarket = api;
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/services/watchlist.js ===
/**
 * 股票收藏夾與自動分析服務（行動版移植自 scripts/providers/watchlist.py）
 * - 以 CM.fs 隔離儲存自訂收藏夾與持股估算設定至 user-v1/watchlists.json
 * - 提供批次報價更新（併發上限 6）與六大維度自動分析（短均、中均、TDCC 大戶、三大法人、量價、融資融券；美股委由 UsMarketService）
 * - 行動版差異：setAutoEnabled 不操作 Windows Task Scheduler，改於 CM.news.BriefingService 提供排程同步方法時委派通知排程同步
 */
(function (CM) {
  'use strict';

  const VALID_TW_CODE_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/;
  const VALID_SYMBOL_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?|[A-Z][A-Z0-9.-]{0,7})$/;

  const pad2 = n => String(n).padStart(2, '0');

  function roundPy(x, digits = 0) {
    const r = CM.util.pyRound(x, digits);
    return r === 0 ? 0 : r;
  }

  function formatTaipeiDateTime(ms = Date.now()) {
    const p = CM.time.taipeiParts(ms);
    return `${p.date} ${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;
  }

  function formatIntWithCommas(n) {
    return String(Math.abs(Math.trunc(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function computeMaLast(values, period) {
    if (!values || values.length < period) return null;
    let sum = 0;
    for (let i = values.length - period; i < values.length; i++) sum += values[i];
    return roundPy(sum / period, 2);
  }

  function pctBias(price, ref) {
    if (!ref || ref <= 0) return null;
    return roundPy(((price - ref) / ref) * 100.0, 2);
  }

  function lookupUsName(code) {
    const map = CM.usMarket && CM.usMarket.US_UNIVERSE_MAP;
    if (map && Object.prototype.hasOwnProperty.call(map, code)) {
      const entry = map[code];
      if (Array.isArray(entry) && entry.length > 0) return String(entry[0]);
      if (entry && typeof entry === 'object' && entry.name) return String(entry.name);
      if (typeof entry === 'string') return entry;
    }
    const baseList = CM.base && CM.base.usUniverse;
    if (Array.isArray(baseList)) {
      for (const row of baseList) {
        if (Array.isArray(row) && row[0] === code && row[1]) return String(row[1]);
      }
    }
    return code;
  }

  class WatchlistService {
    constructor(appDataDir = '', twMarketService = null, { stockNames = {}, baseSeries = {}, feedService = null } = {}) {
      const baseDir = String(appDataDir || '').replace(/^\/+|\/+$/g, '');
      this.appDataDir = baseDir;
      this.twMarket = twMarketService;
      this.stockNames = stockNames || {};
      this.baseSeries = baseSeries || {};
      this.feedService = feedService || null;

      this.userDir = CM.fs.joinPath(baseDir, 'user-v1');
      this.watchlistsFile = CM.fs.joinPath(this.userDir, 'watchlists.json');
      this.analysisDir = CM.fs.joinPath(baseDir, 'watchlist-analysis-v1');
      this.quotesFile = CM.fs.joinPath(this.analysisDir, 'quotes.json');
      this.latestAnalysisFile = CM.fs.joinPath(this.analysisDir, 'latest.json');
      this._lockChain = Promise.resolve();
    }

    async init() {
      // 狀態採按需讀取，無須於初始化階段預載
    }

    _withLock(fn) {
      const prev = this._lockChain;
      let release;
      this._lockChain = new Promise(resolve => {
        release = resolve;
      });
      return prev.then(fn).finally(release);
    }

    async _readJson(path, fallback) {
      const data = await CM.fs.readJson(path, null);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : { ...fallback };
    }

    async _writeJson(path, payload) {
      await CM.fs.writeJson(path, payload);
    }

    _stockMeta(code) {
      const isTw = VALID_TW_CODE_RE.test(code);
      if (isTw) {
        const info = this.stockNames[code];
        if (Array.isArray(info) && info.length > 0) {
          return [String(info[0]), String(info.length > 1 ? info[1] : 'TWSE')];
        }
        return [code.startsWith('00') ? 'ETF' : code, 'TWSE'];
      }
      return [lookupUsName(code), 'US'];
    }

    async _normalizeStore(raw = null) {
      const data =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? raw
          : await this._readJson(this.watchlistsFile, {});
      const autoEnabled = Object.prototype.hasOwnProperty.call(data, 'autoEnabled')
        ? Boolean(data.autoEnabled)
        : true;

      const autoStocks = [];
      if (Array.isArray(data.autoStocks)) {
        for (const s of data.autoStocks) {
          const sym = String(s ?? '').trim().toUpperCase();
          if (VALID_SYMBOL_RE.test(sym) && !autoStocks.includes(sym)) {
            autoStocks.push(sym);
          }
        }
      }

      const folders = [];
      const seenIds = new Set();
      if (Array.isArray(data.folders)) {
        for (let idx = 0; idx < data.folders.length; idx++) {
          const f = data.folders[idx];
          if (!f || typeof f !== 'object' || Array.isArray(f)) continue;
          let fid = String(f.id || `wl_${idx + 1}`).replace(/[^A-Za-z0-9_-]/g, '') || `wl_${idx + 1}`;
          while (seenIds.has(fid)) {
            fid = `${fid}_${seenIds.size + 1}`;
          }
          seenIds.add(fid);
          const fname = String(f.name || '未命名收藏夾').trim().slice(0, 30) || '未命名收藏夾';
          const items = [];
          const seenCodes = new Set();
          const rawItems = Array.isArray(f.items) ? f.items : [];
          for (const it of rawItems) {
            if (!it || typeof it !== 'object' || Array.isArray(it)) continue;
            const code = String(it.code || '').trim().toUpperCase();
            if (!VALID_SYMBOL_RE.test(code) || seenCodes.has(code)) continue;
            seenCodes.add(code);

            let shares = 0;
            const sharesRaw = it.shares;
            if (sharesRaw !== null && sharesRaw !== undefined && sharesRaw !== '') {
              const parsed = Number(sharesRaw);
              if (Number.isFinite(parsed) && parsed >= 0) shares = parsed;
            }

            let costPrice = null;
            const costRaw = it.costPrice;
            if (costRaw !== null && costRaw !== undefined && costRaw !== '') {
              const cp = Number(costRaw);
              if (Number.isFinite(cp) && cp > 0) costPrice = roundPy(cp, 4);
            }

            items.push({
              code,
              shares: Number.isInteger(shares) ? shares : roundPy(shares, 4),
              costPrice,
              showValuation: Boolean(it.showValuation),
              addedAt: String(it.addedAt || ''),
            });
          }
          folders.push({ id: fid, name: fname, items });
        }
      }

      if (!folders.length) {
        folders.push({ id: 'wl_default', name: '我的自選股', items: [] });
      }

      return {
        version: 1,
        autoEnabled,
        folders,
        autoStocks,
      };
    }

    _enrichStore(store) {
      const autoSet = new Set(store.autoStocks);
      const enrichedFolders = store.folders.map(f => ({
        id: f.id,
        name: f.name,
        items: f.items.map(it => {
          const [name, market] = this._stockMeta(it.code);
          return {
            ...it,
            name,
            market,
            inAuto: autoSet.has(it.code),
          };
        }),
      }));

      const autoMeta = store.autoStocks.map(code => {
        const [name, market] = this._stockMeta(code);
        return { code, name, market };
      });

      return {
        version: 1,
        autoEnabled: store.autoEnabled,
        folders: enrichedFolders,
        autoStocks: store.autoStocks,
        autoStockMeta: autoMeta,
        storagePath: this.watchlistsFile,
      };
    }

    async getQuotes() {
      const raw = await this._readJson(this.quotesFile, { quotes: {}, updatedAt: '' });
      return raw && raw.quotes && typeof raw.quotes === 'object' && !Array.isArray(raw.quotes)
        ? raw
        : { quotes: {}, updatedAt: '' };
    }

    async getLatestAnalysis() {
      const data = await CM.fs.readJson(this.latestAnalysisFile, null);
      return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
    }

    async shouldAutoRun() {
      const store = await this._normalizeStore();
      if (!store.autoEnabled || !store.autoStocks.length) return false;
      const now = CM.time.taipeiParts();
      if (now.hour < 10) return false;
      const todayFile = CM.fs.joinPath(this.analysisDir, `${now.date}.json`);
      const res = await CM.fs.readText(todayFile);
      return !(res && res.exists);
    }

    async getState() {
      const store = await this._normalizeStore();
      const quotesDoc = await this.getQuotes();
      return {
        config: this._enrichStore(store),
        quotes: quotesDoc.quotes || {},
        quotesUpdatedAt: quotesDoc.updatedAt || '',
        analysis: await this.getLatestAnalysis(),
        shouldAutoRun: await this.shouldAutoRun(),
      };
    }

    async _saveAndState(store) {
      await this._writeJson(this.watchlistsFile, store);
      return this.getState();
    }

    async createFolder(name) {
      const clean = String(name ?? '').trim().slice(0, 30);
      if (!clean) throw new CM.ValueError('收藏夾名稱不能為空');
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const existingIds = new Set(store.folders.map(f => f.id));
        let idx = store.folders.length + 1;
        let fid = `wl_${Math.floor(Date.now() / 1000)}_${idx}`;
        while (existingIds.has(fid)) {
          idx += 1;
          fid = `wl_${Math.floor(Date.now() / 1000)}_${idx}`;
        }
        store.folders.push({ id: fid, name: clean, items: [] });
        const state = await this._saveAndState(store);
        return { ...state, createdFolderId: fid };
      });
    }

    async renameFolder(folderId, name) {
      const clean = String(name ?? '').trim().slice(0, 30);
      if (!clean) throw new CM.ValueError('收藏夾名稱不能為空');
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const target = store.folders.find(f => f.id === folderId);
        if (!target) throw new CM.ValueError('找不到指定收藏夾');
        target.name = clean;
        return this._saveAndState(store);
      });
    }

    async deleteFolder(folderId) {
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const before = store.folders.length;
        store.folders = store.folders.filter(f => f.id !== folderId);
        if (store.folders.length === before) throw new CM.ValueError('找不到指定收藏夾');
        if (!store.folders.length) {
          store.folders = [{ id: 'wl_default', name: '我的自選股', items: [] }];
        }
        return this._saveAndState(store);
      });
    }

    async addStock(folderId, code) {
      const sym = String(code ?? '').trim().toUpperCase();
      if (!VALID_SYMBOL_RE.test(sym)) {
        throw new CM.ValueError('請輸入有效台股或美股代號（如 2330、0050、NVDA）');
      }
      await this._withLock(async () => {
        const store = await this._normalizeStore();
        const target = store.folders.find(f => f.id === folderId);
        if (!target) throw new CM.ValueError('找不到指定收藏夾');
        if (target.items.some(it => it.code === sym)) {
          throw new CM.ValueError(`${sym} 已在此收藏夾中`);
        }
        target.items.push({
          code: sym,
          shares: 0,
          costPrice: null,
          showValuation: false,
          addedAt: CM.time.taipeiIso(undefined, 'seconds'),
        });
        await this._writeJson(this.watchlistsFile, store);
      });

      // 即時補捉單檔報價（不阻斷失敗）
      const q = await this._fetchSingleQuote(sym);
      if (q) {
        const quotesDoc = await this.getQuotes();
        const quotesMap = { ...(quotesDoc.quotes || {}), [sym]: q };
        await this._writeJson(this.quotesFile, {
          quotes: quotesMap,
          updatedAt: formatTaipeiDateTime(),
        });
      }

      return this.getState();
    }

    async updateItem(folderId, code, updates) {
      const sym = String(code ?? '').trim().toUpperCase();
      const upd = updates && typeof updates === 'object' ? updates : {};
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const target = store.folders.find(f => f.id === folderId);
        if (!target) throw new CM.ValueError('找不到指定收藏夾');
        const item = target.items.find(it => it.code === sym);
        if (!item) throw new CM.ValueError(`此收藏夾中找不到 ${sym}`);

        if ('showValuation' in upd) {
          item.showValuation = Boolean(upd.showValuation);
        }
        if ('shares' in upd) {
          const rawShares = upd.shares;
          if (rawShares === null || rawShares === undefined || rawShares === '') {
            item.shares = 0;
          } else {
            const val = Number(rawShares);
            if (!Number.isFinite(val)) throw new CM.ValueError('持有股數格式無效');
            if (val < 0) throw new CM.ValueError('持有股數不能為負數');
            item.shares = Number.isInteger(val) ? val : roundPy(val, 4);
          }
        }
        if ('costPrice' in upd) {
          const rawCost = upd.costPrice;
          if (rawCost === null || rawCost === undefined || rawCost === '') {
            item.costPrice = null;
          } else {
            const cp = Number(rawCost);
            if (!Number.isFinite(cp)) throw new CM.ValueError('購入價格格式無效');
            if (cp <= 0) throw new CM.ValueError('購入價格須大於 0（不填可留空）');
            item.costPrice = roundPy(cp, 4);
          }
        }
        if ('autoAnalyze' in upd) {
          const wantAuto = Boolean(upd.autoAnalyze);
          if (wantAuto && !store.autoStocks.includes(sym)) {
            store.autoStocks.push(sym);
          } else if (!wantAuto) {
            store.autoStocks = store.autoStocks.filter(c => c !== sym);
          }
        }

        return this._saveAndState(store);
      });
    }

    async removeItem(folderId, code) {
      const sym = String(code ?? '').trim().toUpperCase();
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        const target = store.folders.find(f => f.id === folderId);
        if (!target) throw new CM.ValueError('找不到指定收藏夾');
        const before = target.items.length;
        target.items = target.items.filter(it => it.code !== sym);
        if (target.items.length === before) throw new CM.ValueError(`此收藏夾中找不到 ${sym}`);
        return this._saveAndState(store);
      });
    }

    async toggleAutoStock(code, enabled) {
      const sym = String(code ?? '').trim().toUpperCase();
      if (!VALID_SYMBOL_RE.test(sym)) throw new CM.ValueError('股票代號格式無效');
      return this._withLock(async () => {
        const store = await this._normalizeStore();
        if (enabled) {
          if (!store.autoStocks.includes(sym)) store.autoStocks.push(sym);
        } else {
          store.autoStocks = store.autoStocks.filter(c => c !== sym);
        }
        return this._saveAndState(store);
      });
    }

    async setAutoEnabled(enabled) {
      await this._withLock(async () => {
        const store = await this._normalizeStore();
        store.autoEnabled = Boolean(enabled);
        await this._writeJson(this.watchlistsFile, store);
      });
      // 行動版以本機每日通知取代 Windows Task Scheduler，若 BriefingService 可用則同步排程
      try {
        const BriefingCls = CM.news && CM.news.BriefingService;
        if (typeof BriefingCls === 'function') {
          const svc = new BriefingCls(this.appDataDir, this.stockNames);
          if (typeof svc.init === 'function') await svc.init();
          if (typeof svc.syncSharedSchedule === 'function') {
            await svc.syncSharedSchedule();
          } else if (typeof svc.syncSharedWindowsTask === 'function') {
            await svc.syncSharedWindowsTask();
          }
        }
      } catch {
        // 通知排程同步失敗不影響收藏夾設定儲存
      }
      return this.getState();
    }

    async _fetchSingleQuote(code) {
      const fetchQuote = CM.news && CM.news.fetchYahooQuote;
      if (typeof fetchQuote !== 'function') return null;
      const isTw = VALID_TW_CODE_RE.test(code);
      let q = null;
      try {
        if (isTw) {
          q = (await fetchQuote(`${code}.TW`)) || (await fetchQuote(`${code}.TWO`));
        } else {
          q = await fetchQuote(code);
        }
      } catch {
        return null;
      }
      if (!q) return null;
      const [name, market] = this._stockMeta(code);
      return {
        code,
        name,
        market,
        ...q,
      };
    }

    async refreshQuotes(codes = null) {
      const store = await this._normalizeStore();
      const allCodes = [];
      if (Array.isArray(codes) && codes.length > 0) {
        for (const c of codes) {
          const s = String(c ?? '').trim().toUpperCase();
          if (VALID_SYMBOL_RE.test(s) && !allCodes.includes(s)) {
            allCodes.push(s);
          }
        }
      } else {
        for (const f of store.folders) {
          for (const it of f.items) {
            if (!allCodes.includes(it.code)) allCodes.push(it.code);
          }
        }
        for (const c of store.autoStocks) {
          if (!allCodes.includes(c)) allCodes.push(c);
        }
      }

      const quotesDoc = await this.getQuotes();
      const quotesMap = { ...(quotesDoc.quotes || {}) };

      if (allCodes.length > 0) {
        const fetched = await CM.util.pool(allCodes, 6, async sym => {
          await CM.lifecycle.waitActive();
          return this._fetchSingleQuote(sym);
        });
        for (let i = 0; i < allCodes.length; i++) {
          if (fetched[i]) quotesMap[allCodes[i]] = fetched[i];
        }
      }

      const updatedDoc = { quotes: quotesMap, updatedAt: formatTaipeiDateTime() };
      await this._writeJson(this.quotesFile, updatedDoc);
      return this.getState();
    }

    async _latestTdccSeries() {
      const merged = Object.create(null);
      if (this.baseSeries && typeof this.baseSeries === 'object') {
        for (const [day, rows] of Object.entries(this.baseSeries)) {
          if (rows && typeof rows === 'object') merged[day] = rows;
        }
      }
      const feedWeeks = this.feedService && this.feedService.weeks;
      if (feedWeeks && typeof feedWeeks === 'object' && Object.keys(feedWeeks).length > 0) {
        for (const [day, doc] of Object.entries(feedWeeks)) {
          const rows = Object.assign({}, (doc && doc.rows) || {}, (doc && doc.extraRows) || {});
          merged[day] = rows;
        }
      } else {
        const officialDir = CM.fs.joinPath(this.appDataDir, 'tdcc-local-v1', 'official');
        const entries = (await CM.fs.list(officialDir))
          .filter(f => f.name.endsWith('.json'))
          .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
          const doc = await CM.fs.readJson(CM.fs.joinPath(officialDir, entry.name), null);
          if (doc && typeof doc === 'object') {
            const rows = Object.assign({}, doc.rows || {}, doc.extraRows || {});
            merged[entry.name.slice(0, -5)] = rows;
          }
        }
      }
      return Object.entries(merged).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    }

    _computeTdccDim(code, weeks) {
      const matched = [];
      for (const [day, rows] of weeks) {
        const row = rows && rows[code];
        if (Array.isArray(row) && row.length >= 10 && row[0] > 0) {
          matched.push([day, row]);
        }
      }
      if (matched.length < 2) {
        if (matched.length === 1) {
          const [day, r] = matched[0];
          const pct400 = roundPy((100.0 * r[3]) / r[0], 3);
          return {
            weekDay: day,
            pct400,
            deltaPp400: null,
            deltaShares400: null,
            deltaPp1000: null,
            status: '僅單週集保快照',
            tone: 'neutral',
          };
        }
        return {
          weekDay: '',
          pct400: null,
          deltaPp400: null,
          deltaShares400: null,
          deltaPp1000: null,
          status: '無集保資料',
          tone: 'neutral',
        };
      }

      const [prevDay, prevR] = matched[matched.length - 2];
      const [curDay, curR] = matched[matched.length - 1];
      const pct400Cur = (100.0 * curR[3]) / curR[0];
      const pct400Prev = (100.0 * prevR[3]) / prevR[0];
      const pct1000Cur = (100.0 * curR[5]) / curR[0];
      const pct1000Prev = (100.0 * prevR[5]) / prevR[0];
      const deltaPp400 = roundPy(pct400Cur - pct400Prev, 3);
      const deltaShares400 = Math.trunc(curR[3] - prevR[3]);
      const deltaPp1000 = roundPy(pct1000Cur - pct1000Prev, 3);

      let status;
      let tone;
      if (deltaPp400 > 0.005) {
        status = '大戶買超';
        tone = 'up';
      } else if (deltaPp400 < -0.005) {
        status = '大戶賣超';
        tone = 'down';
      } else {
        status = '大戶持平';
        tone = 'neutral';
      }

      return {
        weekDay: curDay,
        prevDay,
        pct400: roundPy(pct400Cur, 3),
        deltaPp400,
        deltaShares400,
        deltaPp1000,
        status,
        tone,
      };
    }

    async _fetchUsBars(code) {
      const httpGet = CM.news && CM.news.httpGet;
      if (typeof httpGet !== 'function') return [];
      const encoded = encodeURIComponent(code);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=6mo&interval=1d`;
      try {
        const raw = await httpGet(url, 12);
        const payload = JSON.parse(CM.util.utf8Decode(raw));
        const res = payload.chart.result[0];
        const tsList = res.timestamp || [];
        const q = ((res.indicators && res.indicators.quote) || [{}])[0] || {};
        const opens = q.open || [];
        const highs = q.high || [];
        const lows = q.low || [];
        const closes = q.close || [];
        const vols = q.volume || [];
        const len = Math.min(tsList.length, opens.length, highs.length, lows.length, closes.length, vols.length);
        const bars = [];
        for (let i = 0; i < len; i++) {
          const ts = tsList[i];
          const o = opens[i];
          const h = highs[i];
          const l = lows[i];
          const c = closes[i];
          const v = vols[i];
          if (ts == null || o == null || h == null || l == null || c == null) continue;
          const d = CM.time.taipeiParts(ts * 1000).date;
          bars.push([d, Number(o), Number(h), Number(l), Number(c), Math.trunc(v || 0)]);
        }
        return bars;
      } catch {
        return [];
      }
    }

    async _analyzeOne(code, weeks) {
      const isTw = VALID_TW_CODE_RE.test(code);
      const [name, market] = this._stockMeta(code);
      let detail = null;
      let errMsg = '';

      if (!isTw) {
        try {
          const UsSvcCls = CM.usMarket && CM.usMarket.UsMarketService;
          if (typeof UsSvcCls !== 'function') {
            throw new Error(`無法取得 ${code} 美股日行情`);
          }
          const usSvc = new UsSvcCls(CM.fs.joinPath(this.appDataDir, 'us-cache-v1'));
          if (typeof usSvc.init === 'function') await usSvc.init();
          const usDetail = await usSvc.getDetail(code, true);
          const tech = usDetail.tech;
          const flags = [];
          if (tech.belowMa5) flags.push('belowMa5');
          if (tech.belowMa10) flags.push('belowMa10');
          if (tech.overall && tech.overall.divergenceAlert) flags.push('divergence');
          return {
            code: usDetail.code,
            name: usDetail.name || name,
            market: 'US',
            isTw: false,
            price: tech.price,
            prevClose: tech.prevClose,
            change: tech.change,
            changePct: tech.changePct,
            tradeDate: tech.tradeDate,
            shortMa: tech.shortMa,
            midMa: tech.midMa,
            rsi: tech.rsi,
            macd: tech.macd,
            volume: tech.volume,
            range52w: tech.range52w,
            overall: tech.overall,
            filterFlags: flags,
          };
        } catch (exc) {
          return {
            code,
            name,
            market: 'US',
            isTw: false,
            error: (exc && exc.message) || `無法取得 ${code} 美股日行情`,
            price: null,
            change: null,
            changePct: null,
            filterFlags: [],
          };
        }
      }

      try {
        detail = await this.twMarket.getDetail(code, true);
      } catch (exc) {
        errMsg = (exc && exc.message) || String(exc || '');
      }

      if (!detail || !Array.isArray(detail.bars) || !detail.bars.length) {
        return {
          code,
          name,
          market,
          error: errMsg || '暫無行情資料',
          price: null,
          change: null,
          changePct: null,
          filterFlags: [],
        };
      }

      const bars = detail.bars;
      const closes = bars.map(b => Number(b[4]));
      const vols = bars.map(b => Math.trunc(Number(b[5])));
      const last = bars[bars.length - 1];
      const prev = bars.length >= 2 ? bars[bars.length - 2] : last;
      const close = Number(last[4]);
      const prevCloseRaw = Number(prev[4]);
      const chg = roundPy(close - prevCloseRaw, 2);
      const chgPct = roundPy(prevCloseRaw ? (chg / prevCloseRaw) * 100.0 : 0.0, 2);

      const ma5 = computeMaLast(closes, 5);
      const ma10 = computeMaLast(closes, 10);
      const ma20 = computeMaLast(closes, 20);
      const ma60 = computeMaLast(closes, 60);
      const mv5 = computeMaLast(vols, 5);

      const bias5 = pctBias(close, ma5);
      const bias10 = pctBias(close, ma10);
      const bias20 = pctBias(close, ma20);
      const bias60 = pctBias(close, ma60);

      const belowMa5 = ma5 !== null && close < ma5;
      const belowMa10 = ma10 !== null && close < ma10;

      let shortStatus;
      let shortTone;
      if (ma5 === null || ma10 === null) {
        shortStatus = '日K天數不足';
        shortTone = 'neutral';
      } else if (!belowMa5 && !belowMa10) {
        shortStatus = '站上 5日 / 10日線';
        shortTone = 'up';
      } else if (belowMa5 && belowMa10) {
        shortStatus = '低於 5日與 10日線';
        shortTone = 'down';
      } else if (belowMa5) {
        shortStatus = '低於 5日線、守 10日線';
        shortTone = 'neutral';
      } else {
        shortStatus = '站上 5日線、壓 10日線';
        shortTone = 'neutral';
      }

      let midStatus;
      let midTone;
      if (ma20 === null || ma60 === null) {
        midStatus = '均線天數不足';
        midTone = 'neutral';
      } else if (close >= ma20 && close >= ma60) {
        midStatus = '站穩月線與季線';
        midTone = 'up';
      } else if (close < ma20 && close < ma60) {
        midStatus = '位於月季線之下';
        midTone = 'down';
      } else if (close >= ma60) {
        midStatus = '月線下守季線';
        midTone = 'neutral';
      } else {
        midStatus = '站月線壓季線';
        midTone = 'neutral';
      }

      const vol = Math.trunc(Number(last[5]));
      const volRatio = mv5 && mv5 > 0 ? roundPy(vol / mv5, 2) : 1.0;
      const volRatioStr = volRatio.toFixed(2);
      let volStatus;
      let volTone;
      if (chg > 0 && volRatio >= 1.15) {
        volStatus = `價漲量增 (${volRatioStr}x)`;
        volTone = 'up';
      } else if (chg < 0 && volRatio >= 1.2) {
        volStatus = `帶量回檔 (${volRatioStr}x)`;
        volTone = 'down';
      } else if (volRatio < 0.75) {
        volStatus = `量縮整理 (${volRatioStr}x)`;
        volTone = 'neutral';
      } else {
        volStatus = `量能溫和 (${volRatioStr}x)`;
        volTone = 'neutral';
      }

      // 維度 3：TDCC 大戶
      const tdccDim = isTw
        ? this._computeTdccDim(code, weeks)
        : {
            weekDay: '',
            pct400: null,
            deltaPp400: null,
            deltaShares400: null,
            deltaPp1000: null,
            status: '美股不適用台股集保',
            tone: 'neutral',
          };

      // 維度 4：三大法人
      const instRows = Array.isArray(detail.inst) ? detail.inst : [];
      let instDim;
      if (isTw && instRows.length > 0) {
        const r5 = instRows.slice(-5);
        const f5 = r5.reduce((acc, r) => acc + Math.trunc(Number(r[1])), 0);
        const t5 = r5.reduce((acc, r) => acc + Math.trunc(Number(r[2])), 0);
        const d5 = r5.reduce((acc, r) => acc + Math.trunc(Number(r[3])), 0);
        const inst5 = f5 + t5 + d5;
        const lastRow = instRows[instRows.length - 1];
        const lastInst = Math.trunc(Number(lastRow[1]) + Number(lastRow[2]) + Number(lastRow[3]));
        const instStatus = inst5 > 0 ? '法人買超' : inst5 < 0 ? '法人賣超' : '法人持平';
        const instTone = inst5 > 0 ? 'up' : inst5 < 0 ? 'down' : 'neutral';
        instDim = {
          lastDate: lastRow[0],
          lastTotal: lastInst,
          inst5Total: inst5,
          foreign5: f5,
          trust5: t5,
          dealer5: d5,
          status: instStatus,
          tone: instTone,
        };
      } else {
        instDim = {
          lastDate: '',
          lastTotal: null,
          inst5Total: null,
          foreign5: null,
          trust5: null,
          dealer5: null,
          status: !isTw ? '美股無三大法人' : '無法人資料',
          tone: 'neutral',
        };
      }

      // 維度 6：融資融券
      const marginRows = Array.isArray(detail.margin) ? detail.margin : [];
      let marginDim;
      if (isTw && marginRows.length > 0) {
        const lm = marginRows[marginRows.length - 1];
        const m5 = marginRows.slice(-5).reduce((acc, r) => acc + Math.trunc(Number(r[2])), 0);
        const s5 = marginRows.slice(-5).reduce((acc, r) => acc + Math.trunc(Number(r[4])), 0);
        const mb = Math.trunc(Number(lm[1]));
        const sb = Math.trunc(Number(lm[3]));
        const ratio = mb > 0 ? roundPy((sb / mb) * 100.0, 2) : 0.0;
        let mStatus;
        let mTone;
        if (m5 < 0 && chg >= 0) {
          mStatus = '資減籌碼沉澱';
          mTone = 'up';
        } else if (m5 > 0 && chg < 0) {
          mStatus = '跌勢資增須留意';
          mTone = 'down';
        } else {
          mStatus = `資${m5 >= 0 ? '增' : '減'} ${formatIntWithCommas(m5)} 張`;
          mTone = 'neutral';
        }
        marginDim = {
          lastDate: lm[0],
          marginBal: mb,
          margin5Delta: m5,
          shortBal: sb,
          short5Delta: s5,
          shortMarginRatio: ratio,
          status: mStatus,
          tone: mTone,
        };
      } else {
        marginDim = {
          lastDate: '',
          marginBal: null,
          margin5Delta: null,
          shortBal: null,
          short5Delta: null,
          shortMarginRatio: null,
          status: !isTw ? '美股無信用資料' : '無融資融券資料',
          tone: 'neutral',
        };
      }

      // 綜合訊號與背離標籤
      const shortBull = ma5 !== null && ma10 !== null && !belowMa5 && !belowMa10;
      const shortWeak = belowMa5 || belowMa10;
      const chipBull = tdccDim.tone === 'up' || instDim.tone === 'up';
      const chipBear = tdccDim.tone === 'down' || instDim.tone === 'down';

      let divergenceAlert = '';
      let overallLabel;
      let overallTone;
      let summary;
      if (shortWeak && chipBull) {
        overallLabel = '價弱籌碼有撐（低檔承接）';
        overallTone = 'neutral';
        divergenceAlert = '底背離留意：股價破短均但大戶／法人仍買超';
        summary = '短線股價低於 5 日或 10 日線，惟集保大戶或三大法人維持偏多買超，具低檔承接觀察價值。';
      } else if (shortBull && chipBear && tdccDim.tone !== 'up' && instDim.tone !== 'up') {
        overallLabel = '價強籌碼背離（留意調節）';
        overallTone = 'neutral';
        divergenceAlert = '高檔背離警戒：股價站短均但大戶與法人同步賣超';
        summary = '股價站穩短均線之上，但大戶與法人呈調節賣超，追價宜留意量價與籌碼延續性。';
      } else if (shortBull && chipBull) {
        overallLabel = '價強籌碼穩（偏多結構）';
        overallTone = 'up';
        summary = '股價站上 5 日與 10 日均線且獲大戶或法人買盤支撐，多方格局一致。';
      } else if (!isTw && shortBull) {
        overallLabel = '美股短多均線強勢';
        overallTone = 'up';
        summary = '收盤站上 5 日與 10 日均線，短中期趨勢偏多。';
      } else {
        overallLabel = '均線承壓（偏弱觀察）';
        overallTone = 'down';
        summary = '股價低於短期均線且籌碼動能偏保守，宜待站回 5 日／10 日線或法人轉買。';
      }

      const flags = [];
      if (belowMa5) flags.push('belowMa5');
      if (belowMa10) flags.push('belowMa10');
      if (tdccDim.tone === 'up') flags.push('tdccBuy');
      else if (tdccDim.tone === 'down') flags.push('tdccSell');
      if (instDim.tone === 'up') flags.push('instBuy');
      else if (instDim.tone === 'down') flags.push('instSell');
      if (divergenceAlert) flags.push('divergence');

      return {
        code,
        name,
        market,
        isTw,
        price: roundPy(close, 2),
        prevClose: roundPy(prevCloseRaw, 2),
        change: chg,
        changePct: chgPct,
        tradeDate: last[0],
        shortMa: {
          ma5,
          ma10,
          bias5Pct: bias5,
          bias10Pct: bias10,
          belowMa5,
          belowMa10,
          status: shortStatus,
          tone: shortTone,
        },
        midMa: {
          ma20,
          ma60,
          bias20Pct: bias20,
          bias60Pct: bias60,
          status: midStatus,
          tone: midTone,
        },
        tdcc: tdccDim,
        inst: instDim,
        volume: {
          vol,
          mv5: mv5 ? roundPy(mv5, 0) : null,
          volRatio,
          status: volStatus,
          tone: volTone,
        },
        margin: marginDim,
        overall: {
          label: overallLabel,
          tone: overallTone,
          summary,
          divergenceAlert,
        },
        filterFlags: flags,
      };
    }

    async runAutoAnalysis(trigger = '手動立即更新分析') {
      const store = await this._normalizeStore();
      const now = CM.time.taipeiParts();
      const today = now.date;
      const autoCodes = store.autoStocks;
      const weeks = await this._latestTdccSeries();

      let items = [];
      if (autoCodes.length > 0) {
        items = await CM.util.pool(autoCodes, 4, async code => {
          await CM.lifecycle.waitActive();
          return this._analyzeOne(code, weeks);
        });
      }

      // 順便同步寫入最新收盤價快取（若未有盤中報價則補齊）
      const quotesDoc = await this.getQuotes();
      const quotesMap = { ...(quotesDoc.quotes || {}) };
      for (const it of items) {
        if (it && it.price !== null && it.price !== undefined) {
          quotesMap[it.code] = {
            code: it.code,
            name: it.name,
            market: it.market,
            price: it.price,
            prevClose: it.prevClose,
            change: it.change,
            changePct: it.changePct,
            tradeTime: it.tradeDate,
          };
        }
      }
      if (items.length > 0) {
        await this._writeJson(this.quotesFile, {
          quotes: quotesMap,
          updatedAt: formatTaipeiDateTime(now.ms),
        });
      }

      const countFlag = flag => items.filter(x => x && Array.isArray(x.filterFlags) && x.filterFlags.includes(flag)).length;
      const counts = {
        total: items.length,
        belowMa5: countFlag('belowMa5'),
        belowMa10: countFlag('belowMa10'),
        tdccBuy: countFlag('tdccBuy'),
        tdccSell: countFlag('tdccSell'),
        instBuy: countFlag('instBuy'),
        instSell: countFlag('instSell'),
        divergence: countFlag('divergence'),
      };

      const report = {
        date: today,
        generatedAt: `${formatTaipeiDateTime(now.ms)} +08:00`,
        trigger: trigger || '手動立即更新分析',
        counts,
        items,
      };
      await this._writeJson(this.latestAnalysisFile, report);
      await this._writeJson(CM.fs.joinPath(this.analysisDir, `${today}.json`), report);
      return this.getState();
    }
  }

  CM.watchlist = { WatchlistService };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/platform/api-router.js ===
/**
 * 行動版 /api/* 路由器：
 * 攔截前端 fetch('/api/...') 請求，改由本機純 JS 服務層處理（對應 scripts/serve_local.py）。
 * 不啟動任何本機 HTTP 監聽埠，完全在 App 行程記憶體內安全呼叫。
 */
(function (CM) {
  'use strict';

  const DEFAULT_ETF_NAMES = {
    '0050': '元大台灣50',
    '0056': '元大高股息',
    '00878': '國泰永續高股息',
    '00919': '群益台灣精選高息',
    '00929': '復華台灣科技優息',
    '00713': '元大台灣高息低波',
    '006208': '富邦台50',
    '00881': '國泰台灣5G+'
  };

  function buildStockNames(base) {
    const names = { ...(base && base.stocks ? base.stocks : {}) };
    for (const [code, label] of Object.entries(DEFAULT_ETF_NAMES)) {
      if (!Object.hasOwn(names, code)) names[code] = [label, 'TWSE'];
    }
    return names;
  }

  function makeJsonResponse(status, payload) {
    const text = JSON.stringify(payload);
    if (typeof Response === 'function') {
      return new Response(text, {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
      });
    }
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: k => (String(k).toLowerCase() === 'content-type' ? 'application/json; charset=utf-8' : null) },
      async json() {
        return JSON.parse(text);
      },
      async text() {
        return text;
      }
    };
  }

  function parseBody(init) {
    if (!init || init.body === undefined || init.body === null) return {};
    if (typeof init.body === 'string') {
      if (init.body.length > 256 * 1024) return {};
      try {
        return JSON.parse(init.body);
      } catch {
        return {};
      }
    }
    if (typeof init.body === 'object') return init.body;
    return {};
  }

  class MobileApiRouter {
    constructor(base = CM.base) {
      this.base = base || { stocks: {}, series: {}, universe: [], sessions: [], hashes: {}, usUniverse: [] };
      const stockNames = buildStockNames(this.base);
      const baseSeries = this.base.series ? { ...this.base.series } : {};

      this.feedService = new CM.feed.LocalFeedService('tdcc-local-v1', this.base);
      this.dailyService = new CM.feed.DailyService('daily-cache-v1', this.feedService);
      this.twMarketService = new CM.twMarket.TwMarketService('tw-detail-v1');
      this.briefingService = new CM.news.BriefingService('', stockNames);
      this.usMarketService = new CM.usMarket.UsMarketService('us-cache-v1');
      this.watchlistService = new CM.watchlist.WatchlistService('', this.twMarketService, {
        stockNames,
        baseSeries,
        feedService: this.feedService
      });
      this._initPromise = null;
    }

    init() {
      if (!this._initPromise) {
        this._initPromise = Promise.all([
          this.feedService.init(),
          this.dailyService.init(),
          this.twMarketService.init(),
          this.briefingService.init(),
          this.usMarketService.init(),
          this.watchlistService.init()
        ]);
      }
      return this._initPromise;
    }

    async handle(rawUrl, init = {}) {
      await this.init();
      const method = String((init && init.method) || 'GET').toUpperCase();
      const url = new URL(String(rawUrl), 'https://localhost');
      const pathname = url.pathname;
      const params = url.searchParams;

      if (method === 'GET') {
        if (pathname === '/api/health') {
          return makeJsonResponse(200, {
            app: 'ChipScreener',
            status: 'ok',
            platform: 'android',
            latest: await this.feedService.latest()
          });
        }
        if (pathname === '/api/official/read') {
          return makeJsonResponse(200, await this.feedService.initial());
        }
        if (pathname === '/api/daily') {
          const code = (params.get('code') || '').trim().toUpperCase();
          try {
            return makeJsonResponse(200, await this.dailyService.getDaily(code));
          } catch (exc) {
            return makeJsonResponse(400, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/tw/detail') {
          const code = (params.get('code') || '').trim().toUpperCase();
          const force = params.get('refresh') === '1';
          try {
            return makeJsonResponse(200, await this.twMarketService.getDetail(code, force));
          } catch (exc) {
            return makeJsonResponse(400, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/briefing') {
          const day = params.get('date') || null;
          return makeJsonResponse(200, {
            config: await this.briefingService.getConfig(),
            dates: await this.briefingService.listDates(),
            report: await this.briefingService.readReport(day),
            shouldAutoRun: await this.briefingService.shouldAutoRun()
          });
        }
        if (pathname === '/api/watchlist') {
          return makeJsonResponse(200, await this.watchlistService.getState());
        }
        if (pathname === '/api/us/overview') {
          const force = params.get('refresh') === '1';
          try {
            return makeJsonResponse(200, await this.usMarketService.getOverview(force));
          } catch (exc) {
            return makeJsonResponse(500, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/us/screener') {
          const force = params.get('refresh') === '1';
          try {
            return makeJsonResponse(200, await this.usMarketService.getScreener(force));
          } catch (exc) {
            return makeJsonResponse(500, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/us/detail') {
          const code = (params.get('code') || '').trim().toUpperCase();
          const force = params.get('refresh') === '1';
          try {
            return makeJsonResponse(200, await this.usMarketService.getDetail(code, force));
          } catch (exc) {
            return makeJsonResponse(400, { error: String(exc.message || exc) });
          }
        }
        return makeJsonResponse(404, { error: 'Not found' });
      }

      if (method === 'POST') {
        if (pathname === '/api/official/update') {
          try {
            return makeJsonResponse(200, await this.feedService.update());
          } catch (exc) {
            return makeJsonResponse(500, {
              status: '失敗',
              message: String(exc.message || exc),
              weeks: {},
              months: {},
              checked: CM.time.taipeiIso()
            });
          }
        }
        if (pathname === '/api/briefing/generate') {
          const body = parseBody(init);
          try {
            const report = await this.briefingService.generate({
              featuredCode: String(body.featuredCode || '2404'),
              trigger: String(body.trigger || '手動馬上製作')
            });
            return makeJsonResponse(200, {
              config: await this.briefingService.getConfig(),
              dates: await this.briefingService.listDates(),
              report,
              shouldAutoRun: false
            });
          } catch (exc) {
            return makeJsonResponse(500, { error: String(exc.message || exc) });
          }
        }
        if (pathname === '/api/briefing/config') {
          const body = parseBody(init);
          try {
            const cfg = await this.briefingService.updateConfig(body);
            return makeJsonResponse(200, {
              config: cfg,
              dates: await this.briefingService.listDates(),
              shouldAutoRun: await this.briefingService.shouldAutoRun()
            });
          } catch (exc) {
            return makeJsonResponse(400, { error: String(exc.message || exc) });
          }
        }
        if (pathname.startsWith('/api/watchlist/')) {
          const body = parseBody(init);
          const action = pathname.slice('/api/watchlist/'.length);
          try {
            let res;
            if (action === 'folder/create') {
              res = await this.watchlistService.createFolder(String(body.name || ''));
            } else if (action === 'folder/rename') {
              res = await this.watchlistService.renameFolder(String(body.folderId || ''), String(body.name || ''));
            } else if (action === 'folder/delete') {
              res = await this.watchlistService.deleteFolder(String(body.folderId || ''));
            } else if (action === 'stock/add') {
              res = await this.watchlistService.addStock(String(body.folderId || ''), String(body.code || ''));
            } else if (action === 'stock/update') {
              res = await this.watchlistService.updateItem(String(body.folderId || ''), String(body.code || ''), body);
            } else if (action === 'stock/remove') {
              res = await this.watchlistService.removeItem(String(body.folderId || ''), String(body.code || ''));
            } else if (action === 'auto/toggle') {
              res = await this.watchlistService.toggleAutoStock(
                String(body.code || ''),
                body.enabled === undefined ? true : Boolean(body.enabled)
              );
            } else if (action === 'auto/config') {
              res = await this.watchlistService.setAutoEnabled(body.enabled === undefined ? true : Boolean(body.enabled));
            } else if (action === 'prices/refresh') {
              res = await this.watchlistService.refreshQuotes(Array.isArray(body.codes) ? body.codes : null);
            } else if (action === 'analyze') {
              res = await this.watchlistService.runAutoAnalysis(String(body.trigger || '手動立即更新分析'));
            } else {
              return makeJsonResponse(404, { error: 'Not found' });
            }
            return makeJsonResponse(200, res);
          } catch (exc) {
            const status = exc instanceof CM.ValueError ? 400 : 500;
            return makeJsonResponse(status, { error: String(exc.message || exc) });
          }
        }
        return makeJsonResponse(404, { error: 'Not found' });
      }

      return makeJsonResponse(405, { error: 'Method not allowed' });
    }

    installFetch(target = globalThis) {
      const origFetch = typeof target.fetch === 'function' ? target.fetch.bind(target) : null;
      const self = this;
      target.fetch = function chipMobileFetch(input, init) {
        const rawUrl = typeof input === 'string' ? input : (input && input.url) || '';
        const isApi =
          rawUrl.startsWith('/api/') ||
          rawUrl.startsWith('https://localhost/api/') ||
          rawUrl.startsWith('http://localhost/api/');
        if (isApi) {
          return self.handle(rawUrl, init);
        }
        if (origFetch) return origFetch(input, init);
        return Promise.reject(new Error('不支援的非 API 請求'));
      };
    }
  }

  CM.router = { MobileApiRouter };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/platform/mobile-ui.js ===
/**
 * 行動版互動與體驗補強（在不侵入 src/renderer/** 的前提下掛載）：
 * 1. 全功能側邊抽屜（讓 9 個台股頁面 + 5 個美股頁面皆可一鍵切換）
 * 2. K 線畫布觸控十字準線（touchstart / touchmove / touchend）
 * 3. 外部連結攔截 → 交由 Android 系統瀏覽器開啟（僅限 HTTPS）
 * 4. Android 硬體返回鍵：依瀏覽歷史回退，根頁連按兩次離開
 * 5. 點擊每日晨報通知自動切換到晨報頁
 * 6. 行動版文案置換（例如 %LOCALAPPDATA% 改為 Android Keystore 說明）
 */
(function (CM) {
  'use strict';

  let drawerOpen = false;
  let lastBackPress = 0;
  const pageHistory = [];

  function setDrawer(open) {
    drawerOpen = Boolean(open);
    const drawer = document.getElementById('mobileDrawer');
    const backdrop = document.getElementById('mobileDrawerBackdrop');
    if (drawer) drawer.classList.toggle('open', drawerOpen);
    if (backdrop) backdrop.classList.toggle('open', drawerOpen);
    if (drawerOpen) syncDrawerContent();
  }

  function syncDrawerContent() {
    const navWrap = document.getElementById('mobileDrawerNav');
    if (!navWrap || typeof globalThis.currentNavList !== 'function' || !globalThis.state) return;
    const list = globalThis.currentNavList();
    const curPage = globalThis.state.page;
    const curMarket = globalThis.state.market;

    navWrap.innerHTML = list
      .map(
        ([id, ic, name]) =>
          `<button type="button" data-drawer-nav="${id}" class="${curPage === id ? 'active' : ''}">` +
          `<span class="ico">${ic}</span><span>${name}</span></button>`
      )
      .join('');

    const twBtn = document.getElementById('drawerMarketTW');
    const usBtn = document.getElementById('drawerMarketUS');
    if (twBtn) twBtn.classList.toggle('active', curMarket !== 'US');
    if (usBtn) usBtn.classList.toggle('active', curMarket === 'US');
  }

  function injectDrawerDom() {
    const crumb = document.querySelector('.topbar .crumb');
    if (crumb && !document.getElementById('mobileMenuBtn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'mobileMenuBtn';
      btn.className = 'mobile-menu-btn';
      btn.setAttribute('aria-label', '開啟功能選單');
      btn.textContent = '☰';
      crumb.insertBefore(btn, crumb.firstChild);
    }

    if (!document.getElementById('mobileDrawerBackdrop')) {
      const backdrop = document.createElement('div');
      backdrop.id = 'mobileDrawerBackdrop';
      backdrop.className = 'mobile-drawer-backdrop';
      document.body.appendChild(backdrop);
    }

    if (!document.getElementById('mobileDrawer')) {
      const drawer = document.createElement('aside');
      drawer.id = 'mobileDrawer';
      drawer.className = 'mobile-drawer';
      drawer.setAttribute('aria-label', '全部功能選單');
      drawer.innerHTML =
        '<div class="mobile-drawer-head">' +
        '  <div class="mobile-drawer-title"><span class="brand-mark" style="width:28px;height:28px;font-size:16px">⌁</span><span>籌碼雷達</span></div>' +
        '  <button type="button" class="mobile-drawer-close" id="mobileDrawerClose" aria-label="關閉選單">✕</button>' +
        '</div>' +
        '<div class="mobile-drawer-market">' +
        '  <button type="button" id="drawerMarketTW" data-drawer-market="TW">台股 TW</button>' +
        '  <button type="button" id="drawerMarketUS" data-drawer-market="US">美股 US</button>' +
        '</div>' +
        '<nav class="mobile-drawer-nav" id="mobileDrawerNav"></nav>' +
        '<div class="mobile-drawer-foot">' +
        '  <div>Android 安全離線優先版</div>' +
        '  <div>API 金鑰由 Android Keystore 加密保護</div>' +
        '  <div>研究分析工具 · 非投資建議</div>' +
        '</div>';
      document.body.appendChild(drawer);
    }
  }

  function bindDrawerEvents() {
    document.body.addEventListener('click', e => {
      if (e.target.closest?.('#mobileMenuBtn')) {
        setDrawer(!drawerOpen);
        return;
      }
      if (e.target.id === 'mobileDrawerBackdrop' || e.target.closest?.('#mobileDrawerClose')) {
        setDrawer(false);
        return;
      }
      const mktBtn = e.target.closest?.('[data-drawer-market]');
      if (mktBtn && typeof globalThis.setMarket === 'function') {
        globalThis.setMarket(mktBtn.dataset.drawerMarket);
        syncDrawerContent();
        return;
      }
      const navBtn = e.target.closest?.('[data-drawer-nav]');
      if (navBtn && typeof globalThis.go === 'function') {
        setDrawer(false);
        globalThis.go(navBtn.dataset.drawerNav);
      }
    });
  }

  /* ---------- K 線觸控十字準線 ---------- */
  function bindKlineTouch() {
    let dragging = false;

    function updateFromTouch(canvas, touch) {
      if (!globalThis.state || typeof globalThis.drawDetailKline !== 'function') return;
      const isUs = globalThis.state.page === 'us_stock';
      const code = isUs ? globalThis.state.usStock : globalThis.state.stock;
      const detail = isUs ? globalThis.state.usDetailByCode?.[code] : globalThis.state.stockDetailByCode?.[code];
      if (!detail?.bars?.length) return;
      const agg = typeof globalThis.aggregateBars === 'function'
        ? globalThis.aggregateBars(detail.bars, globalThis.state.detailTf || 'D')
        : detail.bars;
      const count = globalThis.state.detailTf === 'D'
        ? Math.min(globalThis.state.detailRange || 60, agg.length)
        : agg.length;
      if (!count) return;

      const rect = canvas.getBoundingClientRect();
      const padL = 58;
      const padR = 16;
      const plotW = Math.max(1, rect.width - padL - padR);
      const relX = touch.clientX - rect.left - padL;
      const idx = Math.max(0, Math.min(count - 1, Math.floor((relX / plotW) * count)));
      if (globalThis.state.detailHoverIdx !== idx) {
        globalThis.state.detailHoverIdx = idx;
        globalThis.drawDetailKline();
      }
    }

    document.body.addEventListener('touchstart', e => {
      const canvas = e.target.closest?.('#klineCanvas');
      if (!canvas || !e.touches.length) return;
      dragging = true;
      updateFromTouch(canvas, e.touches[0]);
    }, { passive: true });

    document.body.addEventListener('touchmove', e => {
      if (!dragging) return;
      const canvas = document.getElementById('klineCanvas');
      if (!canvas || !e.touches.length) return;
      updateFromTouch(canvas, e.touches[0]);
    }, { passive: true });

    document.body.addEventListener('touchend', () => {
      dragging = false;
    }, { passive: true });
  }

  /* ---------- 外部 HTTPS 連結交由系統瀏覽器 ---------- */
  function bindExternalLinks() {
    document.body.addEventListener('click', e => {
      const a = e.target.closest?.('a[href]');
      if (!a) return;
      const href = a.getAttribute('href') || '';
      if (/^https:\/\//i.test(href)) {
        e.preventDefault();
        CM.openExternal(href).catch(() => {
          if (typeof globalThis.toast === 'function') globalThis.toast('無法開啟外部連結');
        });
      }
    });
  }

  /* ---------- 文案調整：桌面路徑改為 Android 安全說明 ---------- */
  function patchMobileCopy() {
    const pageEl = document.getElementById('page');
    if (!pageEl) return;
    const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes('%LOCALAPPDATA%')) {
        node.nodeValue = node.nodeValue.replace(
          /Windows 本機資料夾（%LOCALAPPDATA%\\ChipScreener）/g,
          'Android Keystore 硬體加密金庫（僅存本機）'
        );
      }
    }
  }

  function wrapNavigationAndRender() {
    if (typeof globalThis.go === 'function') {
      const origGo = globalThis.go;
      globalThis.go = function wrappedGo(page) {
        if (globalThis.state && globalThis.state.page && globalThis.state.page !== page) {
          pageHistory.push(globalThis.state.page);
          if (pageHistory.length > 30) pageHistory.shift();
        }
        return origGo.apply(this, arguments);
      };
    }

    if (typeof globalThis.render === 'function') {
      const origRender = globalThis.render;
      globalThis.render = function wrappedRender() {
        const res = origRender.apply(this, arguments);
        patchMobileCopy();
        if (drawerOpen) syncDrawerContent();
        return res;
      };
    }
  }

  /* ---------- Android 返回鍵與通知點擊 ---------- */
  function bindAndroidSystemEvents() {
    const plugins = (globalThis.Capacitor && globalThis.Capacitor.Plugins) || {};
    const AppPlugin = plugins.App;
    const LocalNotifications = plugins.LocalNotifications;

    if (AppPlugin && typeof AppPlugin.addListener === 'function') {
      AppPlugin.addListener('backButton', () => {
        if (drawerOpen) {
          setDrawer(false);
          return;
        }
        if (globalThis.state && globalThis.state.quickFavCode) {
          globalThis.state.quickFavCode = null;
          if (typeof globalThis.render === 'function') globalThis.render();
          return;
        }
        if (pageHistory.length > 0 && typeof globalThis.go === 'function') {
          const prev = pageHistory.pop();
          // 避免把回退動作再次推回 history
          const cur = globalThis.state ? globalThis.state.page : '';
          globalThis.go(prev);
          if (pageHistory.length && pageHistory[pageHistory.length - 1] === cur) {
            pageHistory.pop();
          }
          return;
        }
        const now = Date.now();
        if (now - lastBackPress < 2000) {
          AppPlugin.exitApp();
        } else {
          lastBackPress = now;
          if (typeof globalThis.toast === 'function') globalThis.toast('再按一次返回鍵離開籌碼雷達');
        }
      });
    }

    if (LocalNotifications && typeof LocalNotifications.addListener === 'function') {
      LocalNotifications.addListener('localNotificationActionPerformed', evt => {
        const target = evt?.notification?.extra?.page || 'briefing';
        if (typeof globalThis.go === 'function') globalThis.go(target);
      });
    }
  }

  CM.installMobileUi = function installMobileUi() {
    injectDrawerDom();
    bindDrawerEvents();
    bindKlineTouch();
    bindExternalLinks();
    wrapNavigationAndRender();
    bindAndroidSystemEvents();
    patchMobileCopy();
  };
})(globalThis.ChipMobile = globalThis.ChipMobile || {});

// === mobile/platform/boot.js ===
/**
 * 行動版啟動程序：
 * 1. 掛載 Capacitor 原生橋接層
 * 2. 自 INITIAL_DATA 建立不可變 CM.base 基準（隔離前端 applyWeek 寫入）
 * 3. 預載三副本原子儲存 (MobileLocalStore) 並掛載 window.desktopStore
 * 4. 初始化 /api/* 路由器並攔截 window.fetch
 * 5. 動態載入原前端 renderer.js，完成後掛載行動版抽屜與觸控優化
 */
(function (CM) {
  'use strict';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('無法載入腳本：' + src));
      document.body.appendChild(s);
    });
  }

  function snapshotBase() {
    const raw = typeof INITIAL_DATA !== 'undefined' ? INITIAL_DATA : {};
    const fb = raw.feedBase || {};
    return {
      stocks: raw.stocks ? { ...raw.stocks } : {},
      series: raw.series ? { ...raw.series } : {},
      universe: Array.isArray(fb.universe) ? [...fb.universe] : Array.isArray(raw.universe) ? [...raw.universe] : [],
      sessions: Array.isArray(fb.sessions) ? [...fb.sessions] : Array.isArray(raw.sessions) ? [...raw.sessions] : [],
      hashes: fb.hashes ? { ...fb.hashes } : {},
      usUniverse: Array.isArray(raw.usUniverse) ? raw.usUniverse : []
    };
  }

  async function boot() {
    try {
      CM.installCapacitorBridge();
      CM.base = snapshotBase();

      const store = new CM.localStore.MobileLocalStore('store-v1', '0.6.0-android');
      await store.init();
      store.installGlobal(globalThis);
      CM.storeInstance = store;

      const router = new CM.router.MobileApiRouter(CM.base);
      await router.init();
      router.installFetch(globalThis);
      CM.routerInstance = router;

      await loadScript('renderer.js');

      if (typeof CM.installMobileUi === 'function') {
        CM.installMobileUi();
      }
    } catch (err) {
      console.error('[ChipMobile boot failed]', err);
      const page = document.getElementById('page');
      if (page) {
        page.innerHTML =
          '<div class="card"><div class="empty"><b>行動版初始化失敗</b>' +
          String((err && err.message) || err) +
          '</div></div>';
      }
    }
  }

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  }
})(globalThis.ChipMobile = globalThis.ChipMobile || {});
