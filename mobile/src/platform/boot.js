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
