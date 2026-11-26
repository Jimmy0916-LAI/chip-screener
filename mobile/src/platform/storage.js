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
