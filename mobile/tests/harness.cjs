'use strict';

/**
 * Node 測試替身：載入行動版腳本並以記憶體實作 CM.native（HTTP／檔案／金庫／通知）。
 *
 * 用法：
 *   const { createEnv } = require('./harness.cjs');
 *   const env = createEnv({ files: ['services/us-market.js'], routes: [...] , now: '2026-11-26T10:00:00+08:00' });
 *   const CM = env.CM;
 *
 * routes: [{ match: RegExp|string(前綴)|fn(url), status=200, body: string|object|Uint8Array|fn(req)->(同上), headers }]
 *   - object body 會被 JSON.stringify
 *   - 未命中路由時拋出 '連線失敗 mock 未定義 <url>'
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = path.resolve(__dirname, '..', 'src');
const PLATFORM = ['platform/core.js', 'platform/http.js', 'platform/storage.js'];

function toBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  return new TextEncoder().encode(JSON.stringify(body));
}

function createEnv(opts = {}) {
  const { files = [], routes = [], base = null, now = null } = opts;
  const memFs = new Map(); // path -> { data, mtime }
  const vault = new Map();
  const notifications = new Map();
  const requests = [];
  let clock = now ? Date.parse(now) : Date.now();

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    atob,
    btoa,
    crypto: globalThis.crypto,
    structuredClone,
    queueMicrotask,
    Intl
  };
  // 可控時鐘：Date.now() 與 new Date() 依 env.setNow 調整
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(clock);
      else super(...args);
    }
    static now() {
      return clock;
    }
  }
  sandbox.Date = FakeDate;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const native = {
    async httpRequest(req) {
      requests.push(req);
      for (const r of routes) {
        const hit =
          typeof r.match === 'function'
            ? r.match(req.url, req)
            : r.match instanceof RegExp
              ? r.match.test(req.url)
              : req.url.startsWith(r.match);
        if (!hit) continue;
        if (r.error) throw new Error(r.error);
        const body = typeof r.body === 'function' ? await r.body(req) : r.body;
        return { status: r.status ?? 200, headers: r.headers || {}, bytes: toBytes(body ?? '') };
      }
      throw new Error('連線失敗 mock 未定義 ' + req.url);
    },
    async fsRead({ path: p }) {
      const f = memFs.get(p);
      return f ? { exists: true, data: f.data, mtime: f.mtime } : { exists: false, data: '', mtime: 0 };
    },
    async fsWrite({ path: p, data }) {
      memFs.set(p, { data, mtime: clock });
    },
    async fsList({ path: dir }) {
      const prefix = dir.replace(/\/$/, '') + '/';
      const files = [];
      for (const [p, f] of memFs) {
        if (p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) {
          files.push({ name: p.slice(prefix.length), mtime: f.mtime, size: f.data.length });
        }
      }
      return { files };
    },
    async fsRemove({ path: p }) {
      memFs.delete(p);
    },
    async vaultGet({ key }) {
      return { value: vault.get(key) || '' };
    },
    async vaultSet({ key, value }) {
      vault.set(key, value);
    },
    async vaultRemove({ key }) {
      vault.delete(key);
    },
    async notifyPermission() {
      return { display: 'granted' };
    },
    async notifySchedule(n) {
      notifications.set(n.id, n);
    },
    async notifyCancel({ ids }) {
      for (const id of ids) notifications.delete(id);
    },
    async notifyPending() {
      return { ids: [...notifications.keys()] };
    },
    async openExternal() {}
  };

  function load(rel) {
    const file = path.join(SRC, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
  }

  for (const f of PLATFORM) load(f);
  const CM = sandbox.ChipMobile;
  CM.native = native;
  CM.base = base || { stocks: {}, series: {}, universe: [], sessions: [], hashes: {}, usUniverse: [] };
  for (const f of files) load(f);

  return {
    CM,
    sandbox,
    memFs,
    vault,
    notifications,
    requests,
    routes,
    load,
    setNow(iso) {
      clock = Date.parse(iso);
    },
    advance(ms) {
      clock += ms;
    }
  };
}

module.exports = { createEnv, toBytes };
