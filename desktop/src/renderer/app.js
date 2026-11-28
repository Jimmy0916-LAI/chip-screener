/**
 * SPA 路由、主渲染器、事件委派總線與啟動初始化
 */

Object.assign(state, {
  briefingTab: state.briefingTab || 'daily',
  channelsConfig: state.channelsConfig || {
    autoDailyEnabled: false,
    cooldownMinutes: 15,
    maxVideoMinutes: 60,
    hasGeminiKey: false,
    geminiKeyHint: ''
  },
  channelsList: state.channelsList || [],
  channelsSelectedId: state.channelsSelectedId || '',
  channelsLoading: false,
  channelsAdding: false,
  channelsChecking: false,
  channelsCheckingId: '',
  channelsError: '',
  channelsLoaded: false,
  channelsConfirmRemoveId: '',
  channelsConfirmDeleteStrategy: '',
  channelsAddInput: '',
  swKeyBusy: false,
  swConfirmClearKey: false,
  paperActiveSlotId: state.paperActiveSlotId || '',
  paperFxUsdTwd: 32.5,
  paperHasGeminiKey: false,
  paperSlots: [],
  paperSlot: null,
  paperActiveTab: state.paperActiveTab || 'positions',
  paperLoading: false,
  paperLoaded: false,
  paperBusy: false,
  paperAiBusy: false,
  paperError: '',
  paperModal: null,
  paperSlotDraft: null,
  paperOrderDraft: null,
  paperOrderQuoteCode: '',
  paperOrderQuoteLoading: false,
  paperOrderQuoteError: '',
  paperOrderQuoteReqId: 0,
  paperConfirmReset: false,
  paperConfirmDelete: false
});

const PAGES = {
  home,
  briefing: briefingPage,
  watchlist: watchlistPage,
  paper: paperPage,
  us_home: usHomePage,
  us_screen: usScreenPage,
  us_stock: usStockPage,
  screen,
  stock,
  backtest,
  peak,
  settings: settingsPage,
  software: softwarePage,
  data: dataPage
};

function currentNavList() {
  return state.market === 'US' ? US_NAV : NAV;
}

function populateNav() {
  const navEl = $('#nav');
  const mobileEl = $('#mobilebar');
  const list = currentNavList();
  if (navEl) {
    navEl.innerHTML = list
      .map(
        ([id, ic, name]) =>
          `<button data-nav="${id}" class="${state.page === id ? 'active' : ''}"><span class="ico">${ic}</span>${name}</button>`
      )
      .join('');
  }
  if (mobileEl) {
    const mobileList =
      state.market === 'US'
        ? US_NAV
        : NAV.filter(x => ['home', 'watchlist', 'paper', 'screen', 'software'].includes(x[0]));
    mobileEl.innerHTML = mobileList
      .map(
        ([id, ic, name]) =>
          `<button data-nav="${id}" class="${state.page === id ? 'active' : ''}"><span>${ic}</span>${name.replace('全市場', '').replace('美股', '').replace('板塊', '').replace('研究', '').replace('股票', '')}</button>`
      )
      .join('');
  }
}

function setMarket(nextMarket) {
  const target = nextMarket === 'US' ? 'US' : 'TW';
  if (state.market === target) return;
  state.market = target;
  saveMarketMode(target);
  let nextPage = state.page;
  if (target === 'US') {
    if (nextPage === 'home') nextPage = 'us_home';
    else if (nextPage === 'screen') nextPage = 'us_screen';
    else if (nextPage === 'stock') nextPage = 'us_stock';
    else if (!['briefing', 'watchlist', 'paper', 'software', 'us_home', 'us_screen', 'us_stock'].includes(nextPage)) nextPage = 'us_home';
  } else {
    if (nextPage === 'us_home') nextPage = 'home';
    else if (nextPage === 'us_screen') nextPage = 'screen';
    else if (nextPage === 'us_stock') nextPage = 'stock';
  }
  go(nextPage);
}

function go(page) {
  if (page !== 'us_screen') stopUsScreenerPoll();
  if (page !== 'us_home') stopUsOverviewPoll();
  if (page !== 'stock' && page !== 'us_stock') {
    state.stockReturnPage = '';
  }
  if (['us_home', 'us_screen', 'us_stock'].includes(page)) {
    state.market = 'US';
    saveMarketMode('US');
  } else if (['home', 'screen', 'stock', 'backtest', 'peak', 'settings', 'data'].includes(page)) {
    state.market = 'TW';
    saveMarketMode('TW');
  }
  state.page = page;
  state.pageNum = 0;
  render();
  if (page === 'screen' && usesPriceSignals(applied)) loadSignalPrices();
  if (page === 'stock' && state.stockMode === 'detail') {
    loadStockDetail(state.stock);
  }
  if (page === 'briefing') {
    if (state.briefingTab === 'channels') {
      loadChannels(true);
    } else {
      loadBriefing(state.briefingSelectedDate || '');
      if (!state.channelsLoaded) loadChannels(false);
    }
  }
  if (page === 'watchlist') {
    loadWatchlist(false);
  }
  if (page === 'paper') {
    loadPaperState(state.paperActiveSlotId || '', false);
  }
  if (page === 'software') {
    loadSoftwareState(true);
  }
  if (page === 'us_home') {
    loadUsOverview(false);
  }
  if (page === 'us_screen') {
    loadUsScreener(false);
  }
  if (page === 'us_stock') {
    loadUsDetail(state.usStock || 'NVDA', false);
  }
  if (typeof scheduleLiveQuoteTimer === 'function') {
    scheduleLiveQuoteTimer(true);
  }
  scrollTo({ top: 0, behavior: 'instant' });
}

function selectStock(code, opts = {}) {
  state.market = 'TW';
  saveMarketMode('TW');
  state.stock = code;
  state.page = 'stock';
  state.stockReturnPage = opts.returnPage || '';
  if (opts.mode) {
    state.stockMode = opts.mode;
  } else if (state.stockReturnPage === 'watchlist') {
    state.stockMode = 'detail';
  }
  state.bands = [applied.band];
  state.selectedDay = state.win;
  state.detailHoverIdx = null;
  state.stockDetailError = '';
  render();
  if (state.overlayK && state.stockMode !== 'detail') loadOverlayHistory(code);
  if (state.stockMode === 'detail') {
    loadStockDetail(code);
  }
  scrollTo({ top: 0, behavior: 'instant' });
}

function selectUsStock(code, opts = {}) {
  const sym = String(code || '').trim().toUpperCase().replace('.', '-');
  if (!/^[A-Z][A-Z0-9-]{0,7}$/.test(sym)) {
    toast('請輸入有效美股代號（如 NVDA、AAPL、TSM、SPY、BRK-B）');
    return;
  }
  state.market = 'US';
  saveMarketMode('US');
  state.usStock = sym;
  state.page = 'us_stock';
  state.stockReturnPage = opts.returnPage || '';
  state.detailHoverIdx = null;
  state.usDetailError = '';
  render();
  loadUsDetail(sym, false);
  scrollTo({ top: 0, behavior: 'instant' });
}

let usOverviewPollTimer = null;

function stopUsOverviewPoll() {
  if (usOverviewPollTimer) {
    clearTimeout(usOverviewPollTimer);
    usOverviewPollTimer = null;
  }
}

async function loadUsOverview(force = false, silentPoll = false) {
  const alreadyFull = Boolean(state.usOverview?.indices?.length && !state.usOverview?.scanning && (state.usOverview?.universeCount || 0) >= 400);
  if (!force && !silentPoll && alreadyFull) return;
  if (!hasHttpFeed) {
    state.usOverviewError = '純離線模式無法連線 Yahoo Finance，請透過本機服務開啟。';
    if (state.page === 'us_home') render();
    return;
  }
  stopUsOverviewPoll();
  if (!silentPoll) {
    state.usOverviewLoading = true;
    state.usOverviewError = '';
    if (state.page === 'us_home') render();
  }
  try {
    const resp = await fetch(`/api/us/overview${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '無法載入美股總覽');
    state.usOverview = data;
    state.usOverviewError = '';
    if (data.scanning && state.page === 'us_home') {
      usOverviewPollTimer = setTimeout(() => loadUsOverview(false, true), 1600);
    }
    if (state.page === 'us_home') render();
  } catch (e) {
    state.usOverviewError = e.message;
    if (state.page === 'us_home') render();
  } finally {
    if (!silentPoll) {
      state.usOverviewLoading = false;
      if (state.page === 'us_home') render();
    }
  }
}

let usScreenerPollTimer = null;

function stopUsScreenerPoll() {
  if (usScreenerPollTimer) {
    clearTimeout(usScreenerPollTimer);
    usScreenerPollTimer = null;
  }
}

async function loadUsScreener(force = false, silentPoll = false) {
  if (!force && !silentPoll && state.usScreener?.rows?.length && !state.usScreener?.scanning) return;
  if (!hasHttpFeed) {
    state.usScreenerError = '純離線模式無法連線 Yahoo Finance，請透過本機服務開啟。';
    if (state.page === 'us_screen') render();
    return;
  }
  stopUsScreenerPoll();
  if (!silentPoll) {
    state.usScreenerLoading = true;
    state.usScreenerError = '';
    if (state.page === 'us_screen') render();
  }
  try {
    const prevDone = state.usScreener?.progress?.done || 0;
    const prevScanning = Boolean(state.usScreener?.scanning);
    const resp = await fetch(`/api/us/screener${force ? '?refresh=1' : ''}`, { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '無法載入 S&P 500 篩選');
    state.usScreener = data;
    state.usScreenerError = '';
    const changed = !silentPoll || data.progress?.done !== prevDone || Boolean(data.scanning) !== prevScanning;
    if (state.page === 'us_screen' && changed) {
      const wasSearch = document.activeElement?.id === 'usSearchInput';
      const pos = wasSearch ? document.activeElement.selectionStart : null;
      render();
      if (wasSearch) {
        const inp = $('#usSearchInput');
        if (inp) {
          inp.focus();
          if (pos !== null) inp.setSelectionRange(pos, pos);
        }
      }
    }
    if (data.scanning && state.page === 'us_screen') {
      usScreenerPollTimer = setTimeout(() => loadUsScreener(false, true), 1600);
    }
  } catch (e) {
    state.usScreenerError = e.message;
    if (state.page === 'us_screen') render();
  } finally {
    if (!silentPoll) {
      state.usScreenerLoading = false;
      if (state.page === 'us_screen') render();
    }
  }
}

async function loadUsDetail(code, force = false) {
  const sym = String(code || 'NVDA').trim().toUpperCase().replace('.', '-');
  if (!force && state.usDetailByCode?.[sym]?.bars?.length) return;
  if (!hasHttpFeed) {
    state.usDetailError = '純離線模式無法載入美股行情，請透過本機服務開啟。';
    if (state.page === 'us_stock') render();
    return;
  }
  state.usDetailLoading = true;
  state.usDetailError = '';
  if (state.page === 'us_stock') render();
  try {
    const resp = await fetch(
      `/api/us/detail?code=${encodeURIComponent(sym)}${force ? '&refresh=1' : ''}`,
      { cache: 'no-store' }
    );
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '無法取得美股詳情');
    state.usDetailByCode[sym] = data;
  } catch (e) {
    state.usDetailError = e.message;
  } finally {
    state.usDetailLoading = false;
    if (state.page === 'us_stock' && state.usStock === sym) render();
  }
}

function render() {
  if (typeof closeStockSuggest === 'function') closeStockSuggest();
  populateNav();
  const brandBtn = $('#brandMarketToggle');
  const brandBadge = $('#brandMarketBadge');
  const brandHint = $('#brandMarketHint');
  const mobileMktBtn = $('#mobileMarketToggle');
  if (brandBtn) {
    brandBtn.dataset.market = state.market;
    brandBtn.title = state.market === 'US' ? '目前：美股模式｜點擊切換回 台股 TW' : '目前：台股模式｜點擊切換至 美股 US';
  }
  if (brandBadge) brandBadge.textContent = state.market === 'US' ? '美股 US' : '台股 TW';
  if (brandHint) brandHint.textContent = state.market === 'US' ? '點擊切換 台股 TW ⇄' : '點擊切換 美股 US ⇄';
  if (mobileMktBtn) {
    mobileMktBtn.dataset.market = state.market;
    mobileMktBtn.textContent = state.market === 'US' ? '美股 ⇄' : '台股 ⇄';
  }

  const crumb = $('#crumb');
  if (crumb) {
    const allNav = [...NAV, ...US_NAV];
    const baseName =
      state.page === 'stock' && state.stockMode === 'detail'
        ? '個股詳情'
        : allNav.find(x => x[0] === state.page)?.[2];
    crumb.textContent = baseName || '研究';
  }

  const topDate = $('#topDateTag');
  const topStatus = $('#topStatusTag');
  if (state.market === 'US') {
    if (topDate) topDate.textContent = 'US Market · USD · 紅漲綠跌';
    if (topStatus) topStatus.textContent = 'Yahoo Finance 即時連線';
  } else {
    if (topDate) topDate.textContent = '集保資料截至 ' + (latestVerifiedDay() || '—');
    if (topStatus) topStatus.textContent = '本機離線可用';
  }

  const notice = ['home', 'screen', 'stock', 'backtest'].includes(state.page) ? weekSelectionNotice() : '';
  const feed = ['home', 'data'].includes(state.page) ? feedPanel() : '';
  const strip = notice || feed ? `<div class="status-strip">${notice}${feed}</div>` : '';
  const quickFavHtml = typeof renderQuickFavModal === 'function' ? renderQuickFavModal() : '';

  $('#page').innerHTML = strip + PAGES[state.page]() + quickFavHtml;
  if ((state.page === 'stock' && state.stockMode === 'detail') || state.page === 'us_stock') {
    drawDetailKline();
  }
  renderUpdateBanner();
  renderRestartOverlay();
  updateLiveQuotePill();
}

/* ---------- 軟體設定、雙軌自動更新 ＆ 盤中輕量即時股價 ---------- */

function renderUpdateBanner() {
  const slot = $('#updateBannerSlot');
  if (!slot) return;
  const chk = state.updateCheckResult;
  if (chk && chk.hasUpdate && !state.updateBannerDismissed) {
    const chBadge = badge(chk.channel === 'beta' ? '測試版 beta' : '正式版 stable', chk.channel === 'beta' ? 'warn' : 'good');
    const note = chk.isDowngrade ? '切換至較舊版本需要確認' : (chk.changelog || [])[0] || '已可安裝完整 Windows 更新包';
    const actionBtn = chk.requiresShellUpgrade
      ? `<a class="btn warn sm" href="${esc(chk.releaseUrl || 'https://github.com/' + (chk.repo || '') + '/releases')}" target="_blank" rel="noopener noreferrer">↗ 前往下載正式版</a>`
      : `<button type="button" class="btn main sm" id="bannerApplyUpdateBtn">立即更新並重啟</button>`;

    slot.innerHTML =
      '<div class="update-banner" role="region" aria-label="軟體更新通知">' +
      '<div class="update-banner-info">' +
      chBadge +
      `<b>發現新版本 ${esc(chk.remoteAppVersion)}</b>` +
      `<span class="muted">（目前 ${esc(chk.currentAppVersion)}）· ${esc(note)}</span>` +
      '</div>' +
      '<div class="update-banner-actions">' +
      actionBtn +
      '<button type="button" class="btn ghost sm" id="dismissUpdateBannerBtn">稍後再說</button>' +
      '</div>' +
      '</div>';
    return;
  }

  const notice = state.softwareState?.runtime?.recentReleaseNotice;
  const curVer = state.softwareState?.version?.appVersion || D.versionInfo?.appVersion || '';
  if (notice && !notice.acknowledged && notice.version && (!curVer || notice.version === curVer)) {
    const items = (notice.changelog && notice.changelog.length
      ? notice.changelog
      : ['已完成更新並通過啟動驗證']
    ).map(line => `<li>${esc(line)}</li>`).join('');
    const prevText =
      notice.previousVersion && notice.previousVersion !== notice.version
        ? `<span class="muted">（原為 ${esc(notice.previousVersion)}）</span>`
        : '';

    slot.innerHTML =
      '<div class="update-banner done" role="region" aria-label="更新完成通知">' +
      '<div class="update-banner-info">' +
      badge('更新完成', 'good') +
      `<b>已更新至版本 ${esc(notice.version)}</b>` +
      prevText +
      `<ul class="brief-list update-notice-list">${items}</ul>` +
      '</div>' +
      '<div class="update-banner-actions">' +
      '<button type="button" class="btn main sm" id="dismissReleaseNoticeBtn">知道了</button>' +
      '</div>' +
      '</div>';
    return;
  }

  slot.innerHTML = '';
}

function renderRestartOverlay() {
  const slot = $('#restartOverlaySlot');
  if (!slot) return;
  const ov = state.restartingOverlay;
  if (!ov) {
    slot.innerHTML = '';
    return;
  }
  const pct = Math.max(0, Math.min(100, Number.isFinite(Number(ov.percent)) ? Math.round(Number(ov.percent)) : 72));
  const stageText = ov.stageLabel ? String(ov.stageLabel) : '更新進度';
  slot.innerHTML =
    '<div class="restart-backdrop" role="dialog" aria-modal="true" aria-label="軟體更新重啟進度">' +
    '<div class="restart-modal card">' +
    `<h3 style="margin:0 0 8px">${esc(ov.title || '正在套用更新並重啟服務')}</h3>` +
    `<p class="muted" style="margin:0 0 14px">${esc(ov.detail || '請稍候，服務就緒後將自動重新整理頁面...')}</p>` +
    `<div class="progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="progress-fill" style="width:${pct}%"></div></div>` +
    `<div class="progress-meta"><span>${esc(stageText)}</span><b>${pct}%</b></div>` +
    '</div>' +
    '</div>';
}

async function waitForServerAndReload(transaction) {
  const deadline = Date.now() + 55000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const response = await fetch('/api/health', {
        cache: 'no-store', signal: AbortSignal.timeout(2000)
      });
      const health = response.ok ? await response.json() : null;
      if (health?.app !== 'ChipScreener' || health.updateResult?.id !== transaction) continue;
      if (!health.updateResult.success && !health.updateResult.rolledBack) {
        return health.updateResult.message || '未能啟動更新';
      }
      window.location.reload();
      return null;
    } catch {
      // The loopback connection is briefly unavailable during the handoff.
    }
  }
  return '重啟驗證逾時。請從桌面的股票雷達捷徑重開並查看更新結果。';
}

