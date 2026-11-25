/**
 * SPA 路由、主渲染器、事件委派總線與啟動初始化
 */

const PAGES = {
  home,
  briefing: briefingPage,
  screen,
  stock,
  backtest,
  peak,
  settings: settingsPage,
  data: dataPage
};

function populateNav() {
  const navEl = $('#nav');
  const mobileEl = $('#mobilebar');
  if (navEl) {
    navEl.innerHTML = NAV.map(
      ([id, ic, name]) =>
        `<button data-nav="${id}" class="${state.page === id ? 'active' : ''}"><span class="ico">${ic}</span>${name}</button>`
    ).join('');
  }
  if (mobileEl) {
    mobileEl.innerHTML = NAV.filter(x => ['home', 'screen', 'stock', 'backtest', 'settings'].includes(x[0]))
      .map(
        ([id, ic, name]) =>
          `<button data-nav="${id}" class="${state.page === id ? 'active' : ''}"><span>${ic}</span>${name.replace('全市場', '').replace('研究', '')}</button>`
      )
      .join('');
  }
}

function go(page) {
  state.page = page;
  state.pageNum = 0;
  render();
  if (page === 'stock' && state.stockMode === 'detail') {
    loadStockDetail(state.stock);
  }
  if (page === 'briefing') {
    loadBriefing(state.briefingSelectedDate || '');
  }
  scrollTo({ top: 0, behavior: 'instant' });
}

function selectStock(code) {
  state.stock = code;
  state.page = 'stock';
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

function render() {
  populateNav();
  const crumb = $('#crumb');
  if (crumb) {
    const baseName = state.page === 'stock' && state.stockMode === 'detail' ? '個股詳情' : NAV.find(x => x[0] === state.page)?.[2];
    crumb.textContent = baseName || '研究';
  }

  const topDate = $('#topDateTag');
  if (topDate) topDate.textContent = '集保資料截至 ' + (latestVerifiedDay() || '—');

  const notice = ['home', 'screen', 'stock', 'backtest'].includes(state.page) ? weekSelectionNotice() : '';
  const feed = ['home', 'data'].includes(state.page) ? feedPanel() : '';
  const strip = notice || feed ? `<div class="status-strip">${notice}${feed}</div>` : '';

  $('#page').innerHTML = strip + PAGES[state.page]();
  if (state.page === 'stock' && state.stockMode === 'detail') {
    drawDetailKline();
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
  const code = input.value.trim().toUpperCase();
  if (!VALID_SYMBOL_RE.test(code)) {
    toast('請輸入四碼股票代號或 ETF 代號（如 2404、0050）');
    return;
  }
  selectStock(code);
}

function submitFeaturedCase() {
  const input = $('#featuredCodeInput');
  if (!input) return;
  const code = input.value.trim().toUpperCase();
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
  const code = input.value.trim().toUpperCase();
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
  const nav = e.target.closest?.('[data-nav]');
  if (nav) {
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
    }
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
  }
});

window.addEventListener('resize', () => {
  if (state.page === 'stock' && state.stockMode === 'detail') {
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
  setTimeout(() => loadBriefing('', true), 2600);
  setInterval(() => loadBriefing('', true), 15 * 60 * 1000);
}
