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