function syncSharedGeminiMeta(meta) {
  if (!meta || meta.hasGeminiKey === undefined) return;
  const hasKey = Boolean(meta.hasGeminiKey);
  const hint = meta.geminiKeyHint || '';
  const mode = meta.secretStorageMode || '';
  if (state.softwareState?.config) {
    state.softwareState.config.hasGeminiKey = hasKey;
    state.softwareState.config.geminiKeyHint = hint;
    if (mode) state.softwareState.config.secretStorageMode = mode;
  }
  if (state.briefingConfig) {
    state.briefingConfig.hasGeminiKey = hasKey;
    state.briefingConfig.geminiKeyHint = hint;
    if (mode) state.briefingConfig.secretStorageMode = mode;
  }
  if (state.channelsConfig) {
    state.channelsConfig.hasGeminiKey = hasKey;
    state.channelsConfig.geminiKeyHint = hint;
    if (mode) state.channelsConfig.secretStorageMode = mode;
  }
  state.paperHasGeminiKey = hasKey;
}

async function loadSoftwareState(probeMarket = false) {
  if (!hasHttpFeed) return;
  try {
    const resp = await fetch('/api/software/state', { cache: 'no-store' });
    if (!resp.ok) return;
    const data = await resp.json();
    state.softwareState = data;
    syncSharedGeminiMeta(data.config);
    if (data.marketStatus) state.liveQuoteStatus = data.marketStatus;
    if (data.lastCheck && !state.updateCheckResult) state.updateCheckResult = data.lastCheck;
    if (data.runtime?.rolledBackFrom && !state._rollbackToasted) {
      state._rollbackToasted = true;
      toast(`已從異常版本 ${data.runtime.rolledBackFrom} 自動回滾至安全版本`);
    }
    if (probeMarket) {
      const mResp = await fetch('/api/quotes/market-status?probe=1', { cache: 'no-store' });
      if (mResp.ok) {
        state.liveQuoteStatus = await mResp.json();
      }
    }
    updateLiveQuotePill();
    scheduleLiveQuoteTimer(false);
    renderUpdateBanner();
    if (state.page === 'software') render();
  } catch {
    // 靜默失敗，不干擾主流程
  }
}

async function dismissReleaseNotice() {
  if (!hasHttpFeed) return;
  try {
    const resp = await fetch('/api/software/notice/dismiss', { method: 'POST' });
    if (resp.ok) {
      const data = await resp.json();
      state.softwareState = data;
      renderUpdateBanner();
      if (state.page === 'software') render();
      return;
    }
  } catch {
    // 失敗時仍先隱藏本次畫面
  }
  if (state.softwareState?.runtime?.recentReleaseNotice) {
    state.softwareState.runtime.recentReleaseNotice.acknowledged = true;
  }
  renderUpdateBanner();
}

async function saveSoftwareConfig(body, successMsg = '已儲存軟體設定') {
  if (!hasHttpFeed) {
    toast('請透過本機服務開啟以變更軟體設定');
    return null;
  }
  try {
    const resp = await fetch('/api/software/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '儲存設定失敗');
    state.softwareState = data;
    syncSharedGeminiMeta(data.config);
    if (data.marketStatus) state.liveQuoteStatus = data.marketStatus;
    updateLiveQuotePill();
    scheduleLiveQuoteTimer(true);
    toast(successMsg);
    if (state.page === 'software') render();
    return data;
  } catch (e) {
    toast(e.message);
    return null;
  }
}

async function checkForUpdates(silent = false) {
  if (!hasHttpFeed || state.updateBusy) return;
  state.updateBusy = true;
  state.updateError = '';
  if (!silent && state.page === 'software') render();
  try {
    const resp = await fetch('/api/software/update/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ silent: Boolean(silent) })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '檢查更新失敗');
    state.updateCheckResult = data.check;
    if (data.state) state.softwareState = data.state;
    if (data.check?.hasUpdate) {
      state.updateBannerDismissed = false;
    }
    renderUpdateBanner();
    if (!silent) {
      toast(updateCheckDescription(data.check));
    }
  } catch (e) {
    state.updateCheckResult = null;
    state.updateError = e.message;
    renderUpdateBanner();
    if (!silent) toast(e.message);
  } finally {
    state.updateBusy = false;
    if (state.page === 'software') render();
  }
}

const UPDATE_STAGE_LABELS = {
  checking: '檢查版本',
  downloading: '下載更新包',
  verifying: '校驗 SHA-256',
  extracting: '安全解壓',
  restarting: '重啟服務',
  done: '完成',
  error: '發生錯誤'
};

async function installFixedEntry() {
  if (!confirm('安裝固定入口並建立目前 Windows 帳號的桌面與開始功能表捷徑？')) return;
  try {
    const response = await fetch('/api/software/update/install', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({confirm: true})
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || '無法建立固定入口');
    state.softwareState = data;
    toast('已建立股票雷達捷徑');
    if (state.page === 'software') render();
  } catch (error) {
    toast(error.message);
  }
}

async function applyUpdateAndRestart(rollback = false) {
  if (!hasHttpFeed || state.restartingOverlay) return;
  const app = state.softwareState?.appUpdate;
  if (!app?.installed) {
    go('software');
    toast('請先在軟體設定安裝固定入口');
    return;
  }
  const candidate = state.updateCheckResult;
  const version = rollback ? app.previousVersion : candidate?.remoteAppVersion;
  if (!version || (!rollback && !candidate.hasUpdate)) return;
  const downgrade = rollback || candidate.isDowngrade;
  const question = downgrade
    ? `確認將完整程式切換至相容的較早版本 ${version}？服務將中斷重啟，使用者資料會保留。`
    : `確認下載並安裝完整 Windows 版本 ${version}？服務將中斷重啟。`;
  if (!confirm(question)) return;

  state.updateError = '';
  state.restartingOverlay = { title: '準備更新', percent: 5, stageLabel: '核對指定版本' };
  renderRestartOverlay();
  try {
    const response = await fetch(rollback ? '/api/software/rollback' : '/api/software/update/apply', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({confirm: true, confirmDowngrade: downgrade === true,
                            version, commit: candidate?.sourceCommit}),
      signal: AbortSignal.timeout(12000)
    });
    const data = await response.json();
    if (!response.ok || !data.transaction) throw Error(data.error || '套用版本失敗');

    const deadline = Date.now() + 300000;
    let unreachable = 0;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 300));
      let status;
      try {
        const poll = await fetch('/api/software/update/progress', {
          cache: 'no-store', signal: AbortSignal.timeout(2500)
        });
        if (poll.ok) status = await poll.json();
        unreachable = 0;
      } catch {
        unreachable += 1;
      }
      if (status?.transaction === data.transaction) {
        if (status.stage === 'error') throw Error(status.error || status.detail || '更新失敗');
        state.restartingOverlay = {
          title: status.title || '更新中', detail: status.detail,
          percent: status.percent, stageLabel: UPDATE_STAGE_LABELS[status.stage] || '更新中'
        };
        renderRestartOverlay();
      }
      if (status?.stage === 'restarting' || unreachable >= 2) {
        const error = await waitForServerAndReload(data.transaction);
        if (error) throw Error(error);
        return;
      }
    }
    throw Error('下載或套用更新逾時。請回軟體設定檢查目前進度。');
  } catch (error) {
    state.restartingOverlay = null;
    state.updateError = error.message;
    renderRestartOverlay();
    toast(error.message);
    if (state.page === 'software') render();
  }
}

let liveQuoteTimer = null;

function collectVisibleQuoteCodes() {
  const out = [];
  const push = sym => {
    const clean = String(sym || '').trim().toUpperCase();
    if (clean && !out.includes(clean)) out.push(clean);
  };
  if (state.page === 'stock' && state.stockMode === 'detail' && state.stockDetailByCode?.[state.stock]?.bars?.length) {
    push(state.stock);
  } else if (state.page === 'us_stock' && state.usDetailByCode?.[state.usStock || 'NVDA']?.bars?.length) {
    push(state.usStock || 'NVDA');
  } else if (state.page === 'watchlist') {
    const cfg = state.watchlistConfig || {};
    if (state.watchlistActiveTab === 'auto') {
      (cfg.autoStocks || []).forEach(push);
    } else {
      const folder = (cfg.folders || []).find(f => f.id === state.watchlistActiveTab) || (cfg.folders || [])[0];
      (folder?.items || []).forEach(it => push(it.code));
    }
  } else if (state.page === 'paper' && state.paperSlot) {
    (state.paperSlot.positionsList || []).forEach(p => push(p.code));
    Object.keys(state.paperSlot.positions || {}).forEach(push);
    (state.paperSlot.orders || [])
      .filter(o => String(o.status || '').toUpperCase() === 'PENDING')
      .forEach(o => push(o.code));
  } else if (state.page === 'briefing' && state.briefingTab === 'channels') {
    const activeCh = typeof getSelectedChannel === 'function' ? getSelectedChannel() : null;
    for (const strat of activeCh?.strategies || []) {
      for (const tk of strat.tickers || []) {
        push(tk.code);
      }
    }
  } else if (state.page === 'briefing' && state.briefingReport) {
    (state.briefingReport.tracked || []).forEach(x => push(x.code));
    (state.briefingReport.newsStocks || []).forEach(x => push(x.code));
  } else if (state.page === 'us_home' && state.usOverview) {
    (state.usOverview.indices || []).forEach(x => push(x.symbol || x.code));
    (state.usOverview.leaders || []).forEach(x => push(x.code));
    (state.usOverview.laggards || []).forEach(x => push(x.code));
  } else if (state.page === 'us_screen' && typeof getFilteredUsScreenerRows === 'function') {
    const rows = getFilteredUsScreenerRows();
    const limit = 25;
    const pages = Math.ceil(rows.length / limit);
    const pIdx = pages ? Math.min(state.usPageNum || 0, pages - 1) : 0;
    rows.slice(pIdx * limit, (pIdx + 1) * limit).forEach(r => push(r.code));
  }
  return out.slice(0, 50);
}

function _isQuoteCodeTw(code) {
  return code === '^TWII' || /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(String(code || ''));
}

function updateLiveQuotePill() {
  const pill = $('#liveQuotePill');
  const txt = $('#liveQuotePillText');
  if (!pill || !txt) return;
  const cfg = state.softwareState?.config || {};
  const enabled = cfg.liveQuoteEnabled !== false;
  const interval = Number(cfg.liveQuoteIntervalSec || 30);

  if (!hasHttpFeed) {
    pill.className = 'live-quote-pill off';
    txt.textContent = '離線模式';
    pill.title = '純離線模式無即時連線；請透過本機服務開啟';
    return;
  }
  if (!enabled) {
    pill.className = 'live-quote-pill off';
    txt.textContent = '即時報價已關閉';
    pill.title = '可於「軟體設定」重新開啟，或點擊立即更新一次最新收盤價';
    return;
  }
  if (state.liveQuoteBusy) {
    pill.className = 'live-quote-pill busy';
    txt.textContent = '更新報價中...';
    return;
  }
  if (document.hidden) {
    pill.className = 'live-quote-pill paused';
    txt.textContent = '背景分頁・已暫停';
    return;
  }

  const mktStatus = state.liveQuoteStatus || {};
  const twOpen = Boolean(mktStatus.TW?.isOpen);
  const usOpen = Boolean(mktStatus.US?.isOpen);
  const codes = collectVisibleQuoteCodes();
  const hasTwCodes = codes.some(c => _isQuoteCodeTw(c));
  const hasUsCodes = codes.some(c => !_isQuoteCodeTw(c));

  const relevantOpen = codes.length
    ? (hasTwCodes && twOpen) || (hasUsCodes && usOpen)
    : twOpen || usOpen;

  const twReason = mktStatus.TW?.reason || '非開盤時段';
  const usReason = mktStatus.US?.reason || '美股非開盤時段';
  pill.title = `台股：${twReason}｜美股：${usReason}｜點擊可手動抓取最新一次收盤／即時價`;

  if (relevantOpen) {
    pill.className = 'live-quote-pill active';
    txt.textContent = `盤中即時更新（${interval}s）`;
  } else {
    pill.className = 'live-quote-pill paused';
    const isHolidayOrHalted =
      (hasTwCodes && ['HOLIDAY', 'HALTED_OR_HOLIDAY'].includes(mktStatus.TW?.stateCode)) ||
      (hasUsCodes && ['HOLIDAY', 'HALTED_OR_HOLIDAY'].includes(mktStatus.US?.stateCode));
    txt.textContent = isHolidayOrHalted ? '今日休市／停盤・已暫停' : '非開盤／今日休市・已暫停';
  }
}

function _applyLiveClass(el, baseCls, dirCls) {
  if (!el) return;
  if (baseCls !== null && baseCls !== undefined) {
    el.className = baseCls;
  }
  el.classList.remove('tw-up', 'tw-down', 'tw-up-bg', 'tw-down-bg', 'wl-pnl-flat');
  if (dirCls) el.classList.add(dirCls);
}

