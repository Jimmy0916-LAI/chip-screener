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
