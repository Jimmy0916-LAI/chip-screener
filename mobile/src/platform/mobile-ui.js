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