function applyLiveQuotesToDom(quotesMap, fetchedAtStr = '') {
  if (!quotesMap || !Object.keys(quotesMap).length) return;
  Object.assign(state.liveQuotesByCode, quotesMap);

  if (state.watchlistQuotes) {
    Object.assign(state.watchlistQuotes, quotesMap);
    if (fetchedAtStr) state.watchlistQuotesUpdatedAt = fetchedAtStr;
  }

  // 1. 局部更新收藏夾列表（價格與估值，不重建表格列或關閉 drawer）
  for (const [code, q] of Object.entries(quotesMap)) {
    if (typeof q?.price !== 'number') continue;
    const isUs = q.market === 'US' || !_isQuoteCodeTw(code);
    const dp = isUs ? 2 : q.price < 150 ? 2 : 1;
    const dirCls = q.change > 0 ? 'tw-up' : q.change < 0 ? 'tw-down' : 'wl-pnl-flat';
    const arrow = q.change > 0 ? '▲' : q.change < 0 ? '▼' : '';

    document.querySelectorAll(`[data-live-wl-price="${code}"]`).forEach(cell => {
      cell.innerHTML = `<div class="wl-price-cell"><strong class="${dirCls}">${isUs ? '$' : ''}${fmt(q.price, dp)}</strong> <span class="wl-chg ${dirCls}">${arrow} ${pp(q.change, 2)} (${pp(q.changePct, 2)}%)</span></div>`;
    });

    if (typeof renderCustomValuationCell === 'function') {
      document.querySelectorAll(`[data-live-wl-val="${code}"]`).forEach(cell => {
        const fid = cell.dataset.wlFolder;
        const folder = (state.watchlistConfig?.folders || []).find(f => f.id === fid);
        const item = (folder?.items || []).find(it => it.code === code);
        if (item) {
          cell.innerHTML = renderCustomValuationCell(item, q);
        }
      });
    }

    // 2. 局部更新一般報價表格（晨報、美股篩選當前頁、美股領漲跌、模擬操盤持倉）
    document.querySelectorAll(`[data-live-tbl-price="${code}"]`).forEach(td => {
      const useDollar = td.dataset.liveCurrency === 'USD' || (isUs && state.page === 'us_screen');
      td.innerHTML = useDollar ? `<b>$${fmt(q.price, 2)}</b>` : fmt(q.price, dp);
    });
    if (state.page === 'paper' && state.paperSlot) {
      const pos = (state.paperSlot.positionsList || []).find(p => p.code === code);
      if (pos) {
        const cur = state.paperSlot.currency || 'TWD';
        const fx = state.paperSlot.market === 'MIXED' && pos.market === 'US' ? (state.paperFxUsdTwd || 32.5) : 1;
        const mv = q.price * Number(pos.shares || 0) * fx;
        const cb = Number(pos.avgCost || 0) * Number(pos.shares || 0) * fx;
        const pnl = mv - cb;
        const pct = cb > 0 ? (pnl / cb) * 100 : 0;
        document.querySelectorAll(`[data-live-pt-mv="${code}"]`).forEach(td => {
          td.textContent = typeof ptFmtMoney === 'function' ? ptFmtMoney(mv, cur) : fmt(mv, cur === 'USD' ? 2 : 0);
        });
        document.querySelectorAll(`[data-live-pt-pnl="${code}"]`).forEach(td => {
          _applyLiveClass(td, null, pnl > 0 ? 'tw-up' : pnl < 0 ? 'tw-down' : 'wl-pnl-flat');
          const mStr = typeof ptFmtMoney === 'function' ? ptFmtMoney(pnl, cur, true) : fmt(pnl, 0);
          td.innerHTML = `<b>${esc(mStr)}</b> <span class="pt-sub-pct">(${pct >= 0 ? '+' : ''}${fmt(pct, 2)}%)</span>`;
        });
      }
    }
    document.querySelectorAll(`[data-live-tbl-chg="${code}"]`).forEach(td => {
      const pctOnly = td.dataset.livePctOnly === '1';
      _applyLiveClass(td, null, q.change > 0 ? 'tw-up' : q.change < 0 ? 'tw-down' : 'wl-pnl-flat');
      td.textContent = pctOnly ? `${arrow} ${pp(q.changePct, 2)}%` : `${pp(q.change, 2)} (${pp(q.changePct, 2)}%)`;
    });

    // 3. 局部更新美股總覽指數卡片
    document.querySelectorAll(`[data-live-idx-price="${code}"]`).forEach(el => {
      _applyLiveClass(el, 'idx-price', dirCls);
      el.textContent = fmt(q.price, 2);
    });
    document.querySelectorAll(`[data-live-idx-chg="${code}"]`).forEach(el => {
      _applyLiveClass(el, 'idx-chg', dirCls);
      el.textContent = `${arrow} ${pp(q.change, 2)} (${pp(q.changePct, 2)}%)`;
    });

    // 4. 局部更新個股詳情看板（絕不觸發 K 線重畫）
    const detailCards = document.querySelectorAll(`[data-live-detail][data-live-code="${code}"]`);
    if (detailCards.length) {
      const pfx = isUs ? '$' : '';
      const bgCls = q.change > 0 ? 'tw-up-bg' : q.change < 0 ? 'tw-down-bg' : '';
      detailCards.forEach(el => {
        const field = el.dataset.liveDetail;
        if (field === 'price') {
          _applyLiveClass(el, 'quote-price', dirCls);
          el.textContent = `${pfx}${fmt(q.price, dp)}`;
        } else if (field === 'chgBadge') {
          _applyLiveClass(el, 'quote-chg-badge', bgCls);
          el.textContent = `${arrow} ${pfx}${fmt(Math.abs(q.change), dp)} (${pp(q.changePct, 2)}%)`;
        } else if (field === 'open' && q.open != null) {
          el.textContent = `${pfx}${fmt(q.open, dp)}`;
        } else if (field === 'high' && q.high != null) {
          el.textContent = `${pfx}${fmt(q.high, dp)}`;
        } else if (field === 'low' && q.low != null) {
          el.textContent = `${pfx}${fmt(q.low, dp)}`;
        } else if (field === 'prevClose' && q.prevClose != null) {
          el.textContent = `${pfx}${fmt(q.prevClose, dp)}`;
        } else if (field === 'vol' && q.volumeLots != null) {
          el.textContent = isUs && typeof fmtUsShares === 'function' ? fmtUsShares(q.volumeLots) : fmt(q.volumeLots);
        } else if (field === 'amp' && q.ampPct != null) {
          el.textContent = `${fmt(q.ampPct, 2)}%`;
        } else if (field === 'statusText') {
          const stateTxt = q.marketState === 'REGULAR' ? '盤中即時' : '最新收盤';
          el.textContent = `資料日 ${q.tradeDate || '—'} ${stateTxt}${q.tradeTime ? ' · ' + q.tradeTime.slice(11, 16) : ''}`;
        } else if ((field === 'holdingMarketVal' || field === 'holdingPnl') && typeof getBestHoldingCostInfo === 'function') {
          const holdCost = getBestHoldingCostInfo(code);
          if (holdCost && holdCost.shares > 0) {
            const shares = holdCost.shares;
            const mv = q.price * shares;
            if (field === 'holdingMarketVal') {
              el.textContent = isUs ? `$${fmt(mv, 2)}` : `${fmt(mv, 0)} 元`;
            } else if (holdCost.costPrice > 0) {
              const ct = holdCost.costPrice * shares;
              const pnl = mv - ct;
              const pct = (pnl / ct) * 100;
              _applyLiveClass(el, '', pnl > 0 ? 'tw-up' : pnl < 0 ? 'tw-down' : 'wl-pnl-flat');
              const signStr = pnl > 0 ? '+' : pnl < 0 ? '-' : '';
              el.textContent = isUs
                ? `${signStr}$${fmt(Math.abs(pnl), 2)} (${pct > 0 ? '+' : ''}${fmt(pct, 2)}%)`
                : `${pnl > 0 ? '+' : ''}${fmt(pnl, 0)} 元 (${pct > 0 ? '+' : ''}${fmt(pct, 2)}%)`;
            }
          }
        }
      });
    }
  }
}

