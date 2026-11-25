/**
 * SPA 路由、主渲染器、事件委派總線與啟動初始化
 */

const PAGES = {
  home,
  briefing: briefingPage,
  watchlist: watchlistPage,
  us_home: usHomePage,
  us_screen: usScreenPage,
  us_stock: usStockPage,
  screen,
  stock,
  backtest,
  peak,
  settings: settingsPage,
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
        : NAV.filter(x => ['home', 'watchlist', 'screen', 'stock', 'settings'].includes(x[0]));
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
    else if (!['briefing', 'watchlist', 'us_home', 'us_screen', 'us_stock'].includes(nextPage)) nextPage = 'us_home';
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
  if (page === 'stock' && state.stockMode === 'detail') {
    loadStockDetail(state.stock);
  }
  if (page === 'briefing') {
    loadBriefing(state.briefingSelectedDate || '');
  }
  if (page === 'watchlist') {
    loadWatchlist(false);
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
    if (successMsg) toast(successMsg);
    if (state.page === 'briefing') render();
  } catch (e) {
    toast('更新晨報設定失敗：' + e.message);
  }
}

async function loadStockDetail(code, force = false) {
  if (!force && state.stockDetailByCode?.[code]?.bars?.length) {
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
    state.stockDetailByCode[code] = payload;
  } catch (e) {
    state.stockDetailError = e.message;
  } finally {
    state.stockDetailLoading = false;
    if (state.page === 'stock' && state.stock === code) {
      render();
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
      const keyVal = $('#briefingGeminiKeyInput')?.value?.trim() || '';
      const topics = Array.from(document.querySelectorAll('[data-briefing-topic]'))
        .filter(el => el.checked)
        .map(el => el.dataset.briefingTopic);
      const body = { watchlist: wl, topics };
      if (keyVal) body.geminiApiKey = keyVal;
      updateBriefingConfig(body, '已儲存晨報設定');
      break;
    }
    case 'clearGeminiKeyBtn':
      updateBriefingConfig({ clearGeminiKey: true }, '已清除本機 Gemini API Key');
      break;
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
    }
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

document.body.addEventListener('focusout', () => {
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
  setTimeout(refreshTDCC, 1500);
  setInterval(refreshTDCC, 6 * 60 * 60 * 1000);
}

if (hasHttpFeed) {
  if (state.page === 'us_home') setTimeout(() => loadUsOverview(false), 120);
  setTimeout(() => loadBriefing('', true), 2600);
  setTimeout(() => loadWatchlist(true), 3200);
  setInterval(() => loadBriefing('', true), 15 * 60 * 1000);
  setInterval(() => loadWatchlist(true), 15 * 60 * 1000);
}
