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