async function pollLiveQuotes(manual = false) {
  if (!hasHttpFeed) return;
  if (!manual && document.hidden) return;
  const cfg = state.softwareState?.config || {};
  if (!manual && cfg.liveQuoteEnabled === false) {
    updateLiveQuotePill();
    return;
  }

  const codes = collectVisibleQuoteCodes();
  if (!codes.length) {
    if (manual) {
      const mResp = await fetch('/api/quotes/market-status?probe=1', { cache: 'no-store' });
      if (mResp.ok) state.liveQuoteStatus = await mResp.json();
      updateLiveQuotePill();
      toast('目前頁面沒有需要更新報價的個股標的，已同步最新開休市狀態');
    }
    return;
  }

  if (state.liveQuoteBusy) return;
  state.liveQuoteBusy = true;
  updateLiveQuotePill();
  try {
    const resp = await fetch('/api/quotes/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes, manual })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '取得即時報價失敗');
    if (data.marketStatus) state.liveQuoteStatus = data.marketStatus;
    applyLiveQuotesToDom(data.quotes || {}, data.fetchedAtFull || '');
    if (state.page === 'paper' && state.paperSlot && !state.paperBusy) {
      const pendingOrders = (state.paperSlot.orders || []).filter(o => String(o.status || '').toUpperCase() === 'PENDING');
      const shouldEval = pendingOrders.some(o => {
        const qp = data.quotes?.[o.code]?.price;
        if (typeof qp !== 'number' || !isFinite(qp) || !(o.triggerPrice > 0)) return false;
        if (o.orderType === 'LIMIT' && o.side === 'BUY') return qp <= o.triggerPrice;
        if (o.orderType === 'LIMIT' && o.side === 'SELL') return qp >= o.triggerPrice;
        if (o.orderType === 'STOP_LOSS') return qp <= o.triggerPrice;
        if (o.orderType === 'TAKE_PROFIT') return qp >= o.triggerPrice;
        return false;
      });
      if (shouldEval) {
        evaluatePaperOrders(state.paperSlot.id, true);
      }
    }
    if (manual) {
      toast(`已手動更新 ${data.fetchedCount || 0} 檔最新報價（${data.fetchedAt || ''}）`);
    }
  } catch (e) {
    if (manual) toast(e.message);
  } finally {
    state.liveQuoteBusy = false;
    updateLiveQuotePill();
  }
}

function scheduleLiveQuoteTimer(runSoon = false) {
  if (liveQuoteTimer) {
    clearInterval(liveQuoteTimer);
    liveQuoteTimer = null;
  }
  if (!hasHttpFeed || document.hidden) {
    updateLiveQuotePill();
    return;
  }
  const cfg = state.softwareState?.config || {};
  if (cfg.liveQuoteEnabled === false) {
    updateLiveQuotePill();
    return;
  }
  const sec = [15, 30, 60].includes(Number(cfg.liveQuoteIntervalSec)) ? Number(cfg.liveQuoteIntervalSec) : 30;
  liveQuoteTimer = setInterval(() => pollLiveQuotes(false), sec * 1000);
  if (runSoon && collectVisibleQuoteCodes().length) {
    setTimeout(() => pollLiveQuotes(false), 350);
  }
}

function applyWatchlistPayload(data) {
  if (!data) return;
  if (data.config) {
    state.watchlistConfig = data.config;
    const folders = data.config.folders || [];
    if (
      state.watchlistActiveTab !== 'auto' &&
      !folders.some(f => f.id === state.watchlistActiveTab)
    ) {
      state.watchlistActiveTab = folders[0]?.id || 'auto';
    }
  }
  if (data.quotes) state.watchlistQuotes = data.quotes;
  if (data.quotesUpdatedAt !== undefined) state.watchlistQuotesUpdatedAt = data.quotesUpdatedAt;
  if (data.analysis !== undefined) state.watchlistAnalysis = data.analysis;
}

async function loadWatchlist(allowAutoCatchup = false) {
  if (!hasHttpFeed) {
    state.watchlistError = '純離線 HTML 模式無法連線存取本機收藏夾與報價，請透過 ChipScreener.exe 或本機服務開啟。';
    if (state.page === 'watchlist') render();
    return;
  }
  try {
    const resp = await fetch('/api/watchlist', { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '讀取收藏夾失敗');
    applyWatchlistPayload(data);
    state.watchlistError = '';
    if (state.page === 'watchlist' || state.page === 'screen' || state.page === 'stock') render();
    if (allowAutoCatchup && data.shouldAutoRun && !state.watchlistAnalysisBusy) {
      await runWatchlistAutoAnalysis('每日 10:00 自動補抓分析', true);
    }
  } catch (e) {
    state.watchlistError = e.message;
    if (state.page === 'watchlist') render();
  }
}

async function watchlistAction(endpoint, payload = {}, successMsg = '') {
  if (!hasHttpFeed) {
    toast('請透過 ChipScreener.exe 或本機服務開啟以操作收藏夾');
    return null;
  }
  try {
    const resp = await fetch('/api/watchlist/' + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '操作失敗');
    applyWatchlistPayload(data);
    if (data.createdFolderId) state.watchlistActiveTab = data.createdFolderId;
    if (successMsg) toast(successMsg);
    render();
    return data;
  } catch (e) {
    toast(e.message);
    return null;
  }
}

async function refreshWatchlistPrices() {
  if (state.watchlistPriceBusy) return;
  state.watchlistPriceBusy = true;
  render();
  try {
    await watchlistAction('prices/refresh', {}, '已更新收藏夾最新股價與市值損益');
  } finally {
    state.watchlistPriceBusy = false;
    render();
  }
}

async function runWatchlistAutoAnalysis(trigger = '手動立即更新分析', isAuto = false) {
  if (state.watchlistAnalysisBusy) return;
  if (!hasHttpFeed) {
    toast('請透過 ChipScreener.exe 或本機服務開啟以執行自動分析');
    return;
  }
  state.watchlistAnalysisBusy = true;
  if (state.page === 'watchlist') render();
  try {
    const resp = await fetch('/api/watchlist/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '自動分析失敗');
    applyWatchlistPayload(data);
    toast(isAuto ? '今日 10:00 收藏夾自動分析已就緒' : '已完成自動分析 6 大維度更新');
  } catch (e) {
    if (!isAuto) toast('自動分析失敗：' + e.message);
  } finally {
    state.watchlistAnalysisBusy = false;
    if (state.page === 'watchlist') render();
  }
}

async function loadBriefing(day = '', allowAutoCatchup = false) {
  if (!hasHttpFeed) {
    state.briefingError = '純離線 HTML 模式無法連線抓取新聞，請透過 ChipScreener.exe 或本機服務開啟。';
    if (state.page === 'briefing') render();
    return;
  }
  try {
    const qs = day ? '?date=' + encodeURIComponent(day) : '';
    const resp = await fetch('/api/briefing' + qs, { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '讀取晨報失敗');
    state.briefingConfig = data.config || state.briefingConfig;
    state.briefingDates = data.dates || [];
    if (data.report) {
      state.briefingReport = data.report;
      state.briefingSelectedDate = data.report.date;
    }
    state.briefingError = '';
    if (state.page === 'briefing') render();

    if (allowAutoCatchup && data.shouldAutoRun && !state.briefingBusy) {
      await generateBriefing('每日 10:00 自動補抓', true);
    }
  } catch (e) {
    state.briefingError = e.message;
    if (state.page === 'briefing') render();
  }
}

async function generateBriefing(trigger = '手動馬上製作', isAuto = false) {
  if (state.briefingBusy) return;
  if (!hasHttpFeed) {
    toast('請透過 ChipScreener.exe 或本機服務開啟以製作即時晨報');
    return;
  }
  state.briefingBusy = true;
  state.briefingError = '';
  if (state.page === 'briefing') render();
  try {
    const resp = await fetch('/api/briefing/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trigger })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '製作晨報失敗');
    state.briefingConfig = data.config || state.briefingConfig;
    state.briefingDates = data.dates || [];
    state.briefingReport = data.report;
    state.briefingSelectedDate = data.report?.date || '';
    toast(isAuto ? '今日 10:00 晨報已就緒' : `已製作 ${data.report?.date || ''} 最新晨報`);
  } catch (e) {
    state.briefingError = e.message;
    if (!isAuto) toast('製作晨報失敗：' + e.message);
  } finally {
    state.briefingBusy = false;
    if (state.page === 'briefing') render();
  }
}

async function updateBriefingConfig(payload, successMsg = '') {
  if (!hasHttpFeed) {
    toast('請透過 ChipScreener.exe 或本機服務開啟以修改晨報設定');
    return;
  }
  try {
    const resp = await fetch('/api/briefing/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '更新設定失敗');
    state.briefingConfig = data.config;
    if (state.channelsConfig && data.config) {
      state.channelsConfig.hasGeminiKey = Boolean(data.config.hasGeminiKey);
      state.channelsConfig.geminiKeyHint = data.config.geminiKeyHint || '';
    }
    if (successMsg) toast(successMsg);
    if (state.page === 'briefing') render();
  } catch (e) {
    toast('更新晨報設定失敗：' + e.message);
  }
}

/* ---------- 訂閱財經頻道、影片摘要與策略卡 ---------- */

function applyChannelsState(payload) {
  const doc = payload?.state || payload;
  if (!doc || typeof doc !== 'object') return;
  if (doc.config) {
    state.channelsConfig = { ...state.channelsConfig, ...doc.config };
  }
  if (Array.isArray(doc.channels)) {
    state.channelsList = doc.channels;
    if (!doc.channels.some(c => c.id === state.channelsSelectedId)) {
      state.channelsSelectedId = doc.channels[0]?.id || '';
    }
  }
  state.channelsLoaded = true;
}

async function loadChannels(triggerCooldownCheck = false) {
  if (!hasHttpFeed) {
    if (state.page === 'briefing' && state.briefingTab === 'channels') render();
    return;
  }
  state.channelsLoading = true;
  try {
    const resp = await fetch('/api/channels', { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '讀取訂閱頻道失敗');
    applyChannelsState(data);
    state.channelsError = '';
    if (state.page === 'briefing') render();
    if (state.page === 'briefing' && state.briefingTab === 'channels' && typeof scheduleLiveQuoteTimer === 'function') {
      scheduleLiveQuoteTimer(true);
    }
    if (triggerCooldownCheck && !state.channelsChecking) {
      await checkChannels(null, false, true);
    }
  } catch (e) {
    state.channelsError = e.message;
    if (state.page === 'briefing' && state.briefingTab === 'channels') render();
  } finally {
    state.channelsLoading = false;
  }
}

async function addChannelSubscription(rawUrl) {
  const url = String(rawUrl || '').trim();
  if (!url) {
    toast('請貼上 YouTube 頻道網址、@handle 或影片連結');
    $('#chAddUrlInput')?.focus();
    return;
  }
  if (!hasHttpFeed) {
    toast('請透過 ChipScreener.exe 或本機服務開啟以訂閱頻道');
    return;
  }
  if (state.channelsAdding) return;
  state.channelsAddInput = url;
  state.channelsAdding = true;
  state.channelsError = '';
  render();
  try {
    const resp = await fetch('/api/channels/add', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '新增訂閱失敗');
    applyChannelsState(data.state || data);
    state.channelsAddInput = '';
    if (data.channel?.id) {
      state.channelsSelectedId = data.channel.id;
    }
    state.channelsConfirmRemoveId = '';
    state.channelsConfirmDeleteStrategy = '';
    const ch = data.channel;
    const statusHint =
      ch?.status === 'waiting_subtitles'
        ? '（最新影片等待字幕中）'
        : ch?.status === 'skipped_non_finance'
          ? '（最新影片非財經主題，已略過）'
          : ch?.status === 'skipped_too_long'
            ? '（最新影片超過長度上限，已略過）'
            : (ch?.strategies || []).length
              ? '（已生成最新影片策略卡）'
              : '';
    toast(`已訂閱「${ch?.name || '頻道'}」${statusHint}`);
    if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
  } catch (e) {
    state.channelsError = e.message;
    toast('新增訂閱失敗：' + e.message);
  } finally {
    state.channelsAdding = false;
    render();
  }
}

async function removeChannelSubscription(channelId) {
  if (!channelId || !hasHttpFeed) return;
  try {
    const resp = await fetch('/api/channels/remove', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '移除頻道失敗');
    state.channelsConfirmRemoveId = '';
    state.channelsConfirmDeleteStrategy = '';
    applyChannelsState(data.state || data);
    state.channelsError = '';
    toast('已移除頻道訂閱');
    render();
    if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
  } catch (e) {
    toast('移除頻道失敗：' + e.message);
  }
}

async function checkChannels(channelId = null, force = true, silent = false) {
  if (!hasHttpFeed || state.channelsChecking) return;
  state.channelsChecking = true;
  state.channelsCheckingId = channelId || '';
  if (!silent) {
    state.channelsError = '';
    if (state.page === 'briefing' && state.briefingTab === 'channels') render();
  }
  try {
    const body = { force: Boolean(force) };
    if (channelId) body.channelId = channelId;
    const resp = await fetch('/api/channels/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '檢查新片失敗');
    applyChannelsState(data.state || data);
    state.channelsError = '';
    const updated = Number(data.updatedCount || 0);
    if (!silent) {
      toast(updated > 0 ? `已更新 ${updated} 筆頻道最新影片策略` : '已完成檢查，目前尚無新影片或等待字幕更新');
    } else if (updated > 0) {
      toast(`已自動更新 ${updated} 筆訂閱頻道最新策略`);
    }
    if (state.page === 'briefing' && state.briefingTab === 'channels' && typeof scheduleLiveQuoteTimer === 'function') {
      scheduleLiveQuoteTimer(true);
    }
  } catch (e) {
    if (!silent) {
      state.channelsError = e.message;
      toast('檢查新片失敗：' + e.message);
    }
  } finally {
    state.channelsChecking = false;
    state.channelsCheckingId = '';
    if (state.page === 'briefing') render();
  }
}

async function deleteChannelStrategy(channelId, strategyId) {
  if (!channelId || !strategyId || !hasHttpFeed) return;
  try {
    const resp = await fetch('/api/channels/strategy/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId, strategyId })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '刪除策略卡失敗');
    state.channelsConfirmDeleteStrategy = '';
    applyChannelsState(data.state || data);
    toast('已刪除策略卡');
    render();
    if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
  } catch (e) {
    toast('刪除策略卡失敗：' + e.message);
  }
}

async function updateChannelsConfig(payload, successMsg = '') {
  if (!hasHttpFeed) {
    toast('請透過 ChipScreener.exe 或本機服務開啟以調整設定');
    return;
  }
  try {
    const resp = await fetch('/api/channels/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '更新頻道設定失敗');
    applyChannelsState(data.state || data);
    if (successMsg) toast(successMsg);
    if (state.page === 'briefing') render();
  } catch (e) {
    toast('更新頻道設定失敗：' + e.message);
  }
}

function addChannelTickerToWatchlist(code) {
  const sym = String(code || '').trim().toUpperCase();
  if (!sym) return;
  const firstFolder = (state.watchlistConfig?.folders || [])[0];
  const folderId = firstFolder?.id || 'wl_default';
  const folderName = firstFolder?.name || '我的自選股';
  watchlistAction('stock/add', { folderId, code: sym }, `已將 ${sym} 加入「${folderName}」`);
}

function applyChannelScreenerPreset(channelId, strategyId) {
  const ch = (state.channelsList || []).find(c => c.id === channelId);
  const strat = (ch?.strategies || []).find(s => s.id === strategyId);
  const p = strat?.screenerPreset;
  if (!p) {
    toast('此策略卡未附帶籌碼篩選預設參數');
    return;
  }
  try {
    const validated = validateSettings({
      ...DEFAULT,
      band: String(p.band ?? DEFAULT.band),
      weeks: Number(p.weeks ?? DEFAULT.weeks),
      minPp: Number(p.minPp ?? DEFAULT.minPp),
      weeklyMin: Number(p.weeklyMin ?? DEFAULT.weeklyMin),
      needShares: Boolean(p.needShares ?? DEFAULT.needShares)
    });
    const presetName = String(p.name || strat.videoTitle || '頻道策略').trim().slice(0, 50) || '頻道策略';
    const existingIdx = presets.findIndex(item => item.name === presetName);
    if (existingIdx >= 0) {
      presets[existingIdx] = { name: presetName, settings: { ...validated } };
    } else {
      presets.push({ name: presetName, settings: { ...validated } });
    }
    draft = { ...validated };
    applied = { ...validated };
    if (!saveConfig()) return;
    if (!state.manualWeek) useDefaultWeek();
    toast(`已存為篩選預設「${presetName}」並套用至全市場篩選`);
    go('screen');
  } catch (err) {
    toast('套用策略預設失敗：' + err.message);
  }
}

/* ---------- 模擬操盤 ＆ AI 操盤手 (/api/paper/*) ---------- */

function applyPaperState(payload) {
  const doc = payload?.state || payload;
  if (!doc || typeof doc !== 'object') return;
  if (doc.activeSlotId !== undefined) state.paperActiveSlotId = doc.activeSlotId || '';
  if (typeof doc.fxUsdTwd === 'number' && isFinite(doc.fxUsdTwd) && doc.fxUsdTwd > 0) {
    state.paperFxUsdTwd = doc.fxUsdTwd;
  }
  if (doc.ai) state.paperAi = doc.ai;
  if (doc.hasGeminiKey !== undefined) {
    state.paperHasGeminiKey = Boolean(doc.hasGeminiKey);
  }
  if (Array.isArray(doc.slots)) {
    state.paperSlots = doc.slots;
  }
  if (doc.slot !== undefined) {
    state.paperSlot = doc.slot || null;
    if (doc.slot?.id) state.paperActiveSlotId = doc.slot.id;
  }
  state.paperLoaded = true;
  state.paperError = '';
}

let paperOrderQuoteTimer = null;

function clearPaperOrderQuoteState(updateDom = false) {
  if (paperOrderQuoteTimer) {
    clearTimeout(paperOrderQuoteTimer);
    paperOrderQuoteTimer = null;
  }
  state.paperOrderQuoteReqId = (state.paperOrderQuoteReqId || 0) + 1;
  state.paperOrderQuoteCode = '';
  state.paperOrderQuoteLoading = false;
  state.paperOrderQuoteError = '';
  if (updateDom) updatePaperOrderQuotePreviewDom();
}

function resolvePaperOrderQuoteCode(rawText, slot, allowNameLookup = false) {
  const txt = String(rawText || '').trim();
  if (!txt) return '';
  const mkt = String(slot?.market || 'MIXED').toUpperCase();
  const scope = mkt === 'TW' ? 'TW' : mkt === 'US' ? 'US' : 'ALL';
  const upper = txt.toUpperCase();
  const isTw = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(upper);
  const usNorm = upper.replace('.', '-');
  const isUs = /^[A-Z][A-Z0-9-]{0,7}$/.test(usNorm);
  if (scope !== 'US' && isTw) return upper;
  if (scope !== 'TW' && isUs) return usNorm;
  if (allowNameLookup && typeof resolveStockInput === 'function') {
    const resolved = resolveStockInput(txt, scope);
    if (resolved) {
      const rTw = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(resolved);
      const rUs = /^[A-Z][A-Z0-9-]{0,7}$/.test(resolved.replace('.', '-'));
      if ((scope !== 'US' && rTw) || (scope !== 'TW' && rUs)) {
        return rTw ? resolved : resolved.replace('.', '-');
      }
    }
  }
  return '';
}

function updatePaperOrderQuotePreviewDom(codeOverride = null) {
  const el = $('#ptOrderQuotePreview');
  if (!el || typeof renderPaperOrderQuotePreviewHtml !== 'function') return;
  const code = codeOverride !== null ? codeOverride : state.paperOrderQuoteCode;
  el.innerHTML = renderPaperOrderQuotePreviewHtml(state.paperSlot, code);
}

async function fetchPaperOrderQuote(rawCode, allowNameLookup = true) {
  if (paperOrderQuoteTimer) {
    clearTimeout(paperOrderQuoteTimer);
    paperOrderQuoteTimer = null;
  }
  if (state.paperModal !== 'order' || !state.paperSlot) return;
  const code = resolvePaperOrderQuoteCode(rawCode, state.paperSlot, allowNameLookup);
  if (!code) {
    clearPaperOrderQuoteState(true);
    return;
  }

  const reqId = (state.paperOrderQuoteReqId || 0) + 1;
  state.paperOrderQuoteReqId = reqId;
  state.paperOrderQuoteCode = code;
  state.paperOrderQuoteError = '';

  if (!hasHttpFeed) {
    state.paperOrderQuoteLoading = false;
    state.paperOrderQuoteError = '離線模式無法查詢即時報價';
    updatePaperOrderQuotePreviewDom(code);
    return;
  }

  state.paperOrderQuoteLoading = true;
  updatePaperOrderQuotePreviewDom(code);

  try {
    const resp = await fetch('/api/quotes/live', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codes: [code], manual: true })
    });
    const data = await resp.json();
    if (state.paperModal !== 'order' || state.paperOrderQuoteReqId !== reqId) return;
    const curInp = $('#ptOrderCode');
    if (curInp) {
      const curResolved = resolvePaperOrderQuoteCode(curInp.value, state.paperSlot, true);
      if (curResolved && curResolved !== code) return;
    }
    if (!resp.ok || data.error) throw Error(data.error || '無法取得即時報價');
    const q = data.quotes?.[code];
    if (q && typeof q.price === 'number' && isFinite(q.price)) {
      state.liveQuotesByCode[code] = q;
      state.paperOrderQuoteError = '';
    } else {
      state.paperOrderQuoteError = `查無 ${code} 即時報價，請確認代號是否正確`;
    }
  } catch (e) {
    if (state.paperModal !== 'order' || state.paperOrderQuoteReqId !== reqId) return;
    if (!state.liveQuotesByCode?.[code]) {
      state.paperOrderQuoteError = `暫時無法查詢 ${code} 報價（${e.message}）`;
    }
  } finally {
    if (state.paperModal === 'order' && state.paperOrderQuoteReqId === reqId) {
      state.paperOrderQuoteLoading = false;
      updatePaperOrderQuotePreviewDom(code);
    }
  }
}

function schedulePaperOrderQuoteFetch(rawVal, delayMs = 300) {
  if (paperOrderQuoteTimer) {
    clearTimeout(paperOrderQuoteTimer);
    paperOrderQuoteTimer = null;
  }
  const trimmed = String(rawVal || '').trim();
  if (!trimmed) {
    clearPaperOrderQuoteState(true);
    return;
  }
  const immediateCode = resolvePaperOrderQuoteCode(trimmed, state.paperSlot, false);
  if (!immediateCode) {
    // 仍在輸入不完整名稱或代號時，先清除舊標的預覽避免誤導
    if (state.paperOrderQuoteCode) clearPaperOrderQuoteState(true);
    return;
  }
  if (state.liveQuotesByCode?.[immediateCode]) {
    state.paperOrderQuoteCode = immediateCode;
    state.paperOrderQuoteError = '';
    updatePaperOrderQuotePreviewDom(immediateCode);
  }
  paperOrderQuoteTimer = setTimeout(() => {
    paperOrderQuoteTimer = null;
    if (state.paperModal !== 'order') return;
    const latestVal = $('#ptOrderCode') ? $('#ptOrderCode').value : trimmed;
    const latestCode = resolvePaperOrderQuoteCode(latestVal, state.paperSlot, false);
    if (latestCode) fetchPaperOrderQuote(latestCode, false);
  }, delayMs);
}

function closePaperModal() {
  clearPaperOrderQuoteState(false);
  state.paperModal = null;
  state.paperSlotDraft = null;
  state.paperOrderDraft = null;
  state.paperConfirmReset = false;
  state.paperConfirmDelete = false;
  render();
}

async function loadPaperState(slotId = '', refresh = false) {
  if (!hasHttpFeed) {
    if (state.page === 'paper') render();
    return null;
  }
  const targetId = slotId || state.paperActiveSlotId || '';
  state.paperLoading = true;
  if (refresh) state.paperBusy = true;
  if (state.page === 'paper') render();
  try {
    const params = [];
    if (targetId) params.push('slotId=' + encodeURIComponent(targetId));
    params.push('refresh=' + (refresh ? '1' : '0'));
    const resp = await fetch('/api/paper?' + params.join('&'), { cache: 'no-store' });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '讀取模擬操盤存檔失敗');
    applyPaperState(data);
    if (refresh && state.paperSlot) {
      const pending = (state.paperSlot.orders || []).some(o => String(o.status || '').toUpperCase() === 'PENDING');
      if (pending) {
        await evaluatePaperOrders(state.paperSlot.id, true);
      } else {
        toast('已更新模擬存檔最新報價與淨值');
      }
    }
    if (state.page === 'paper' && typeof scheduleLiveQuoteTimer === 'function') {
      scheduleLiveQuoteTimer(true);
    }
    return data;
  } catch (e) {
    state.paperError = e.message;
    if (refresh) toast('更新模擬報價失敗：' + e.message);
    return null;
  } finally {
    state.paperLoading = false;
    if (refresh) state.paperBusy = false;
    if (state.page === 'paper') render();
  }
}

async function createPaperSlot(body, successMsg = '已建立模擬操盤存檔') {
  if (!hasHttpFeed || state.paperBusy) return null;
  state.paperBusy = true;
  render();
  try {
    const resp = await fetch('/api/paper/slot/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '建立存檔失敗');
    applyPaperState(data);
    state.paperModal = null;
    state.paperSlotDraft = null;
    toast(successMsg);
    if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
    return data;
  } catch (e) {
    toast('建立存檔失敗：' + e.message);
    return null;
  } finally {
    state.paperBusy = false;
    render();
  }
}

async function updatePaperSlot(body, successMsg = '已更新存檔設定') {
  if (!hasHttpFeed || state.paperBusy) return null;
  state.paperBusy = true;
  render();
  try {
    const resp = await fetch('/api/paper/slot/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '更新存檔設定失敗');
    applyPaperState(data);
    state.paperModal = null;
    state.paperSlotDraft = null;
    state.paperConfirmReset = false;
    state.paperConfirmDelete = false;
    toast(successMsg);
    return data;
  } catch (e) {
    toast('更新存檔設定失敗：' + e.message);
    return null;
  } finally {
    state.paperBusy = false;
    render();
  }
}

async function resetPaperSlot(slotId, initialCapital = null) {
  if (!hasHttpFeed || !slotId || state.paperBusy) return null;
  state.paperBusy = true;
  render();
  try {
    const payload = { slotId };
    if (typeof initialCapital === 'number' && isFinite(initialCapital) && initialCapital > 0) {
      payload.initialCapital = initialCapital;
    }
    const resp = await fetch('/api/paper/slot/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '重置存檔失敗');
    applyPaperState(data);
    state.paperModal = null;
    state.paperSlotDraft = null;
    state.paperConfirmReset = false;
    toast('已重置模擬操盤存檔');
    return data;
  } catch (e) {
    toast('重置存檔失敗：' + e.message);
    return null;
  } finally {
    state.paperBusy = false;
    render();
  }
}

async function deletePaperSlot(slotId) {
  if (!hasHttpFeed || !slotId || state.paperBusy) return null;
  state.paperBusy = true;
  render();
  try {
    const resp = await fetch('/api/paper/slot/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '刪除存檔失敗');
    applyPaperState(data);
    state.paperModal = null;
    state.paperSlotDraft = null;
    state.paperConfirmDelete = false;
    toast('已刪除模擬操盤存檔');
    return data;
  } catch (e) {
    toast('刪除存檔失敗：' + e.message);
    return null;
  } finally {
    state.paperBusy = false;
    render();
  }
}

async function placePaperOrder(body) {
  if (!hasHttpFeed || state.paperBusy) return null;
  state.paperBusy = true;
  render();
  try {
    const resp = await fetch('/api/paper/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '送單失敗');
    applyPaperState(data.state || data);
    clearPaperOrderQuoteState(false);
    state.paperModal = null;
    state.paperOrderDraft = null;
    toast(data.message || (body.orderType === 'MARKET' ? '模擬市價單已成交' : '條件掛單已送出'));
    if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
    return data;
  } catch (e) {
    toast('下單失敗：' + e.message);
    return null;
  } finally {
    state.paperBusy = false;
    render();
  }
}

async function cancelPaperOrder(slotId, orderId) {
  if (!hasHttpFeed || !slotId || !orderId || state.paperBusy) return null;
  state.paperBusy = true;
  render();
  try {
    const resp = await fetch('/api/paper/order/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId, orderId })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '撤單失敗');
    applyPaperState(data);
    toast('已撤銷條件掛單');
    return data;
  } catch (e) {
    toast('撤單失敗：' + e.message);
    return null;
  } finally {
    state.paperBusy = false;
    render();
  }
}

async function evaluatePaperOrders(slotId, silent = false) {
  if (!hasHttpFeed || !slotId) return null;
  if (!silent) {
    state.paperBusy = true;
    render();
  }
  try {
    const resp = await fetch('/api/paper/orders/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '檢查條件單失敗');
    applyPaperState(data.state || data);
    const trig = Array.isArray(data.triggered) ? data.triggered : [];
    if (trig.length > 0) {
      toast(`已觸發並成交 ${trig.length} 筆條件掛單`);
    } else if (!silent) {
      toast('已檢查最新報價，目前尚無條件單達到觸發價');
    }
    return data;
  } catch (e) {
    if (!silent) toast('檢查條件單失敗：' + e.message);
    return null;
  } finally {
    if (!silent) state.paperBusy = false;
    if (state.page === 'paper') render();
  }
}

async function runPaperAiDecision(slotId, force = true) {
  if (!hasHttpFeed || !slotId || state.paperAiBusy) return null;
  state.paperAiBusy = true;
  state.paperError = '';
  render();
  try {
    const resp = await fetch('/api/paper/ai/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId, force: Boolean(force) })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || 'AI 操盤決策失敗');
    applyPaperState(data.state || data);
    if (data.proposal) {
      toast('AI 操盤手已產生待審核提案，請於上方確認核准或駁回');
    } else if (Number(data.executedCount || 0) > 0) {
      toast(`AI 操盤手已完成分析並執行 ${data.executedCount} 筆模擬交易`);
    } else {
      state.paperActiveTab = 'ai_logs';
      toast('AI 操盤手已完成分析（本次建議維持觀望），詳見決策日誌');
    }
    if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
    return data;
  } catch (e) {
    state.paperError = e.message;
    toast('AI 決策失敗：' + e.message);
    return null;
  } finally {
    state.paperAiBusy = false;
    if (state.page === 'paper') render();
  }
}

async function resolvePaperProposal(slotId, proposalId, decision) {
  if (!hasHttpFeed || !slotId || !proposalId || state.paperBusy) return null;
  state.paperBusy = true;
  render();
  try {
    const resp = await fetch('/api/paper/ai/proposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotId, proposalId, decision })
    });
    const data = await resp.json();
    if (!resp.ok || data.error) throw Error(data.error || '處理 AI 提案失敗');
    applyPaperState(data.state || data);
    toast(
      data.message ||
        (decision === 'approve'
          ? `已核准提案並執行 ${data.executedCount || 0} 筆下單`
          : '已駁回本次 AI 提案')
    );
    if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
    return data;
  } catch (e) {
    toast('處理 AI 提案失敗：' + e.message);
    return null;
  } finally {
    state.paperBusy = false;
    if (state.page === 'paper') render();
  }
}

function snapshotPaperSlotDraftFromDom() {
  const d = state.paperSlotDraft || ptBuildDefaultSlotDraft(null);
  const numVal = (sel, fallback) => {
    const el = $(sel);
    if (!el) return fallback;
    const n = Number(el.value);
    return isFinite(n) ? n : fallback;
  };
  const next = {
    ...d,
    name: $('#ptSlotName') ? $('#ptSlotName').value : d.name,
    market: $('#ptSlotMarket') ? $('#ptSlotMarket').value : d.market,
    initialCapital: numVal('#ptSlotCapital', d.initialCapital),
    mode: $('#ptSlotMode') ? $('#ptSlotMode').value : d.mode,
    fees: {
      twBuyFeeRate: numVal('#ptFeeTwBuy', (d.fees?.twBuyFeeRate ?? 0.001425) * 100) / 100,
      twSellFeeRate: numVal('#ptFeeTwSell', (d.fees?.twSellFeeRate ?? 0.001425) * 100) / 100,
      twFeeDiscount: numVal('#ptFeeTwDisc', d.fees?.twFeeDiscount ?? 1.0),
      twMinFee: numVal('#ptFeeTwMin', d.fees?.twMinFee ?? 20.0),
      twStockTaxRate: numVal('#ptFeeTwTax', (d.fees?.twStockTaxRate ?? 0.003) * 100) / 100,
      twEtfTaxRate: numVal('#ptFeeTwEtfTax', (d.fees?.twEtfTaxRate ?? 0.001) * 100) / 100,
      usFeeRate: numVal('#ptFeeUsRate', (d.fees?.usFeeRate ?? 0.0) * 100) / 100,
      usMinFee: numVal('#ptFeeUsMin', d.fees?.usMinFee ?? 0.0)
    },
    aiConfig: {
      ...(d.aiConfig || PT_DEFAULT_AI_CONFIG),
      autonomy: $('#ptAiAutonomy') ? $('#ptAiAutonomy').value : d.aiConfig?.autonomy || 'semi',
      style: $('#ptAiStyle') ? $('#ptAiStyle').value : d.aiConfig?.style || 'balanced',
      scheduleMode: $('#ptAiSchedule') ? $('#ptAiSchedule').value : d.aiConfig?.scheduleMode || 'manual',
      cooldownMinutes: numVal('#ptAiCooldown', d.aiConfig?.cooldownMinutes ?? 60),
      customPrompt: $('#ptAiCustomPrompt') ? $('#ptAiCustomPrompt').value : d.aiConfig?.customPrompt || '',
      guardrails: {
        maxSingleStockPct: numVal('#ptGrMaxSingle', d.aiConfig?.guardrails?.maxSingleStockPct ?? 25),
        maxPositions: Math.round(numVal('#ptGrMaxPos', d.aiConfig?.guardrails?.maxPositions ?? 8)),
        minCashFloorPct: numVal('#ptGrMinCash', d.aiConfig?.guardrails?.minCashFloorPct ?? 15),
        defaultStopLossPct: numVal('#ptGrDefSl', d.aiConfig?.guardrails?.defaultStopLossPct ?? 8),
        defaultTakeProfitPct: numVal('#ptGrDefTp', d.aiConfig?.guardrails?.defaultTakeProfitPct ?? 18)
      },
      tools: { ...(d.aiConfig?.tools || PT_DEFAULT_AI_CONFIG.tools) }
    }
  };
  document.querySelectorAll('[data-pt-ai-tool]').forEach(cb => {
    next.aiConfig.tools[cb.dataset.ptAiTool] = Boolean(cb.checked);
  });
  state.paperSlotDraft = next;
  return next;
}

function snapshotPaperOrderDraftFromDom() {
  const d = state.paperOrderDraft || ptBuildDefaultOrderDraft();
  const next = {
    ...d,
    code: $('#ptOrderCode') ? $('#ptOrderCode').value : d.code,
    orderType: $('#ptOrderType') ? $('#ptOrderType').value : d.orderType,
    shares: $('#ptOrderShares') ? $('#ptOrderShares').value : d.shares,
    triggerPrice: $('#ptOrderTriggerPrice') ? $('#ptOrderTriggerPrice').value : d.triggerPrice,
    stopLossPct: $('#ptOrderSlPct') ? $('#ptOrderSlPct').value : d.stopLossPct,
    takeProfitPct: $('#ptOrderTpPct') ? $('#ptOrderTpPct').value : d.takeProfitPct,
    note: $('#ptOrderNote') ? $('#ptOrderNote').value : d.note
  };
  state.paperOrderDraft = next;
  return next;
}

function submitPaperSlotModal() {
  const d = snapshotPaperSlotDraftFromDom();
  const name = String(d.name || '').trim();
  if (!name) {
    toast('請輸入模擬存檔名稱');
    $('#ptSlotName')?.focus();
    return;
  }
  if (d.modeType === 'settings') {
    updatePaperSlot(
      {
        slotId: d.slotId,
        name,
        mode: d.mode,
        fees: d.fees,
        aiConfig: d.aiConfig
      },
      `已儲存「${name}」存檔設定`
    );
  } else {
    const cap = Number(d.initialCapital);
    if (!isFinite(cap) || cap <= 0) {
      toast('請輸入大於 0 的初始本金');
      $('#ptSlotCapital')?.focus();
      return;
    }
    createPaperSlot(
      {
        name,
        market: d.market,
        initialCapital: cap,
        mode: d.mode,
        fees: d.fees,
        aiConfig: d.aiConfig
      },
      `已建立存檔「${name}」`
    );
  }
}

function submitPaperOrderModal() {
  const slot = state.paperSlot;
  if (!slot) return;
  const d = snapshotPaperOrderDraftFromDom();
  const scope = slot.market === 'TW' ? 'TW' : slot.market === 'US' ? 'US' : 'ALL';
  const resolvedCode =
    typeof resolveStockInput === 'function'
      ? resolveStockInput(d.code, scope)
      : String(d.code || '').trim().toUpperCase();
  if (!resolvedCode) {
    toast('請輸入有效的股票代號或名稱');
    $('#ptOrderCode')?.focus();
    return;
  }
  const isTwSym = typeof ptIsTwCode === 'function' ? ptIsTwCode(resolvedCode) : /^\d{4}$/.test(resolvedCode);
  let qty = Number(d.shares);
  if (!isFinite(qty) || qty <= 0) {
    toast('請輸入大於 0 的委託數量');
    $('#ptOrderShares')?.focus();
    return;
  }
  if (isTwSym && d.unit === 'lots') {
    qty = Math.round(qty * 1000);
  } else if (isTwSym) {
    qty = Math.round(qty);
  }
  const body = {
    slotId: slot.id,
    side: d.side === 'SELL' ? 'SELL' : 'BUY',
    code: resolvedCode,
    shares: qty,
    orderType: d.orderType || 'MARKET',
    note: String(d.note || '').trim()
  };
  if (body.orderType !== 'MARKET') {
    const tp = Number(d.triggerPrice);
    if (!isFinite(tp) || tp <= 0) {
      toast('條件掛單必須輸入大於 0 的觸發價格');
      $('#ptOrderTriggerPrice')?.focus();
      return;
    }
    body.triggerPrice = tp;
  } else if (body.side === 'BUY') {
    const slPct = Number(d.stopLossPct);
    const tpPct = Number(d.takeProfitPct);
    if (d.stopLossPct !== '' && isFinite(slPct) && slPct > 0) body.stopLossPct = slPct;
    if (d.takeProfitPct !== '' && isFinite(tpPct) && tpPct > 0) body.takeProfitPct = tpPct;
  }
  placePaperOrder(body);
}

let activeStockDetailRequest;

async function loadStockDetail(code, force = false) {
  const request = Symbol(code);
  activeStockDetailRequest = request;
  if (!force && state.stockDetailByCode?.[code]?.bars?.length) {
    state.stockDetailLoading = false;
    state.stockDetailError = '';
    render();
    return;
  }
  if (!hasHttpFeed) {
    state.stockDetailError = `目前為純離線檔案模式；請透過 ChipScreener.exe 或本機服務開啟以載入 ${code} 個股詳情。`;
    render();
    return;
  }
  state.stockDetailLoading = true;
  state.stockDetailError = '';
  render();

  try {
    const resp = await fetch(
      `/api/tw/detail?code=${encodeURIComponent(code)}${force ? '&refresh=1' : ''}`,
      { cache: 'no-store' }
    );
    const payload = await resp.json();
    if (!resp.ok || payload.error) {
      throw Error(payload.error || '無法取得個股詳情資料');
    }
    if (payload.code !== code) throw Error('來源股票代號與本次查詢不符');
    state.stockDetailByCode[code] = payload;
  } catch (e) {
    if (activeStockDetailRequest === request) state.stockDetailError = e.message;
  } finally {
    if (activeStockDetailRequest === request) {
      state.stockDetailLoading = false;
      if (state.page === 'stock' && state.stock === code) render();
    }
  }
}

function handleSetting(el) {
  const key = el.dataset.setting;
  const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
  try {
    draft = validateSettings({ ...draft, [key]: value });
    saveConfig();
  } catch (e) {
    toast(e.message);
  }
}

const VALID_SYMBOL_RE = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/i;

function submitStockSearch() {
  const input = $('#stockCode');
  if (!input) return;
  const code = typeof resolveStockInput === 'function' ? resolveStockInput(input.value, 'ALL') : input.value.trim().toUpperCase();
  if (VALID_SYMBOL_RE.test(code)) {
    selectStock(code);
    return;
  }
  if (/^[A-Z][A-Z0-9.-]{0,7}$/.test(code)) {
    selectUsStock(code);
    return;
  }
  toast('請輸入有效台股代號／股名（如 2404、台積電）或美股（如 NVDA、輝達）');
}

function submitFeaturedCase() {
  const input = $('#featuredCodeInput');
  if (!input) return;
  const code = typeof resolveStockInput === 'function' ? resolveStockInput(input.value, 'TW') : input.value.trim().toUpperCase();
  if (!VALID_SYMBOL_RE.test(code)) {
    toast('請輸入有效股票或 ETF 代號（如 0050、2330、2404）');
    input.focus();
    return;
  }
  state.featuredCode = code;
  state.editingFeatured = false;
  saveFeaturedCode(code);
  render();
  const label = D.stocks[code]?.[0] ? `${code} ${D.stocks[code][0]}` : code;
  toast('已更換固定驗收案例為 ' + label);
}

async function submitPeakStock() {
  const input = $('#peakStockCode');
  if (!input) return;
  const code = typeof resolveStockInput === 'function' ? resolveStockInput(input.value, 'TW') : input.value.trim().toUpperCase();
  if (!VALID_SYMBOL_RE.test(code)) {
    toast('請輸入有效股票或 ETF 代號（如 2404、2330、0050）');
    input.focus();
    return;
  }

  state.peakStock = code;
  state.peakError = '';

  if (D.dailyByCode[code]?.length) {
    const days = D.dailyByCode[code].map(x => x[0]);
    if (!days.includes(state.peakBase)) state.peakBase = days[Math.max(0, days.length - 15)];
    if (!days.includes(state.peakCompare)) state.peakCompare = days.at(-1);
    state.editingPeakStock = false;
    render();
    return;
  }

  if (!hasHttpFeed) {
    state.peakError = `目前為純離線檔案模式，僅內建 2404 日 K；請透過 ChipScreener.exe 或本機服務開啟以載入 ${code} 日行情。`;
    render();
    return;
  }

  state.peakLoading = true;
  render();

  try {
    const resp = await fetch('/api/daily?code=' + encodeURIComponent(code), { cache: 'no-store' });
    const payload = await resp.json();
    if (!resp.ok || payload.error) {
      throw Error(payload.error || '無法取得日行情資料');
    }
    D.dailyByCode[code] = payload.bars;
    if (payload.name && !D.stocks[code]) {
      D.stocks[code] = [payload.name, 'TWSE'];
    }
    const days = payload.bars.map(x => x[0]);
    state.peakBase = days[Math.max(0, days.length - 15)];
    state.peakCompare = days.at(-1);
    state.editingPeakStock = false;
    const label = D.stocks[code]?.[0] ? `${code} ${D.stocks[code][0]}` : code;
    toast(`已載入 ${label} ${days.length} 個交易日資料`);
  } catch (e) {
    state.peakError = `${code} 日行情載入失敗：${e.message}`;
    toast(state.peakError);
  } finally {
    state.peakLoading = false;
    render();
  }
}

/* ---------- 事件委派 ---------- */

document.body.addEventListener('click', e => {
  if (e.target.id === 'ptModalBackdrop' || e.target.id === 'ptCloseModalBtn' || e.target.id === 'ptCloseModalBtn2') {
    closePaperModal();
    return;
  }

  if (e.target.id === 'quickFavBackdrop' || e.target.id === 'closeQuickFavBtn') {
    state.quickFavCode = null;
    render();
    return;
  }

  const quickFavBtn = e.target.closest?.('[data-quick-fav]');
  if (quickFavBtn) {
    e.stopPropagation();
    state.quickFavCode = quickFavBtn.dataset.quickFav;
    render();
    return;
  }

  const qfavFolderBtn = e.target.closest?.('[data-qfav-folder]');
  if (qfavFolderBtn) {
    const folderId = qfavFolderBtn.dataset.qfavFolder;
    const code = qfavFolderBtn.dataset.qfavCode;
    const folder = (state.watchlistConfig?.folders || []).find(f => f.id === folderId);
    const has = (folder?.items || []).some(it => it.code === code);
    watchlistAction(
      has ? 'stock/remove' : 'stock/add',
      { folderId, code },
      has ? `已從「${folder?.name || ''}」移出 ${code}` : `已將 ${code} 加入「${folder?.name || ''}」`
    );
    return;
  }

  const goSoftwareAiBtn = e.target.closest?.('[data-go-software-ai]');
  if (goSoftwareAiBtn) {
    go('software');
    return;
  }

  const ptTabBtn = e.target.closest?.('[data-pt-tab]');
  if (ptTabBtn) {
    state.paperActiveTab = ptTabBtn.dataset.ptTab;
    render();
    return;
  }

  const ptPresetBtn = e.target.closest?.('[data-pt-preset]');
  if (ptPresetBtn) {
    const kind = ptPresetBtn.dataset.ptPreset;
    if (kind === 'tw_manual') {
      createPaperSlot(
        { name: '台股 100 萬手動存檔', market: 'TW', initialCapital: 1000000, mode: 'manual' },
        '已建立「台股 100 萬手動存檔」'
      );
    } else if (kind === 'mixed_ai') {
      createPaperSlot(
        {
          name: '台美混合 100 萬 AI 存檔',
          market: 'MIXED',
          initialCapital: 1000000,
          mode: 'ai',
          aiConfig: {
            ...PT_DEFAULT_AI_CONFIG,
            autonomy: 'semi',
            style: 'balanced'
          }
        },
        '已建立「台美混合 100 萬 AI 存檔」'
      );
    }
    return;
  }

  const ptOpenStockBtn = e.target.closest?.('[data-pt-open-stock]');
  if (ptOpenStockBtn) {
    const code = ptOpenStockBtn.dataset.ptOpenStock;
    const market = ptOpenStockBtn.dataset.ptStockMarket || '';
    if (market === 'US' || (typeof isUsSymbol === 'function' && isUsSymbol(code, market))) {
      selectUsStock(code, { returnPage: 'paper' });
    } else {
      selectStock(code, { mode: 'detail', returnPage: 'paper' });
    }
    return;
  }

  const ptQuickSellBtn = e.target.closest?.('[data-pt-quick-sell]');
  if (ptQuickSellBtn && state.paperSlot) {
    const code = ptQuickSellBtn.dataset.ptQuickSell;
    const pos = (state.paperSlot.positionsList || []).find(p => p.code === code);
    clearPaperOrderQuoteState(false);
    state.paperOrderDraft = ptBuildDefaultOrderDraft({
      side: 'SELL',
      code,
      orderType: 'MARKET',
      shares: pos ? String(pos.shares) : '',
      unit: 'shares'
    });
    state.paperModal = 'order';
    render();
    fetchPaperOrderQuote(code, true);
    return;
  }

  const ptQuickSltpBtn = e.target.closest?.('[data-pt-quick-sltp]');
  if (ptQuickSltpBtn && state.paperSlot) {
    const code = ptQuickSltpBtn.dataset.ptQuickSltp;
    const pos = (state.paperSlot.positionsList || []).find(p => p.code === code);
    const refPrice = pos?.currentPrice || pos?.avgCost || 0;
    const defaultStop = refPrice > 0 ? Number((refPrice * 0.92).toFixed(pos?.market === 'US' ? 2 : 1)) : '';
    clearPaperOrderQuoteState(false);
    state.paperOrderDraft = ptBuildDefaultOrderDraft({
      side: 'SELL',
      code,
      orderType: 'STOP_LOSS',
      shares: pos ? String(pos.shares) : '',
      unit: 'shares',
      triggerPrice: defaultStop !== '' ? String(defaultStop) : '',
      note: '持倉快速設定停損'
    });
    state.paperModal = 'order';
    render();
    fetchPaperOrderQuote(code, true);
    return;
  }

  const ptCancelOrderBtn = e.target.closest?.('[data-pt-cancel-order]');
  if (ptCancelOrderBtn && state.paperSlot) {
    cancelPaperOrder(state.paperSlot.id, ptCancelOrderBtn.dataset.ptCancelOrder);
    return;
  }

  const ptApproveBtn = e.target.closest?.('[data-pt-proposal-approve]');
  if (ptApproveBtn && state.paperSlot) {
    resolvePaperProposal(state.paperSlot.id, ptApproveBtn.dataset.ptProposalApprove, 'approve');
    return;
  }

  const ptRejectBtn = e.target.closest?.('[data-pt-proposal-reject]');
  if (ptRejectBtn && state.paperSlot) {
    resolvePaperProposal(state.paperSlot.id, ptRejectBtn.dataset.ptProposalReject, 'reject');
    return;
  }

  const ptSwitchSlotBtn = e.target.closest?.('[data-pt-switch-slot]');
  if (ptSwitchSlotBtn) {
    const sid = ptSwitchSlotBtn.dataset.ptSwitchSlot;
    state.paperModal = null;
    if (sid && sid !== state.paperActiveSlotId) {
      loadPaperState(sid, false);
    } else {
      render();
    }
    return;
  }

  const ptOrderSideBtn = e.target.closest?.('[data-pt-order-side]');
  if (ptOrderSideBtn) {
    const d = snapshotPaperOrderDraftFromDom();
    const nextSide = ptOrderSideBtn.dataset.ptOrderSide === 'SELL' ? 'SELL' : 'BUY';
    d.side = nextSide;
    if (nextSide === 'BUY' && (d.orderType === 'STOP_LOSS' || d.orderType === 'TAKE_PROFIT')) {
      d.orderType = 'MARKET';
    }
    state.paperOrderDraft = d;
    render();
    return;
  }

  const ptOrderUnitBtn = e.target.closest?.('[data-pt-order-unit]');
  if (ptOrderUnitBtn) {
    const d = snapshotPaperOrderDraftFromDom();
    d.unit = ptOrderUnitBtn.dataset.ptOrderUnit === 'lots' ? 'lots' : 'shares';
    state.paperOrderDraft = d;
    render();
    return;
  }

  const ptQuickQtyBtn = e.target.closest?.('[data-pt-quick-qty]');
  if (ptQuickQtyBtn) {
    const d = snapshotPaperOrderDraftFromDom();
    const rawShares = Number(ptQuickQtyBtn.dataset.ptQuickQty);
    if (isFinite(rawShares) && rawShares > 0) {
      d.shares = d.unit === 'lots' && rawShares >= 1000 && rawShares % 1000 === 0 ? String(rawShares / 1000) : String(rawShares);
      if (d.unit === 'lots' && rawShares % 1000 !== 0) d.unit = 'shares';
      state.paperOrderDraft = d;
      render();
    }
    return;
  }

  const briefingTabBtn = e.target.closest?.('[data-briefing-tab]');
  if (briefingTabBtn) {
    const nextTab = briefingTabBtn.dataset.briefingTab === 'channels' ? 'channels' : 'daily';
    if (state.briefingTab !== nextTab) {
      state.briefingTab = nextTab;
      state.channelsConfirmRemoveId = '';
      state.channelsConfirmDeleteStrategy = '';
      render();
      if (nextTab === 'channels') {
        loadChannels(true);
      } else {
        loadBriefing(state.briefingSelectedDate || '');
      }
      if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
    }
    return;
  }

  const chRemoveAskBtn = e.target.closest?.('[data-ch-remove-ask]');
  if (chRemoveAskBtn) {
    e.stopPropagation();
    const id = chRemoveAskBtn.dataset.chRemoveAsk;
    state.channelsConfirmRemoveId = state.channelsConfirmRemoveId === id ? '' : id;
    render();
    return;
  }

  const chRemoveConfirmBtn = e.target.closest?.('[data-ch-remove-confirm]');
  if (chRemoveConfirmBtn) {
    e.stopPropagation();
    removeChannelSubscription(chRemoveConfirmBtn.dataset.chRemoveConfirm);
    return;
  }

  const chRemoveCancelBtn = e.target.closest?.('[data-ch-remove-cancel]');
  if (chRemoveCancelBtn) {
    e.stopPropagation();
    state.channelsConfirmRemoveId = '';
    render();
    return;
  }

  const chSelectEl = e.target.closest?.('[data-ch-select]');
  if (chSelectEl) {
    const id = chSelectEl.dataset.chSelect;
    if (state.channelsSelectedId !== id) {
      state.channelsSelectedId = id;
      state.channelsConfirmRemoveId = '';
      state.channelsConfirmDeleteStrategy = '';
      render();
      if (typeof scheduleLiveQuoteTimer === 'function') scheduleLiveQuoteTimer(true);
    }
    return;
  }

  const chCheckOneBtn = e.target.closest?.('[data-ch-check-one]');
  if (chCheckOneBtn) {
    checkChannels(chCheckOneBtn.dataset.chCheckOne, true, false);
    return;
  }

  const chDelStratAskBtn = e.target.closest?.('[data-ch-del-strat-ask]');
  if (chDelStratAskBtn) {
    state.channelsConfirmDeleteStrategy = chDelStratAskBtn.dataset.chDelStratAsk;
    render();
    return;
  }

  const chDelStratConfirmBtn = e.target.closest?.('[data-ch-del-strat-confirm]');
  if (chDelStratConfirmBtn) {
    deleteChannelStrategy(chDelStratConfirmBtn.dataset.chId, chDelStratConfirmBtn.dataset.stratId);
    return;
  }

  const chDelStratCancelBtn = e.target.closest?.('[data-ch-del-strat-cancel]');
  if (chDelStratCancelBtn) {
    state.channelsConfirmDeleteStrategy = '';
    render();
    return;
  }

  const chApplyPresetBtn = e.target.closest?.('[data-ch-apply-preset]');
  if (chApplyPresetBtn) {
    applyChannelScreenerPreset(chApplyPresetBtn.dataset.chId, chApplyPresetBtn.dataset.stratId);
    return;
  }

  const chFavBtn = e.target.closest?.('[data-ch-fav]');
  if (chFavBtn) {
    e.stopPropagation();
    addChannelTickerToWatchlist(chFavBtn.dataset.chFav);
    return;
  }

  const chOpenTickerBtn = e.target.closest?.('[data-ch-open-ticker]');
  if (chOpenTickerBtn) {
    const code = chOpenTickerBtn.dataset.chOpenTicker;
    const market = chOpenTickerBtn.dataset.chTickerMarket || '';
    if (market === 'US' || (typeof isUsSymbol === 'function' && isUsSymbol(code, market))) {
      selectUsStock(code);
    } else {
      selectStock(code, { mode: 'detail' });
    }
    return;
  }

  const wlTabBtn = e.target.closest?.('[data-wl-tab]');
  if (wlTabBtn) {
    state.watchlistActiveTab = wlTabBtn.dataset.wlTab;
    state.watchlistMenuKey = null;
    state.watchlistRenamingFolderId = null;
    render();
    return;
  }

  const wlFilterBtn = e.target.closest?.('[data-wl-filter]');
  if (wlFilterBtn) {
    state.watchlistFilter = wlFilterBtn.dataset.wlFilter;
    render();
    return;
  }

  const wlMenuBtn = e.target.closest?.('[data-wl-menu-toggle]');
  if (wlMenuBtn) {
    e.stopPropagation();
    const key = wlMenuBtn.dataset.wlMenuToggle;
    state.watchlistMenuKey = state.watchlistMenuKey === key ? null : key;
    render();
    return;
  }

  const wlToggleAutoBtn = e.target.closest?.('[data-wl-toggle-auto]');
  if (wlToggleAutoBtn) {
    const code = wlToggleAutoBtn.dataset.wlToggleAuto;
    const inAuto = (state.watchlistConfig?.autoStocks || []).includes(code);
    watchlistAction(
      'auto/toggle',
      { code, enabled: !inAuto },
      !inAuto ? `已將 ${code} 加入獨立自動分析收藏夾` : `已將 ${code} 移出自動分析`
    );
    return;
  }

  const wlRemoveBtn = e.target.closest?.('[data-wl-remove-item]');
  if (wlRemoveBtn) {
    const [folderId, code] = wlRemoveBtn.dataset.wlRemoveItem.split(':');
    state.watchlistMenuKey = null;
    watchlistAction('stock/remove', { folderId, code }, `已從此收藏夾刪除 ${code}`);
    return;
  }

  const toggleMktBtn = e.target.closest?.('[data-toggle-market]');
  if (toggleMktBtn) {
    setMarket(state.market === 'TW' ? 'US' : 'TW');
    return;
  }

  const livePillBtn = e.target.closest?.('#liveQuotePill');
  if (livePillBtn) {
    pollLiveQuotes(true);
    return;
  }

  const marketBtn = e.target.closest?.('[data-set-market]');
  if (marketBtn) {
    setMarket(marketBtn.dataset.setMarket);
    return;
  }

  const usStockEl = e.target.closest?.('[data-us-stock]');
  if (usStockEl) {
    selectUsStock(usStockEl.dataset.usStock);
    return;
  }

  const usJumpModeEl = e.target.closest?.('[data-us-jump-mode]');
  if (usJumpModeEl) {
    state.usScreenerMode = usJumpModeEl.dataset.usJumpMode;
    state.usSector = 'ALL';
    state.usFilter = 'all';
    state.usSort = 'scoreDesc';
    state.usPageNum = 0;
    go('us_screen');
    return;
  }

  const usModeBtn = e.target.closest?.('[data-us-mode]');
  if (usModeBtn) {
    state.usScreenerMode = usModeBtn.dataset.usMode;
    state.usSort = 'scoreDesc';
    state.usPageNum = 0;
    render();
    return;
  }

  const usJumpSecEl = e.target.closest?.('[data-us-jump-sector]');
  if (usJumpSecEl) {
    state.usScreenerMode = 'all';
    state.usSector = usJumpSecEl.dataset.usJumpSector;
    state.usFilter = 'all';
    state.usPageNum = 0;
    go('us_screen');
    return;
  }

  const usSectorBtn = e.target.closest?.('[data-us-sector]');
  if (usSectorBtn) {
    state.usSector = usSectorBtn.dataset.usSector;
    state.usPageNum = 0;
    render();
    return;
  }

  const usFilterBtn = e.target.closest?.('[data-us-filter]');
  if (usFilterBtn) {
    state.usFilter = usFilterBtn.dataset.usFilter;
    state.usPageNum = 0;
    render();
    return;
  }

  const usSubBtn = e.target.closest?.('[data-us-sub]');
  if (usSubBtn) {
    state.usSubTab = usSubBtn.dataset.usSub;
    render();
    return;
  }

  const wlOpenStockEl = e.target.closest?.('[data-wl-open-stock]');
  if (wlOpenStockEl) {
    const sym = wlOpenStockEl.dataset.wlOpenStock;
    if (typeof isUsSymbol === 'function' && isUsSymbol(sym)) {
      selectUsStock(sym, { returnPage: 'watchlist' });
    } else {
      selectStock(sym, { mode: 'detail', returnPage: 'watchlist' });
    }
    return;
  }

  const nav = e.target.closest?.('[data-nav]');
  if (nav) {
    if (nav.dataset.nav === 'watchlist') state.quickFavCode = null;
    go(nav.dataset.nav);
    return;
  }

  const stockTarget = e.target.closest?.('[data-stock]');
  if (stockTarget) {
    selectStock(stockTarget.dataset.stock);
    return;
  }

  const rangeBtn = e.target.closest?.('[data-chart-range]');
  if (rangeBtn) {
    state.chartRange = rangeBtn.dataset.chartRange;
    render();
    return;
  }

  const dailyBtn = e.target.closest?.('[data-daily-range]');
  if (dailyBtn) {
    state.dailyRange = Number(dailyBtn.dataset.dailyRange);
    render();
    return;
  }

  const presetBtn = e.target.closest?.('[data-load-preset]');
  if (presetBtn) {
    draft = validateSettings(presets[Number(presetBtn.dataset.loadPreset)].settings);
    if (!saveConfig()) return;
    render();
    toast('已載入 B 草稿，現行選股未改變');
    return;
  }

  const modeBtn = e.target.closest?.('[data-set-mode]');
  if (modeBtn) {
    const nextMode = modeBtn.dataset.setMode;
    if (state.stockMode !== nextMode) {
      state.stockMode = nextMode;
      state.detailHoverIdx = null;
      render();
      if (nextMode === 'detail') loadStockDetail(state.stock);
    }
    return;
  }

  const tfBtn = e.target.closest?.('[data-tf]');
  if (tfBtn) {
    state.detailTf = tfBtn.dataset.tf;
    state.detailHoverIdx = null;
    render();
    return;
  }

  const detailRangeBtn = e.target.closest?.('[data-detail-range]');
  if (detailRangeBtn) {
    state.detailRange = Number(detailRangeBtn.dataset.detailRange);
    state.detailHoverIdx = null;
    render();
    return;
  }

  const chipTabBtn = e.target.closest?.('[data-detail-chip]');
  if (chipTabBtn) {
    state.detailChipTab = chipTabBtn.dataset.detailChip;
    render();
    return;
  }

  switch (e.target.id) {
    case 'ptOpenCreateBtn':
      state.paperSlotDraft = ptBuildDefaultSlotDraft(null);
      state.paperConfirmReset = false;
      state.paperConfirmDelete = false;
      state.paperModal = 'create';
      render();
      $('#ptSlotName')?.focus();
      break;
    case 'ptOpenSettingsBtn':
      if (!state.paperSlot) break;
      state.paperSlotDraft = ptBuildDefaultSlotDraft(state.paperSlot);
      state.paperConfirmReset = false;
      state.paperConfirmDelete = false;
      state.paperModal = 'settings';
      render();
      break;
    case 'ptOpenCompareBtn':
      state.paperModal = 'compare';
      render();
      break;
    case 'ptRefreshQuotesBtn':
      loadPaperState(state.paperActiveSlotId || '', true);
      break;
    case 'ptOpenOrderBtn':
      if (!state.paperSlot) break;
      clearPaperOrderQuoteState(false);
      state.paperOrderDraft = ptBuildDefaultOrderDraft();
      state.paperModal = 'order';
      render();
      $('#ptOrderCode')?.focus();
      break;
    case 'ptNewCondOrderBtn':
      if (!state.paperSlot) break;
      clearPaperOrderQuoteState(false);
      state.paperOrderDraft = ptBuildDefaultOrderDraft({ orderType: 'LIMIT' });
      state.paperModal = 'order';
      render();
      $('#ptOrderCode')?.focus();
      break;
    case 'ptRunAiBtn':
      if (state.paperSlot) runPaperAiDecision(state.paperSlot.id, true);
      break;
    case 'ptEvalOrdersBtn':
      if (state.paperSlot) evaluatePaperOrders(state.paperSlot.id, false);
      break;
    case 'ptSaveSlotBtn':
      submitPaperSlotModal();
      break;
    case 'ptSubmitOrderBtn':
      submitPaperOrderModal();
      break;
    case 'ptAskResetBtn':
      snapshotPaperSlotDraftFromDom();
      state.paperConfirmReset = true;
      state.paperConfirmDelete = false;
      render();
      break;
    case 'ptConfirmResetBtn': {
      if (!state.paperSlot) break;
      const cap = Number($('#ptResetCapitalInput')?.value);
      resetPaperSlot(state.paperSlot.id, isFinite(cap) && cap > 0 ? cap : null);
      break;
    }
    case 'ptAskDeleteBtn':
      snapshotPaperSlotDraftFromDom();
      state.paperConfirmDelete = true;
      state.paperConfirmReset = false;
      render();
      break;
    case 'ptConfirmDeleteBtn':
      if (state.paperSlot) deletePaperSlot(state.paperSlot.id);
      break;
    case 'ptCancelDangerBtn':
      snapshotPaperSlotDraftFromDom();
      state.paperConfirmReset = false;
      state.paperConfirmDelete = false;
      render();
      break;
    case 'dismissUpdateBannerBtn':
      state.updateBannerDismissed = true;
      renderUpdateBanner();
      break;
    case 'dismissReleaseNoticeBtn':
      dismissReleaseNotice();
      break;
    case 'bannerApplyUpdateBtn':
    case 'swApplyUpdateBtn':
      applyUpdateAndRestart();
      break;
    case 'swCheckUpdateBtn':
      checkForUpdates(false);
      break;
    case 'swInstallEntryBtn':
      installFixedEntry();
      break;
    case 'swRollbackUpdateBtn':
      applyUpdateAndRestart(true);
      break;
    case 'swStopLocalService':
      if (!confirm('停止後可以關閉此視窗，再雙擊要使用的版本。確定停止本機服務？')) break;
      fetch('/api/software/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true })
      }).then(response => {
        if (!response.ok) throw Error('本機服務未能停止');
        toast('本機服務已停止。請關閉此視窗，再開啟要使用的版本。');
      }).catch(error => toast(error.message));
      break;
    case 'usQuickSearchBtn': {
      const sym = resolveStockInput($('#usQuickSearchInput')?.value || '', 'US');
      if (sym) selectUsStock(sym);
      else toast('請輸入美股代號或名稱（如 NVDA、輝達）');
      break;
    }
    case 'usDirectCodeBtn': {
      const sym = resolveStockInput($('#usDirectCodeInput')?.value || '', 'US');
      if (sym) selectUsStock(sym);
      else toast('請輸入美股代號或名稱（如 NVDA、輝達）');
      break;
    }
    case 'goUsStockBtn': {
      const sym = resolveStockInput($('#usStockCodeInput')?.value || '', 'US');
      if (sym) selectUsStock(sym);
      else toast('請輸入美股代號或名稱');
      break;
    }
    case 'refreshUsOverviewBtn':
      loadUsOverview(true);
      break;
    case 'refreshUsScreenerBtn':
      loadUsScreener(true);
      break;
    case 'usPrevPage':
      state.usPageNum = Math.max(0, state.usPageNum - 1);
      render();
      break;
    case 'usNextPage':
      state.usPageNum++;
      render();
      break;
    case 'exportUsScreener': {
      const list = state.usShowList || [];
      if (!list.length) {
        toast('目前沒有可匯出的美股篩選資料');
        break;
      }
      csvDownload(
        `us_sp500_${state.usScreenerMode || 'all'}.csv`,
        list.map(r => ({
          code: r.code,
          name: r.name,
          sector: r.sector,
          price_usd: r.price,
          change_pct: r.changePct,
          smart_money_pass: r.smartPass,
          smart_score: r.smartScore,
          cmf20: r.cmf20,
          ud_vol_ratio: r.udVolRatio,
          dip_buy_pass: r.dipPass,
          dip_score: r.dipScore,
          from_52w_high_pct: r.fromHighPct,
          rsi14: r.rsi14,
          bb_pos: r.bbPos,
          trade_date: r.tradeDate
        }))
      );
      break;
    }
    case 'refreshUsDetailBtn':
      loadUsDetail(state.usStock || 'NVDA', true);
      break;
    case 'backToWatchlistBtn':
      state.stockReturnPage = '';
      go('watchlist');
      break;
    case 'refreshWatchlistPricesBtn':
      refreshWatchlistPrices();
      break;
    case 'runAutoAnalysisBtn':
      runWatchlistAutoAnalysis('手動立即更新分析', false);
      break;
    case 'createFolderBtn':
      state.watchlistCreatingFolder = !state.watchlistCreatingFolder;
      render();
      if (state.watchlistCreatingFolder) $('#newFolderNameInput')?.focus();
      break;
    case 'cancelNewFolderBtn':
      state.watchlistCreatingFolder = false;
      render();
      break;
    case 'saveNewFolderBtn': {
      const name = $('#newFolderNameInput')?.value?.trim() || '';
      if (!name) {
        toast('請輸入收藏夾名稱');
        break;
      }
      state.watchlistCreatingFolder = false;
      watchlistAction('folder/create', { name }, `已建立收藏夾「${name}」`);
      break;
    }
    case 'wlStartRenameBtn':
      state.watchlistRenamingFolderId = e.target.dataset.folderId;
      render();
      $('#wlRenameInput')?.focus();
      break;
    case 'wlRenameCancelBtn':
      state.watchlistRenamingFolderId = null;
      render();
      break;
    case 'wlRenameSaveBtn': {
      const folderId = e.target.dataset.folderId;
      const name = $('#wlRenameInput')?.value?.trim() || '';
      if (!name) {
        toast('請輸入收藏夾名稱');
        break;
      }
      state.watchlistRenamingFolderId = null;
      watchlistAction('folder/rename', { folderId, name }, `已更名為「${name}」`);
      break;
    }
    case 'wlDeleteFolderBtn':
      watchlistAction('folder/delete', { folderId: e.target.dataset.folderId }, '已刪除收藏夾');
      break;
    case 'addWatchlistStockBtn': {
      const folderId = e.target.dataset.folderId;
      const code = resolveStockInput($('#addWatchlistCodeInput')?.value || '', 'ALL');
      if (!code) {
        toast('請輸入股票代號或名稱');
        break;
      }
      watchlistAction('stock/add', { folderId, code }, `已加入 ${code}`);
      break;
    }
    case 'wlMenuSaveBtn': {
      const [folderId, code] = (e.target.dataset.wlSave || '').split(':');
      const showValuation = Boolean($('#wlMenuValuationToggle')?.checked);
      const sharesRaw = $('#wlMenuSharesInput')?.value?.trim() ?? '';
      const costRaw = $('#wlMenuCostInput')?.value?.trim() ?? '';
      const payload = {
        folderId,
        code,
        showValuation,
        shares: sharesRaw === '' ? 0 : Number(sharesRaw),
        costPrice: costRaw === '' ? '' : Number(costRaw)
      };
      watchlistAction('stock/update', payload, `已更新 ${code} 價值估算設定`);
      break;
    }
    case 'wlMenuCloseBtn':
      state.watchlistMenuKey = null;
      render();
      break;
    case 'quickFavCreateBtn': {
      const code = e.target.dataset.qfavCode;
      const name = $('#quickFavNewFolderInput')?.value?.trim() || '';
      if (!name) {
        toast('請輸入新收藏夾名稱');
        break;
      }
      watchlistAction('folder/create', { name }).then(created => {
        if (created?.createdFolderId && code) {
          watchlistAction('stock/add', { folderId: created.createdFolderId, code }, `已建立「${name}」並加入 ${code}`);
        }
      });
      break;
    }
    case 'quickFavAutoBtn': {
      const code = e.target.dataset.qfavCode;
      const inAuto = (state.watchlistConfig?.autoStocks || []).includes(code);
      watchlistAction(
        'auto/toggle',
        { code, enabled: !inAuto },
        !inAuto ? `已將 ${code} 加入獨立自動分析收藏夾` : `已將 ${code} 移出自動分析`
      );
      break;
    }
    case 'generateBriefingBtn':
      generateBriefing('手動馬上製作', false);
      break;
    case 'chAddBtn':
      addChannelSubscription($('#chAddUrlInput')?.value || '');
      break;
    case 'chCheckAllBtn':
      checkChannels(null, true, false);
      break;
    case 'toggleBriefingSettings':
      state.briefingSettingsOpen = !state.briefingSettingsOpen;
      render();
      break;
    case 'toggleBriefingNews':
      state.briefingNewsOpen = !state.briefingNewsOpen;
      render();
      break;
    case 'saveBriefingSettingsBtn': {
      const wl = $('#briefingWatchlistInput')?.value ?? '';
      const topics = Array.from(document.querySelectorAll('[data-briefing-topic]'))
        .filter(el => el.checked)
        .map(el => el.dataset.briefingTopic);
      updateBriefingConfig({ watchlist: wl, topics }, '已儲存晨報設定');
      break;
    }
    case 'exportBriefingMd':
      if (state.briefingReport?.markdown) {
        download(
          `chip_briefing_${state.briefingReport.date}.md`,
          state.briefingReport.markdown,
          'text/markdown;charset=utf-8'
        );
      }
      break;
    case 'retryDetailBtn':
      loadStockDetail(state.stock, true);
      break;
    case 'inspectCache':
      inspectHistoryCache();
      break;
    case 'clearHistory':
      inspectHistoryCache(true);
      break;
    case 'refreshTDCC':
      refreshTDCC();
      break;
    case 'useDefaultWeek':
      useDefaultWeek();
      render();
      break;
    case 'editFeaturedBtn':
      state.editingFeatured = !state.editingFeatured;
      render();
      if (state.editingFeatured) {
        const inp = $('#featuredCodeInput');
        if (inp) {
          inp.focus();
          inp.select();
        }
      }
      break;
    case 'saveFeaturedBtn':
      submitFeaturedCase();
      break;
    case 'cancelFeaturedBtn':
      state.editingFeatured = false;
      render();
      break;
    case 'goStock':
      submitStockSearch();
      break;
    case 'prevPage':
      state.pageNum = Math.max(0, state.pageNum - 1);
      render();
      break;
    case 'nextPage':
      state.pageNum++;
      render();
      break;
    case 'loadSignalPrice':
      loadSignalPrice($('#signalPriceCode').value.trim());
      break;
    case 'exportScreener':
      exportScreener();
      break;
    case 'goCompare':
      go('backtest');
      break;
    case 'applySetting':
      try {
        applied = validateSettings(draft);
        if (!saveConfig()) return;
        if (!state.manualWeek) useDefaultWeek();
        toast('新方案已套用到選股');
        go('screen');
      } catch (err) {
        toast(err.message);
      }
      break;
    case 'copyApplied':
      draft = { ...applied };
      if (!saveConfig()) return;
      render();
      toast('現行方案已複製到 B 草稿');
      break;
    case 'resetDraft':
      draft = { ...DEFAULT };
      if (!saveConfig()) return;
      render();
      toast('B 草稿恢復原始 v0.4 預設，未影響現行選股');
      break;
    case 'savePreset': {
      const name = prompt('這份方案要叫什麼名字？');
      if (name && name.trim()) {
        presets.push({ name: name.trim().slice(0, 50), settings: { ...draft } });
        if (!saveConfig()) return;
        render();
        toast('研究方案已儲存');
      }
      break;
    }
    case 'exportPresets':
      download(
        'chip_screener_settings.json',
        JSON.stringify({ format: 'chip-screener-config-v1', applied, draft, presets }, null, 2),
        'application/json'
      );
      break;
    case 'exportQuality':
      csvDownload(
        'chip_data_coverage.csv',
        dates().map(day => ({
          snapshot: day,
          verified_stock_count: D.quality[day].valid,
          invalid: D.quality[day].invalid,
          observed_by: D.observed[day] || '',
          source: D.quality[day].raw_source,
          source_sha256:
            D.quality[day].sha256 || (/^[0-9a-f]{64}$/.test(D.quality[day].raw_source) ? D.quality[day].raw_source : ''),
          run: D.run
        }))
      );
      break;
    case 'export2404':
      csvDownload(
        '2404_daily.csv',
        D.daily2404.map(d => ({
          date: d[0],
          open: d[1],
          high: d[2],
          low: d[3],
          close: d[4],
          volume_shares: d[5],
          issued_shares: d[6],
          turnover: d[7],
          cash_dividend: d[8],
          strict_eod: d[9]
        }))
      );
      break;
    case 'exportWeekly':
      csvDownload(
        '2404_weekly.csv',
        dates().flatMap(day =>
          BAND_NAMES.map(b => {
            const v = vector('2404', day, b);
            return v
              ? { date: day, band: b, pct: v.pct, shares: v.shares, holders: v.owner, den: v.den, observed_by: D.observed[day] }
              : null;
          }).filter(Boolean)
        )
      );
      break;
    case 'exportCompare':
      csvDownload('chip_AB_signal_compare.csv', compareExport(comparison()));
      break;
    case 'editPeakStockBtn':
      state.editingPeakStock = !state.editingPeakStock;
      render();
      if (state.editingPeakStock) {
        const inp = $('#peakStockCode');
        if (inp) {
          inp.focus();
          inp.select();
        }
      }
      break;
    case 'cancelPeakStockBtn':
      state.editingPeakStock = false;
      render();
      break;
    case 'changePeakStockBtn':
      submitPeakStock();
      break;
    case 'calcPeak': {
      const baseDay = $('#peakBase').value;
      const compareDay = $('#peakCompare').value;
      const bars = D.dailyByCode?.[state.peakStock || '2404'] || [];
      if (!bars.some(x => x[0] === baseDay) || !bars.some(x => x[0] === compareDay)) {
        toast('請選擇實際交易日（非假日）');
        return;
      }
      state.peakBase = baseDay;
      state.peakCompare = compareDay;
      render();
      break;
    }
  }
});

document.body.addEventListener('change', async e => {
  const el = e.target;
  if (el.dataset?.setting) {
    handleSetting(el);
    return;
  }
  if (el.dataset?.peakSetting) {
    state.peakConfig[el.dataset.peakSetting] = Number(el.value);
    return;
  }
  if (el.dataset?.band) {
    const b = el.dataset.band;
    state.bands = el.checked ? [...new Set([...state.bands, b])] : state.bands.filter(x => x !== b);
    render();
    return;
  }
  if (el.dataset?.detailMa) {
    state.detailMas[Number(el.dataset.detailMa)] = el.checked;
    drawDetailKline();
    return;
  }

  switch (el.id) {
    case 'ptSlotSelect':
      if (el.value) loadPaperState(el.value, false);
      break;
    case 'ptSlotMode':
      snapshotPaperSlotDraftFromDom();
      render();
      break;
    case 'ptSlotMarket': {
      const prevMkt = state.paperSlotDraft?.market || 'TW';
      const d = snapshotPaperSlotDraftFromDom();
      if (d.modeType === 'create') {
        if (prevMkt !== 'US' && d.market === 'US' && d.initialCapital === 1000000) {
          d.initialCapital = 30000;
        } else if (prevMkt === 'US' && d.market !== 'US' && d.initialCapital === 30000) {
          d.initialCapital = 1000000;
        }
      }
      state.paperSlotDraft = d;
      render();
      break;
    }
    case 'ptOrderType':
      snapshotPaperOrderDraftFromDom();
      render();
      break;
    case 'signalMode':
    case 'signalTdcc':
    case 'signalMacd':
    case 'signalBreakout':
    case 'signalFast':
    case 'signalSlow':
    case 'signalPeriod':
    case 'signalLookback':
      updateSignalDraft();
      break;
    case 'swChannelSelect': {
      const target = el.value;
      const current = state.softwareState?.config?.channel || 'stable';
      const label = target === 'beta' ? 'Beta 測試版' : 'Stable 正式版';
      if (!confirm(`要切換到 ${label} 通道嗎？程式會檢查該通道，安裝時仍需另行確認。`)) {
        el.value = current;
        break;
      }
      saveSoftwareConfig({channel: target, confirmChannel: true}, `已切換至 ${label}`).then(saved => {
        if (!saved) {
          el.value = current;
          return;
        }
        state.updateCheckResult = null;
        render();
        checkForUpdates(false);
      });
      break;
    }
    case 'swLiveQuoteToggle':
      saveSoftwareConfig(
        { liveQuoteEnabled: el.checked },
        el.checked ? '已開啟盤中即時股價更新' : '已關閉盤中即時股價更新'
      );
      break;
    case 'swLiveQuoteInterval':
      saveSoftwareConfig(
        { liveQuoteIntervalSec: Number(el.value) },
        `已調整更新頻率為每 ${el.value} 秒`
      );
      break;
    case 'toggleAutoWatchlist':
      watchlistAction(
        'auto/config',
        { enabled: el.checked },
        el.checked ? '已開啟每日 10:00 自動分析' : '已關閉自動分析（隨時仍可手動更新）'
      );
      break;
    case 'toggleAutoBriefing':
      updateBriefingConfig(
        { enabled: el.checked },
        el.checked ? '已開啟每日 10:00 自動晨報' : '已關閉自動晨報（隨時仍可手動馬上製作）'
      );
      break;
    case 'chAutoDailyToggle':
      updateChannelsConfig(
        { autoDailyEnabled: el.checked },
        el.checked ? '已併入每日 10:00 自動檢查' : '已取消併入每日 10:00 自動檢查'
      );
      break;
    case 'chMaxMinutesSelect': {
      const mins = Number(el.value);
      if (Number.isFinite(mins) && mins >= 10 && mins <= 240) {
        updateChannelsConfig({ maxVideoMinutes: mins }, `已將影片長度上限設為 ${mins} 分鐘`);
      }
      break;
    }
    case 'briefingDateSelect':
      state.briefingSelectedDate = el.value;
      loadBriefing(el.value, false);
      break;
    case 'filterPass':
      state.filter = el.value;
      state.pageNum = 0;
      render();
      break;
    case 'sortBy':
      state.sort = el.value;
      state.pageNum = 0;
      render();
      break;
    case 'usSectorSelect':
      state.usSector = el.value;
      state.usPageNum = 0;
      render();
      break;
    case 'usSortSelect':
      state.usSort = el.value;
      state.usPageNum = 0;
      render();
      break;
    case 'asOf':
      state.manualWeek = true;
      state.asOf = el.value ? (el.value.length === 16 ? el.value + ':00' : el.value) + '+08:00' : null;
      state.pageNum = 0;
      render();
      break;
    case 'compareCode':
      state.compareCode = el.value.trim();
      render();
      break;
    case 'windowSelect':
      state.manualWeek = true;
      state.asOf = null;
      state.win = el.value;
      state.selectedDay = el.value;
      state.pageNum = 0;
      render();
      break;
    case 'daySelect':
      state.selectedDay = el.value;
      render();
      break;
    case 'importTDCC':
      if (el.files.length) await importTDCC([...el.files]);
      break;
    case 'importPresets':
      try {
        const obj = JSON.parse(await el.files[0].text());
        if (obj.format !== 'chip-screener-config-v1') throw Error('不是籌碼雷達設定格式');
        const newPresets = (obj.presets || []).map(p => ({
          name: String(p.name).slice(0, 50),
          settings: validateSettings(p.settings)
        }));
        if (!newPresets.length) throw Error('找不到有效方案');
        presets = newPresets;
        draft = validateSettings(obj.draft || newPresets[0].settings);
        if (!saveConfig()) return;
        render();
        toast('匯入成功；現行選股未變');
      } catch (err) {
        toast('匯入設定失敗：' + err.message);
      }
      break;
  }
});

document.body.addEventListener('keydown', e => {
  if (e.isComposing) return;
  if (e.key === 'Enter') {
    if (e.target.id === 'stockCode') {
      e.preventDefault();
      submitStockSearch();
    } else if (e.target.id === 'featuredCodeInput') {
      e.preventDefault();
      submitFeaturedCase();
    } else if (e.target.id === 'peakStockCode') {
      e.preventDefault();
      submitPeakStock();
    } else if (e.target.id === 'addWatchlistCodeInput') {
      e.preventDefault();
      $('#addWatchlistStockBtn')?.click();
    } else if (e.target.id === 'newFolderNameInput') {
      e.preventDefault();
      $('#saveNewFolderBtn')?.click();
    } else if (e.target.id === 'wlRenameInput') {
      e.preventDefault();
      $('#wlRenameSaveBtn')?.click();
    } else if (e.target.id === 'quickFavNewFolderInput') {
      e.preventDefault();
      $('#quickFavCreateBtn')?.click();
    } else if (e.target.id === 'usQuickSearchInput') {
      e.preventDefault();
      $('#usQuickSearchBtn')?.click();
    } else if (e.target.id === 'usDirectCodeInput') {
      e.preventDefault();
      $('#usDirectCodeBtn')?.click();
    } else if (e.target.id === 'usStockCodeInput') {
      e.preventDefault();
      $('#goUsStockBtn')?.click();
    } else if (e.target.id === 'chAddUrlInput') {
      e.preventDefault();
      $('#chAddBtn')?.click();
    } else if (e.target.id === 'ptOrderCode') {
      e.preventDefault();
      fetchPaperOrderQuote(e.target.value, true);
    } else if (e.target.dataset?.chSelect) {
      e.preventDefault();
      e.target.click();
    }
  } else if (e.key === 'Escape' && state.paperModal) {
    closePaperModal();
  } else if (e.key === 'Escape' && state.quickFavCode) {
    state.quickFavCode = null;
    render();
  } else if (e.key === 'Escape' && e.target.id === 'featuredCodeInput') {
    state.editingFeatured = false;
    render();
  } else if (e.key === 'Escape' && e.target.id === 'peakStockCode') {
    state.editingPeakStock = false;
    render();
  }
});

document.body.addEventListener('input', e => {
  if (e.target.id === 'searchCode') {
    state.query = e.target.value;
    state.pageNum = 0;
    const pos = e.target.selectionStart;
    render();
    const inp = $('#searchCode');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(pos, pos);
    }
  } else if (e.target.id === 'usSearchInput') {
    state.usQuery = e.target.value;
    state.usPageNum = 0;
    const pos = e.target.selectionStart;
    render();
    const inp = $('#usSearchInput');
    if (inp) {
      inp.focus();
      inp.setSelectionRange(pos, pos);
    }
  } else if (e.target.dataset?.stockSuggest) {
    if (e.target.id === 'ptOrderCode' && state.paperOrderDraft) {
      state.paperOrderDraft.code = e.target.value;
      schedulePaperOrderQuoteFetch(e.target.value, 300);
    }
    openStockSuggest(e.target, e.target.value);
  }
});

/* ---------- 智慧股票搜尋自動完成 ---------- */

const suggestState = { input: null, items: [], activeIdx: -1 };

function closeStockSuggest() {
  const menu = $('#stockSuggestMenu');
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = '';
  }
  suggestState.input = null;
  suggestState.items = [];
  suggestState.activeIdx = -1;
}

function positionStockSuggest(input, menu) {
  const rect = input.getBoundingClientRect();
  const minW = Math.max(rect.width, 290);
  const maxW = Math.min(360, window.innerWidth - 20);
  const width = Math.min(minW, maxW);
  const left = Math.max(10, Math.min(rect.left, window.innerWidth - width - 10));
  const spaceBelow = window.innerHeight - rect.bottom - 12;
  menu.style.width = `${width}px`;
  menu.style.left = `${left}px`;
  if (spaceBelow < 180 && rect.top > 220) {
    menu.style.top = 'auto';
    menu.style.bottom = `${window.innerHeight - rect.top + 6}px`;
  } else {
    menu.style.bottom = 'auto';
    menu.style.top = `${rect.bottom + 6}px`;
  }
}

function renderStockSuggestMenu() {
  const menu = $('#stockSuggestMenu');
  if (!menu || !suggestState.input) return;
  if (!suggestState.items.length) {
    menu.innerHTML = '<div class="suggest-head"><span>找不到相符的股票代號或名稱</span></div>';
    positionStockSuggest(suggestState.input, menu);
    menu.hidden = false;
    return;
  }
  const hasQuery = Boolean((suggestState.input.value || '').trim());
  const headerLabel = hasQuery ? '可能要查詢的股票（↑↓ 選擇 · Enter / 點擊查詢）' : '常用與收藏推薦（可直接輸入代號或股名）';
  menu.innerHTML =
    `<div class="suggest-head"><span>${headerLabel}</span></div>` +
    suggestState.items
      .map(
        (it, idx) =>
          `<button type="button" class="suggest-item ${idx === suggestState.activeIdx ? 'active' : ''}" data-suggest-idx="${idx}" role="option">` +
          `<span class="suggest-left"><span class="suggest-code">${esc(it.code)}</span><span class="suggest-name">${esc(it.name)}</span></span>` +
          `<span class="suggest-tag">${it.inFav ? '★ ' : ''}${esc(it.tag)}</span>` +
          '</button>'
      )
      .join('');
  positionStockSuggest(suggestState.input, menu);
  menu.hidden = false;
}

function openStockSuggest(input, queryOverride = null) {
  if (!input || typeof getStockSuggestCandidates !== 'function') return;
  const scope = input.dataset.stockSuggest || 'ALL';
  const query = queryOverride !== null ? queryOverride : input.value;
  suggestState.input = input;
  suggestState.items = getStockSuggestCandidates(query, scope, 8);
  suggestState.activeIdx = query.trim() && suggestState.items.length ? 0 : -1;
  renderStockSuggestMenu();
}

function pickStockSuggest(idx) {
  const input = suggestState.input;
  const item = suggestState.items[idx];
  if (!input || !item) return;
  input.value = item.code;
  const submitBtnId = input.dataset.suggestSubmit;
  closeStockSuggest();
  if (input.id === 'ptOrderCode' && state.paperOrderDraft) {
    snapshotPaperOrderDraftFromDom();
    state.paperOrderDraft.code = item.code;
    render();
    $('#ptOrderShares')?.focus();
    fetchPaperOrderQuote(item.code, true);
    return;
  }
  if (submitBtnId) {
    document.getElementById(submitBtnId)?.click();
  }
}

document.body.addEventListener('focusin', e => {
  const inp = e.target;
  if (!inp?.dataset?.stockSuggest) return;
  const raw = (inp.value || '').trim().toUpperCase();
  const curCode =
    inp.id === 'stockCode'
      ? state.stock
      : inp.id === 'usStockCodeInput'
        ? state.usStock
        : inp.id === 'peakStockCode'
          ? state.peakStock
          : inp.id === 'featuredCodeInput'
            ? state.featuredCode
            : '';
  // 點進已有預設代號的搜尋框時，先顯示推薦／收藏清單；一旦開始輸入則即時比對
  openStockSuggest(inp, raw && raw === curCode ? '' : inp.value);
});

document.body.addEventListener('focusout', e => {
  if (e.target?.id === 'ptOrderCode' && state.paperModal === 'order') {
    const val = (e.target.value || '').trim();
    if (!val) {
      clearPaperOrderQuoteState(true);
    } else {
      const resolved = resolvePaperOrderQuoteCode(val, state.paperSlot, true);
      if (resolved && (resolved !== state.paperOrderQuoteCode || !state.liveQuotesByCode?.[resolved])) {
        fetchPaperOrderQuote(resolved, true);
      }
    }
  }
  setTimeout(() => {
    const active = document.activeElement;
    if (!active?.dataset?.stockSuggest && !active?.closest?.('#stockSuggestMenu')) {
      closeStockSuggest();
    }
  }, 130);
});

document.addEventListener('mousedown', e => {
  const opt = e.target.closest?.('.suggest-item[data-suggest-idx]');
  if (opt) {
    e.preventDefault();
    pickStockSuggest(Number(opt.dataset.suggestIdx));
  }
});

document.body.addEventListener(
  'keydown',
  e => {
    if (e.target.id === 'brandMarketToggle' && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      setMarket(state.market === 'TW' ? 'US' : 'TW');
      return;
    }
    if (!e.target.dataset?.stockSuggest || e.isComposing) return;
    const menu = $('#stockSuggestMenu');
    const isOpen = menu && !menu.hidden && suggestState.items.length > 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        openStockSuggest(e.target, e.target.value);
      } else {
        suggestState.activeIdx = (suggestState.activeIdx + 1) % suggestState.items.length;
        renderStockSuggestMenu();
        menu.querySelector('.suggest-item.active')?.scrollIntoView({ block: 'nearest' });
      }
    } else if (e.key === 'ArrowUp' && isOpen) {
      e.preventDefault();
      suggestState.activeIdx =
        suggestState.activeIdx <= 0 ? suggestState.items.length - 1 : suggestState.activeIdx - 1;
      renderStockSuggestMenu();
      menu.querySelector('.suggest-item.active')?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Escape' && menu && !menu.hidden) {
      e.preventDefault();
      e.stopPropagation();
      closeStockSuggest();
    } else if (e.key === 'Enter' && isOpen && suggestState.activeIdx >= 0) {
      e.preventDefault();
      e.stopPropagation();
      pickStockSuggest(suggestState.activeIdx);
    } else if (e.key === 'Enter') {
      closeStockSuggest();
    }
  },
  true
);

window.addEventListener('scroll', () => {
  if (suggestState.input) {
    const menu = $('#stockSuggestMenu');
    if (menu && !menu.hidden) positionStockSuggest(suggestState.input, menu);
  }
}, true);

window.addEventListener('resize', () => {
  if (suggestState.input) {
    const menu = $('#stockSuggestMenu');
    if (menu && !menu.hidden) positionStockSuggest(suggestState.input, menu);
  }
  if ((state.page === 'stock' && state.stockMode === 'detail') || state.page === 'us_stock') {
    drawDetailKline();
  }
});

window.addEventListener('error', e => {
  console.error(e.error);
  toast('畫面操作發生錯誤：' + e.message);
});

/* ---------- 啟動初始化 ---------- */

useDefaultWeek();
render();

if (hasOfficialFeedBackend) {
  setInterval(() => { refreshTDCC(); }, 6 * 60 * 60 * 1000);
}

if (hasHttpFeed) {
  const client = crypto.randomUUID();
  const leaseBody = active => JSON.stringify({client, active});
  const renewLease = () => fetch('/api/window/lease', {
    method: 'POST', body: leaseBody(true), keepalive: true
  }).catch(() => {});
  renewLease();
  const leaseTimer = setInterval(renewLease, 30000);
  window.addEventListener('pagehide', () => {
    clearInterval(leaseTimer);
    navigator.sendBeacon('/api/window/lease', leaseBody(false));
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) location.reload();
  });

  if (state.page === 'us_home') setTimeout(() => loadUsOverview(false), 120);
  setTimeout(() => loadSoftwareState(true), 900);
  setTimeout(() => checkForUpdates(true), 2200);
  setInterval(() => {
    if (state.page === 'briefing' && state.briefingTab !== 'channels' && !document.hidden) loadBriefing('', true);
  }, 15 * 60 * 1000);
  setInterval(() => {
    if (state.page === 'watchlist' && !document.hidden) loadWatchlist(true);
  }, 15 * 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (liveQuoteTimer) {
        clearInterval(liveQuoteTimer);
        liveQuoteTimer = null;
      }
      updateLiveQuotePill();
    } else {
      scheduleLiveQuoteTimer(true);
    }
  });
}

document.body.addEventListener('change', e => {
  if (e.target.id === 'overlayK') {
    state.overlayK = e.target.checked;
    render();
    if (state.overlayK) loadOverlayHistory(state.stock);
  }
});
