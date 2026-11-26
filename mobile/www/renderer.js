// === core/constants.js ===
'use strict';

/**
 * 全域常數與系統設定預設值
 */

const D = INITIAL_DATA;

const BAND_NAMES = ['200', '400', '600', '1000'];

const COLORS = {
  '200': '#60a5fa',
  '400': '#34d399',
  '600': '#f59e0b',
  '1000': '#a78bfa'
};

const NAV = [
  ['home', '▦', '研究總覽'],
  ['briefing', '☀', '每日晨報'],
  ['watchlist', '★', '股票收藏夾'],
  ['screen', '◎', '全市場篩選'],
  ['stock', '⌁', '個股研究'],
  ['backtest', '◷', '回測與比較'],
  ['peak', '▥', '底峰研究'],
  ['settings', '⚙', '策略設定'],
  ['data', '≡', '資料與驗收']
];

const US_NAV = [
  ['us_home', '▦', '美股總覽'],
  ['briefing', '☀', '每日晨報'],
  ['watchlist', '★', '股票收藏夾'],
  ['us_screen', '◎', '美股全市場篩選'],
  ['us_stock', '⌁', '美股個股詳情']
];

const US_SUGGEST_LIST = [
  ['AAPL', 'Apple 蘋果', '科技七巨頭'],
  ['MSFT', 'Microsoft 微軟', '科技七巨頭'],
  ['NVDA', 'NVIDIA 輝達', '科技七巨頭'],
  ['GOOGL', 'Alphabet 谷歌', '科技七巨頭'],
  ['AMZN', 'Amazon 亞馬遜', '科技七巨頭'],
  ['META', 'Meta 臉書', '科技七巨頭'],
  ['TSLA', 'Tesla 特斯拉', '科技七巨頭'],
  ['TSM', 'TSMC 台積電 ADR', 'AI / 半導體'],
  ['AVGO', 'Broadcom 博通', 'AI / 半導體'],
  ['AMD', 'AMD 超微', 'AI / 半導體'],
  ['INTC', 'Intel 英特爾', 'AI / 半導體'],
  ['MU', 'Micron 美光', 'AI / 半導體'],
  ['ASML', 'ASML 艾司摩爾', 'AI / 半導體'],
  ['QCOM', 'Qualcomm 高通', 'AI / 半導體'],
  ['ARM', 'Arm 安謀', 'AI / 半導體'],
  ['ORCL', 'Oracle 甲骨文', 'AI / 半導體'],
  ['PLTR', 'Palantir', 'AI / 半導體'],
  ['SMCI', 'Super Micro 美超微', 'AI / 半導體'],
  ['SPY', 'SPDR S&P 500 ETF', '主流 ETF'],
  ['QQQ', 'Invesco Nasdaq 100', '主流 ETF'],
  ['SOXX', 'iShares 半導體 ETF', '主流 ETF'],
  ['VOO', 'Vanguard S&P 500', '主流 ETF'],
  ['DIA', 'SPDR 道瓊 ETF', '主流 ETF'],
  ['IWM', 'iShares 羅素 2000', '主流 ETF'],
  ['TLT', '20年期美債 ETF', '主流 ETF'],
  ['GLD', 'SPDR 黃金 ETF', '主流 ETF'],
  ['BRK-B', '波克夏海瑟威 B', '金融／消費／醫療'],
  ['JPM', 'JPMorgan 摩根大通', '金融／消費／醫療'],
  ['V', 'Visa 威士卡', '金融／消費／醫療'],
  ['COST', 'Costco 好市多', '金融／消費／醫療'],
  ['NFLX', 'Netflix 網飛', '金融／消費／醫療'],
  ['LLY', 'Eli Lilly 禮來', '金融／消費／醫療']
];

const DEFAULT = {
  band: '400',
  weeks: 2,
  minPp: 0.2,
  weeklyMin: 0,
  needShares: true,
  needPeak: false,
  needPrice: false,
  profitDays: 20,
  feeBuy: 0.001425,
  feeSell: 0.004425,
  slip: 0.001,
  warmup: 500,
  grid: 1,
  retention: 75,
  dropPp: 5,
  lowPosition: 40,
  peakMin: 15,
  rangeDays: 60
};

const dates = () => Object.keys(D.series).sort();

// === core/format.js ===
/**
 * 格式化、安全轉義與基礎日期／級距工具函式
 */

const $ = sel => document.querySelector(sel);

const esc = x =>
  String(x ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const fmt = (v, dp = 0) =>
  typeof v === 'number' && isFinite(v)
    ? v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : '—';

const pp = (v, n = 3) =>
  typeof v === 'number' && isFinite(v) ? `${v >= 0 ? '+' : ''}${fmt(v, n)}` : '—';

const sign = v => (v > 0 ? 'green' : v < 0 ? 'red' : 'muted');

const dt = ds => new Date(ds + 'T12:00:00+08:00');

const monday = ds => {
  const d = dt(ds);
  const w = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - w);
  return Math.floor(d.getTime() / 86400000);
};

function sumLevels(row, lo, hi, col) {
  let total = 0;
  for (let k = lo; k <= hi; k++) total += row[k]?.[col] || 0;
  return total;
}

// === core/settings.js ===
/**
 * 策略參數檢核（前後端一致的範圍與型別驗證）
 */

const NUMERIC_SETTING_KEYS = [
  'weeks', 'minPp', 'weeklyMin', 'profitDays', 'feeBuy', 'feeSell',
  'slip', 'warmup', 'grid', 'retention', 'dropPp', 'lowPosition', 'peakMin', 'rangeDays'
];

function validateSettings(input) {
  const out = { ...DEFAULT, ...input };

  for (const key of NUMERIC_SETTING_KEYS) {
    out[key] = Number(out[key]);
    if (!Number.isFinite(out[key])) throw Error('無效的參數：' + key);
  }

  if (!BAND_NAMES.includes(out.band)) throw Error('無效大戶級距');
  if (!Number.isInteger(out.weeks) || out.weeks < 1 || out.weeks > 4) throw Error('連續週數需為 1–4');
  if (out.minPp < 0 || out.minPp > 20 || out.weeklyMin < 0 || out.weeklyMin > 10) throw Error('級距門檻超出範圍');
  if (![150, 200, 500].includes(out.warmup)) throw Error('暖機期僅支援 150／200／500');
  if (![0.75, 1, 1.25].includes(out.grid)) throw Error('網格僅支援 0.75／1／1.25%');

  for (const k of ['feeBuy', 'feeSell', 'slip']) {
    if (out[k] < 0 || out[k] > 0.03) throw Error('費率超出範圍');
  }

  if (
    out.retention < 0 || out.retention > 100 ||
    out.dropPp < 0 || out.dropPp > 30 ||
    out.peakMin < 0 || out.peakMin > 60 ||
    out.lowPosition < 5 || out.lowPosition > 80 ||
    out.rangeDays < 20 || out.rangeDays > 250
  ) {
    throw Error('成本分布參數超出範圍');
  }

  for (const k of ['needShares', 'needPeak', 'needPrice']) {
    out[k] = Boolean(out[k]);
  }
  return out;
}

// === core/storage-adapter.js ===
/**
 * 本機儲存配接器與應用狀態初始化
 * 在 Electron 中透過 window.desktopStore 寫入三副本原子儲存；獨立瀏覽器預覽時優雅降級至 localStorage。
 */

const storageNotes = [];
const hasDesktopStore = typeof window !== 'undefined' && !!window.desktopStore;

function loadLocal(kind) {
  if (!hasDesktopStore) {
    return { ok: true, value: null, slot: null, damaged: false, version: 'browser' };
  }
  const result = window.desktopStore.read(kind);
  if (!result.ok) {
    storageNotes.push('無法讀取本機檔案：' + result.error);
  }
  if (result.slot && result.slot !== 'current') {
    storageNotes.push((kind === 'settings' ? '策略設定' : '資料快照') + '已從備份復原');
  } else if (!result.slot && result.damaged) {
    storageNotes.push('本機檔案損毀，已載入預設內容');
  }
  return result;
}

const configFile = loadLocal('settings');
const snapshotFile = loadLocal('snapshot');
let savedConfig;
let savedWeeks = snapshotFile.value || {};

function legacy(key, fallback) {
  try {
    const text = localStorage.getItem('chipscr_' + key);
    return text === null ? fallback : JSON.parse(text);
  } catch {
    return fallback;
  }
}

function getConfig() {
  const appliedCfg = configFile.value?.applied ?? legacy('applied', {});
  const draftCfg = configFile.value?.draft ?? legacy('draft', appliedCfg);
  const presetList = configFile.value?.presets ?? legacy('presets', [{ name: '原始 v0.4', settings: DEFAULT }]);
  return {
    format: 'chip-screener-config-v1',
    applied: validateSettings(appliedCfg),
    draft: validateSettings(draftCfg),
    presets: presetList.map(p => ({
      name: String(p.name).slice(0, 50),
      settings: validateSettings(p.settings)
    }))
  };
}

try {
  savedConfig = getConfig();
} catch {
  storageNotes.push('舊策略格式無效，已載入原始策略');
  savedConfig = {
    format: 'chip-screener-config-v1',
    applied: DEFAULT,
    draft: DEFAULT,
    presets: [{ name: '原始 v0.4', settings: DEFAULT }]
  };
}

let { applied, draft, presets } = structuredClone(savedConfig);

function persist(kind, value) {
  if (!hasDesktopStore) {
    if (kind === 'settings') {
      try {
        localStorage.setItem('chipscr_applied', JSON.stringify(value.applied));
        localStorage.setItem('chipscr_draft', JSON.stringify(value.draft));
        localStorage.setItem('chipscr_presets', JSON.stringify(value.presets));
      } catch {
        // 忽略獨立瀏覽器模式下的 storage 限制
      }
    }
    return;
  }
  const result = window.desktopStore.save(kind, value);
  if (!result.ok) throw Error('本機寫入失敗，保留上次成功資料：' + result.error);
  if (!result.redundant) storageNotes.push('本次已保存，備份寫入失敗');
}

function saveConfig() {
  const next = { format: 'chip-screener-config-v1', applied, draft, presets };
  try {
    persist('settings', next);
    savedConfig = structuredClone(next);
    return true;
  } catch (e) {
    ({ applied, draft, presets } = structuredClone(savedConfig));
    render();
    toast(e.message);
    return false;
  }
}

// 首次遷移 B02 LocalStorage 設定至桌面本機檔案
if (
  hasDesktopStore &&
  !configFile.value &&
  configFile.ok &&
  !configFile.damaged &&
  ['applied', 'draft', 'presets'].some(key => legacy(key, null) !== null)
) {
  try {
    persist('settings', savedConfig);
  } catch (e) {
    storageNotes.push(e.message);
  }
}

function applyWeek(day, week) {
  D.series[day] = { ...(week.extraRows || {}), ...week.rows };
  D.observed[day] = week.observed;
  D.quality[day] = week.quality;
  if (!D.dates.includes(day)) D.dates.push(day);
  D.dates.sort();
  for (const code of Object.keys(D.series[day])) {
    if (!D.stocks[code]) D.stocks[code] = [/^00/.test(code) ? 'ETF' : '名稱待證', '?'];
  }
}

for (const [day, week] of Object.entries(savedWeeks)) {
  // 內建凍結基線的固定日期優先於本機手動覆寫
  if (!Object.hasOwn(D.series, day)) applyWeek(day, week);
}

function saveWeek(day, rows, invalid, filename) {
  const week = {
    rows,
    observed: null,
    quality: {
      valid: Object.keys(rows).length,
      invalid,
      raw_source: '手動匯入 ' + filename
    }
  };
  const next = { ...savedWeeks, [day]: week };
  persist('snapshot', next);
  savedWeeks = next;
  applyWeek(day, week);
}

function storageSummary() {
  const days = Object.keys(savedWeeks).sort();
  return (
    '桌面版 ' + (snapshotFile.version || configFile.version || '未知') +
    '｜本機快照 ' + days.length + ' 期' +
    (days.length ? '｜' + days.at(-1) + '｜' + savedWeeks[days.at(-1)].quality.raw_source : '｜使用內建資料') +
    (storageNotes.length ? '｜' + [...new Set(storageNotes)].join('；') : '')
  );
}

function loadFeaturedCode() {
  const saved = legacy('featured_case', '2404');
  return typeof saved === 'string' && /^(?:\d{4}|00\d{2,4}[A-Z]?)$/i.test(saved)
    ? saved.toUpperCase()
    : '2404';
}

function saveFeaturedCode(code) {
  try {
    localStorage.setItem('chipscr_featured_case', JSON.stringify(code));
  } catch {
    // 忽略儲存受限環境
  }
}

function loadMarketMode() {
  try {
    const saved = localStorage.getItem('chipscr_market_mode');
    return saved === 'US' ? 'US' : 'TW';
  } catch {
    return 'TW';
  }
}

function saveMarketMode(mode) {
  try {
    localStorage.setItem('chipscr_market_mode', mode === 'US' ? 'US' : 'TW');
  } catch {
    // 忽略儲存受限環境
  }
}

D.dailyByCode = D.dailyByCode || { '2404': D.daily2404 };

let state = {
  market: loadMarketMode(),
  page: loadMarketMode() === 'US' ? 'us_home' : 'home',
  stock: '2404',
  stockMode: 'study',
  stockDetailByCode: {},
  stockDetailLoading: false,
  stockDetailError: '',
  detailTf: 'D',
  detailRange: 60,
  detailMas: { 5: true, 10: true, 20: true, 60: true, 200: true },
  detailChipTab: 'inst',
  detailHoverIdx: null,
  usStock: 'NVDA',
  usDetailByCode: {},
  usDetailLoading: false,
  usDetailError: '',
  usOverview: null,
  usOverviewLoading: false,
  usOverviewError: '',
  usScreener: null,
  usScreenerLoading: false,
  usScreenerError: '',
  usScreenerMode: 'smart',
  usPageNum: 0,
  usSector: 'ALL',
  usFilter: 'all',
  usQuery: '',
  usSort: 'scoreDesc',
  usSubTab: 'macd',
  featuredCode: loadFeaturedCode(),
  editingFeatured: false,
  peakStock: '2404',
  editingPeakStock: false,
  peakLoading: false,
  peakError: '',
  briefingConfig: {
    enabled: true,
    time: '10:00',
    watchlist: ['2330', '0050', 'TSM', 'NVDA'],
    topics: ['ai_semi', 'macro_rate', 'etf_fin', 'us_tech', 'tw_trad'],
    availableTopics: [
      { id: 'ai_semi', label: 'AI / 半導體' },
      { id: 'macro_rate', label: '總經 / 利率 / 匯率' },
      { id: 'etf_fin', label: 'ETF / 高股息 / 金融' },
      { id: 'us_tech', label: '美股科技 / 財報' },
      { id: 'tw_trad', label: '台股傳產 / 航運 / 能源' }
    ],
    hasGeminiKey: false,
    geminiKeyHint: '',
    windowsTaskStatus: '讀取中'
  },
  briefingDates: [],
  briefingSelectedDate: '',
  briefingReport: null,
  briefingBusy: false,
  briefingError: '',
  briefingSettingsOpen: false,
  briefingNewsOpen: true,
  watchlistConfig: {
    version: 1,
    autoEnabled: true,
    folders: [{ id: 'wl_default', name: '我的自選股', items: [] }],
    autoStocks: [],
    autoStockMeta: []
  },
  watchlistQuotes: {},
  watchlistQuotesUpdatedAt: '',
  watchlistAnalysis: null,
  watchlistActiveTab: 'wl_default',
  watchlistFilter: 'all',
  watchlistMenuKey: null,
  watchlistCreatingFolder: false,
  watchlistRenamingFolderId: null,
  watchlistPriceBusy: false,
  watchlistAnalysisBusy: false,
  watchlistError: '',
  quickFavCode: null,
  stockReturnPage: '',
  win: '2026-11-13',
  bands: ['400'],
  chartRange: 'all',
  dailyRange: 60,
  filter: 'all',
  query: '',
  sort: 'gain',
  pageNum: 0,
  selectedDay: '2026-11-13',
  peakBase: '2026-10-30',
  peakCompare: '2026-11-19',
  peakConfig: { ...DEFAULT },
  report: '',
  windowsReady: [],
  showList: [],
  importCount: Object.keys(savedWeeks).length
};

// === core/weekly-engine.js ===
/**
 * 統一大戶週訊號與嚴格時點評估引擎
 * 統計週與公開可用時點相互獨立；嚴格防前視、不跨缺週拼接。
 */

const tradingWeeks = new Map();
let weekEnds = [];

function rebuildWeeks() {
  tradingWeeks.clear();
  for (const day of D.sessions) {
    tradingWeeks.set(monday(day), day);
  }
  weekEnds = [...tradingWeeks.values()];
}

rebuildWeeks();

function nextOpen(known) {
  const stamp = Date.parse(known);
  const day = D.sessions.find(d => Date.parse(d + 'T09:00:00+08:00') > stamp);
  return day && stamp >= Date.parse(D.sessions[0] + 'T00:00:00+08:00') ? day + ' 09:00' : null;
}

function evidenceTime(end) {
  return end ? D.observed[end] || end + 'T13:30:00+08:00' : '';
}

function evaluation(cfg, end = state.win, asOf = state.asOf || evidenceTime(end)) {
  const index = weekEnds.indexOf(end);
  const windowDates = index < 0 ? [] : weekEnds.slice(Math.max(0, index - cfg.weeks), index + 1);
  const context = { cfg, end, asOf, dates: windowDates };

  if (!end) {
    context.issue = state.selection?.skipped[0]?.reason || '尚無已保存的統計週';
  } else if (!Number.isFinite(Date.parse(asOf))) {
    context.issue = '缺少可驗證的評估時點';
  } else if (!D.observed[end] && D.series[end]) {
    context.issue = end + ' 公布時點待證';
  } else if (index < 0 || (end === D.sessions.at(-1) && new Date(end).getUTCDay() !== 5)) {
    context.issue = end + ' 週末交易日曆待核';
  } else if (windowDates.length !== cfg.weeks + 1) {
    context.issue = '可驗證交易週不足';
  } else {
    for (const d of windowDates) {
      if (!D.series[d]) {
        context.issue = d + ' 缺週';
        break;
      }
      if (!D.observed[d] || !Number.isFinite(Date.parse(D.observed[d]))) {
        context.issue = d + ' 公布時點待證';
        break;
      }
      if (Date.parse(D.observed[d]) > Date.parse(asOf)) {
        context.issue = d + ' 截止時尚無公開證據';
        break;
      }
    }
  }

  if (!context.issue) {
    context.knownDate = windowDates.map(d => D.observed[d]).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
    context.eligible = nextOpen(context.knownDate);
  }
  return context;
}

function vector(code, date, band) {
  const row = D.series[date]?.[code];
  const i = BAND_NAMES.indexOf(band);
  return row && i >= 0
    ? { den: row[0], holders: row[1], shares: row[2 + i], owner: row[6 + i], pct: (100 * row[2 + i]) / row[0] }
    : null;
}

function weeklySignal(code, ctx) {
  const { cfg, dates: windowDates, knownDate, eligible } = ctx;
  const pending = reason => ({ status: '資料不足', reason, pass: false, insufficient: true });

  if (ctx.issue) return pending(ctx.issue);

  const values = windowDates.map(day => vector(code, day, cfg.band));
  for (const [i, v] of values.entries()) {
    const d = windowDates[i];
    if (!v) return pending(d + ' ' + (D.issues[d]?.[code] || '股票缺少完整級距'));
    if (v.den <= 0 || v.holders <= 1 || v.shares < 0 || v.shares > v.den) {
      return pending(d + ' 股數、分母或總戶數待核');
    }
    if (i && Math.abs(v.den - values[i - 1].den) * 100 > values[i - 1].den) {
      return pending(d + ' 分母異動超過 1%，公司行動待核');
    }
  }

  const delta = values.slice(1).map((v, i) => v.pct - values[i].pct);
  const deltaShares = values.slice(1).map((v, i) => v.shares - values[i].shares);
  const gain = values.at(-1).pct - values[0].pct;

  let status = '通過';
  if (delta.some(v => v <= 0)) status = '比例未連升';
  else if (cfg.needShares && deltaShares.some(v => v <= 0)) status = '比例增、股數未增';
  else if (delta.some(v => v + 1e-10 < cfg.weeklyMin)) status = '每週增幅不足';
  else if (gain + 1e-10 < cfg.minPp) status = '累計門檻不足';
  else if (cfg.needPeak || cfg.needPrice) return pending('複合條件尚無可驗證資料');

  return {
    status,
    pass: status === '通過',
    insufficient: false,
    reason: status === '通過' ? '週增持算術條件達標' : status,
    values,
    delta,
    deltaShares,
    gain,
    knownDate,
    eligible
  };
}

function scan(cfg = applied, ctx = evaluation(cfg)) {
  return D.universe.map(code => ({
    code,
    name: D.stocks[code][0],
    market: D.stocks[code][1],
    ...weeklySignal(code, ctx)
  }));
}

function tally(rows) {
  return {
    all: rows.length,
    pass: rows.filter(r => r.pass).length,
    unknown: rows.filter(r => r.insufficient).length
  };
}

function comparison() {
  const a = evaluation(applied);
  const b = evaluation(draft, a.end, a.asOf);
  return {
    a,
    b,
    rows: D.universe.map(code => ({
      code,
      name: D.stocks[code][0],
      a: weeklySignal(code, a),
      b: weeklySignal(code, b)
    }))
  };
}

// 只要至少一檔可作出明確判定（不論通過與否），即屬可評估之嚴格窗口
function defaultStrictWeek(cfg) {
  const skipped = [];
  for (const end of dates().reverse()) {
    const ctx = evaluation(cfg, end, evidenceTime(end));
    if (ctx.issue) {
      skipped.push({ end, reason: ctx.issue });
      continue;
    }
    const reasons = new Set();
    for (const code of D.universe) {
      const result = weeklySignal(code, ctx);
      if (!result.insufficient) return { end, skipped };
      reasons.add(result.reason);
    }
    skipped.push({ end, reason: [...reasons].join('；') || '股票母體為空' });
  }
  return { end: '', skipped };
}

function useDefaultWeek() {
  state.manualWeek = false;
  state.asOf = null;
  state.selection = defaultStrictWeek(applied);
  state.win = state.selection.end;
  state.selectedDay = state.win;
  state.pageNum = 0;
}

function historicalView() {
  return !!state.asOf || state.win !== dates().at(-1);
}

function archiveDays() {
  if (!historicalView()) return dates();
  const asOf = Date.parse(state.asOf || evidenceTime(state.win));
  return dates().filter(d => d <= state.win && Date.parse(D.observed[d]) <= asOf);
}

// === core/peak-model.js ===
/**
 * 低位籌碼峰探索模型（換手率衰減成本分布）
 * 公式：分布(t) = (1 - r) * 分布(t-1) + r * 當日高低價區間均勻分布
 */

function modeledDistribution(base, compare, cfg, bars = D.daily2404) {
  if (!Array.isArray(bars) || !bars.length) return { error: '尚未取得此股票的日 K 與發行股數資料' };
  const i = bars.findIndex(r => r[0] === base);
  const j = bars.findIndex(r => r[0] === compare);

  if (i < 0 || j < 0) return { error: '請選擇有日 K 的日期' };
  if (j < i) return { error: '比較日不能早於基準日' };

  const start = i - cfg.warmup + 1;
  if (start < 0) {
    return { error: `需要在基準日前有完整 ${cfg.warmup} 個交易日；目前僅有 ${i + 1} 日。` };
  }

  const step = Math.log(1 + cfg.grid / 100);
  const bins = new Map();
  let initial = 0;
  let baseline = null;
  const basePrice = bars[i][4];
  const events = [];

  function allocate(row, weight) {
    const low = row[3];
    const high = row[2];
    if (low <= 0 || high < low) throw Error('非有效價格');

    if (high === low) {
      const k = Math.floor(Math.log(low) / step);
      bins.set(k, (bins.get(k) || 0) + weight);
      return;
    }

    const first = Math.floor(Math.log(low) / step);
    const last = Math.floor(Math.log(high) / step);
    for (let k = first; k <= last; k++) {
      const boundaryL = Math.exp(k * step);
      const boundaryR = Math.exp((k + 1) * step);
      const share = Math.max(0, Math.min(high, boundaryR) - Math.max(low, boundaryL)) / (high - low);
      if (share > 0) bins.set(k, (bins.get(k) || 0) + weight * share);
    }
  }

  try {
    allocate(bars[start], 1);
    initial = 1;

    for (let k = start + 1; k <= j; k++) {
      const row = bars[k];
      const r = row[7];
      if (!(r >= 0 && r <= 1)) return { error: '存在日換手率不在 0～100% 之間，停止模型' };
      if (row[8]) events.push([row[0], row[8]]);

      for (const [n, v] of bins) {
        const decayed = v * (1 - r);
        if (decayed < 1e-13) bins.delete(n);
        else bins.set(n, decayed);
      }

      initial *= 1 - r;
      allocate(row, r);
      if (k === i) baseline = new Map(bins);
    }

    if (i === start) baseline = baseline || new Map(bins);
    if (!baseline) return { error: '基準日未完成計算' };
  } catch (e) {
    return { error: e.message };
  }

  const current = new Map(bins);
  const minKey = Math.min(...baseline.keys(), ...current.keys());
  const maxKey = Math.max(...baseline.keys(), ...current.keys());

  function findPeaks(dist) {
    const smooth = k => ((dist.get(k - 1) || 0) + (dist.get(k) || 0) + (dist.get(k + 1) || 0)) / 3;
    const peaks = [];
    for (let k = minKey + 7; k <= maxKey - 7; k++) {
      const s = smooth(k);
      if (s <= 0 || s < smooth(k - 1) || s <= smooth(k + 1)) continue;
      const left = Math.min(...[3, 4, 5, 6].map(n => smooth(k - n)));
      const right = Math.min(...[3, 4, 5, 6].map(n => smooth(k + n)));
      if (s < 1.25 * Math.max(left, right)) continue;
      const band = [-2, -1, 0, 1, 2].reduce((acc, offset) => acc + (dist.get(k + offset) || 0), 0);
      peaks.push({ k, center: Math.exp((k + 0.5) * step), s, band });
    }
    return peaks;
  }

  const basePeaks = findPeaks(baseline);
  const rangeSlice = bars.slice(Math.max(0, i - cfg.rangeDays + 1), i + 1);
  const low60 = Math.min(...rangeSlice.map(x => x[3]));
  const high60 = Math.max(...rangeSlice.map(x => x[2]));

  const candidate = basePeaks
    .filter(
      p =>
        high60 > low60 &&
        ((p.center - low60) / (high60 - low60)) * 100 <= cfg.lowPosition &&
        Math.abs(basePrice / p.center - 1) <= 0.05 &&
        p.band * 100 >= cfg.peakMin
    )
    .sort((a, b) => b.band - a.band || a.center - b.center)[0];

  let result = '無符合規格的底峰基準';
  let c = null;
  let currentBand = null;
  let retain = null;
  let drop = null;
  let compPeak = null;

  if (candidate) {
    c = candidate;
    currentBand = [-2, -1, 0, 1, 2].reduce((acc, offset) => acc + (current.get(c.k + offset) || 0), 0);
    drop = (c.band - currentBand) * 100;
    retain = (currentBand / c.band) * 100;
    const nearby = findPeaks(current)
      .filter(p => Math.abs(p.k - c.k) <= 6)
      .sort((a, b) => Math.abs(a.k - c.k) - Math.abs(b.k - c.k) || b.s - a.s);
    compPeak = nearby[0];
    result =
      compPeak && Math.abs(compPeak.k - c.k) <= 1 && drop <= cfg.dropPp && retain >= cfg.retention
        ? '候選底峰保留'
        : '底峰未通過保留';
  }

  return {
    baseline,
    current,
    minKey,
    maxKey,
    step,
    base,
    compare,
    start: bars[start][0],
    basePrice,
    c,
    currentBand,
    retain,
    drop,
    compPeak,
    result,
    initial,
    events,
    basePeaksCount: basePeaks.length,
    low60,
    high60
  };
}

// === core/data-io.js ===
/**
 * CSV 匯入驗證、CSV / JSON 檔案下載匯出工具
 */

function download(filename, contents, mime) {
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function csvDownload(filename, rows) {
  if (!rows?.length) {
    toast('沒有可匯出的資料');
    return;
  }
  const columns = Object.keys(rows[0]);
  const quote = value => {
    const s = String(value ?? '');
    return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const lines = [
    columns.map(quote).join(','),
    ...rows.map(row => columns.map(k => quote(row[k])).join(','))
  ];
  download(filename, '\ufeff' + lines.join('\r\n'), 'text/csv;charset=utf-8-sig');
}

function exportScreener() {
  const rows = state.showList;
  csvDownload(
    `chip_screener_${state.win}_${applied.band}.csv`,
    rows.map(x => ({
      code: x.code,
      name: x.name,
      market: x.market,
      window: state.win,
      as_of: state.asOf || evidenceTime(state.win),
      reason: x.reason,
      band: applied.band,
      state: x.status,
      total_pp: x.gain ?? '',
      weekly_changes: x.delta?.join('|') ?? '',
      weekly_shares: x.deltaShares?.join('|') ?? '',
      known_by: x.knownDate ?? '',
      data_version: D.run
    }))
  );
}

function compareExport(model) {
  return model.rows.map(x => ({
    code: x.code,
    name: x.name,
    window: model.a.end,
    as_of: model.a.asOf,
    A_weeks: model.a.cfg.weeks,
    A_dates: model.a.dates.join('|'),
    A_state: x.a.status,
    A_reason: x.a.reason,
    A_gain_pp: x.a.gain ?? '',
    B_weeks: model.b.cfg.weeks,
    B_dates: model.b.dates.join('|'),
    B_state: x.b.status,
    B_reason: x.b.reason,
    B_gain_pp: x.b.gain ?? '',
    data_version: D.run
  }));
}

function parseCSV(text) {
  const lines = [];
  let row = [];
  let str = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        str += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        str += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(str);
      str = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(str);
      if (row.some(x => x.trim() !== '')) lines.push(row);
      row = [];
      str = '';
    } else {
      str += ch;
    }
  }
  if (row.length || str) {
    row.push(str);
    lines.push(row);
  }
  return lines;
}

async function importTDCC(files) {
  const successes = [];
  const errors = [];

  for (const file of files) {
    try {
      const content = await file.text();
      const lines = parseCSV(content.replace(/^\uFEFF/, ''));
      const head = lines.shift();
      const indexes = {};
      for (const k of ['資料日期', '證券代號', '持股分級', '人數', '股數']) {
        indexes[k] = head.indexOf(k);
        if (indexes[k] < 0) throw Error('缺少欄位 ' + k);
      }

      let day = '';
      const byCode = {};
      for (const cols of lines) {
        const readCol = k => cols[indexes[k]]?.trim();
        const rawday = readCol('資料日期');
        if (!/^\d{8}$/.test(rawday)) continue;
        if (day && day !== rawday) throw Error('同一檔案含有不同統計日');
        day = rawday;

        const code = readCol('證券代號');
        if (!/^\d{4}$/.test(code) || code[0] === '0') continue;

        const lvl = Number(readCol('持股分級'));
        const shares = Number(readCol('股數'));
        const holders = Number(readCol('人數'));
        if (
          !Number.isInteger(lvl) || lvl < 1 || lvl > 17 ||
          !Number.isSafeInteger(shares) || !Number.isSafeInteger(holders) ||
          shares < 0 || holders < 0
        ) {
          continue;
        }

        const codeRow = (byCode[code] ||= {});
        if (codeRow[lvl]) throw Error('出現同個股同級距重複資料：' + code);
        codeRow[lvl] = [shares, holders];
      }

      if (!day) throw Error('沒有符合的資料日期');
      const ds = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
      if (D.series[ds] && (!officialWeeks[ds] || savedWeeks[ds])) {
        throw Error('日期 ' + ds + ' 已存在，不允許覆蓋原始版本');
      }

      const valid = {};
      let excluded = 0;
      const areas = [[11, 15], [12, 15], [13, 15], [15, 15]];

      for (const [code, row] of Object.entries(byCode)) {
        if (Object.keys(row).length !== 17 || !row[17]) {
          excluded++;
          continue;
        }
        const den = row[17][0];
        const holders = row[17][1];
        if (den <= 0 || sumLevels(row, 1, 15, 0) - row[16][0] !== den || sumLevels(row, 1, 15, 1) !== holders) {
          excluded++;
          continue;
        }
        valid[code] = [
          den,
          holders,
          ...areas.map(([lo, hi]) => sumLevels(row, lo, hi, 0)),
          ...areas.map(([lo, hi]) => sumLevels(row, lo, hi, 1))
        ];
      }

      if (!Object.keys(valid).length) throw Error('沒有通過股數／戶數核對的股票');

      saveWeek(ds, valid, excluded, file.name);
      if (officialWeeks[ds]) applyWeek(ds, officialWeeks[ds]);
      successes.push(`${ds}：${Object.keys(valid).length} 檔通過，${excluded} 檔排除`);
    } catch (e) {
      errors.push(`${file.name}：${e.message}`);
    }
  }

  state.importCount += successes.length;
  if (successes.length && !state.manualWeek) useDefaultWeek();
  render();
  const msg = [...successes, ...errors].join('；');
  toast(msg || '沒有匯入資料');
  const statusEl = $('#importStatus');
  if (statusEl) statusEl.textContent = msg;
}

// === components/ui-kit.js ===
/**
 * 共用 UI 元件庫（標題、指標卡、徽章、篩選表格、週期選擇器、狀態提示）
 */

const badge = (txt, type = '') => `<span class="tag ${type}">${esc(txt)}</span>`;

const ticker = code => `${esc(code)} <span class="cell-muted">${esc((D.stocks[code] || [''])[0])}</span>`;

function toast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => el.classList.remove('show'), 4200);
}

const title = (name, desc, actions = '') =>
  `<div class="pagehead"><div><p class="eyebrow">TAIWAN MARKET / RESEARCH</p><h1>${name}</h1><p class="sub">${desc}</p></div>${actions}</div>`;

const cardhead = (head, detail, act = '') =>
  `<div class="splithead"><div><h3>${head}</h3><div class="mini">${detail}</div></div>${act}</div>`;

const metric = (label, value, foot, cl = '') =>
  `<div class="card metric"><span class="label">${label}</span><div class="value ${cl}">${value}</div><span class="foot">${foot}</span></div>`;

const settingsHint = () =>
  `<span class="tag">${esc(applied.band)} 張 · ${fmt(applied.minPp, 2)} pp · ${applied.weeks} 週</span>`;

function wndSelect() {
  const asOf = state.asOf || evidenceTime(state.win);
  const saved = dates();
  const ends = [...new Set([...saved, ...weekEnds.filter(d => d >= saved[0] && d <= saved.at(-1))])].sort();

  return (
    '<label>統計截止週 <select id="windowSelect" class="select">' +
    (state.win ? '' : '<option value="" selected disabled>無可評估窗口</option>') +
    ends.map(d => `<option${d === state.win ? ' selected' : ''}>${d}</option>`).join('') +
    '</select></label>' +
    ' <label>評估時點（台北） <input id="asOf" type="datetime-local" step="1" value="' +
    esc(asOf.slice(0, 19)) +
    '"></label>'
  );
}

function renderTable(rows) {
  if (!rows.length) {
    return '<div class="empty"><b>沒有符合篩選條件的資料</b>請調整門檻或切換歷史統計窗口。</div>';
  }
  return (
    '<div class="tblwrap"><table><thead><tr>' +
    '<th>代號／名稱</th><th>市場</th><th>級距</th><th>累計增幅</th>' +
    '<th>倒數第二週</th><th>最新一週</th><th>股數變化（股）</th><th>判定</th><th style="width:52px;text-align:center">收藏</th>' +
    '</tr></thead><tbody>' +
    rows
      .map(x => {
        const inFav = typeof isStockInAnyFolder === 'function' && isStockInAnyFolder(x.code);
        return (
          `<tr class="clickable" data-stock="${esc(x.code)}">` +
          `<td><b>${ticker(x.code)}</b></td>` +
          `<td>${esc(x.market)}</td>` +
          `<td>${applied.band} 張</td>` +
          `<td class="${sign(x.gain)}">${pp(x.gain, 3)} pp</td>` +
          `<td>${pp(x.delta?.at(-2), 3)}</td>` +
          `<td>${pp(x.delta?.at(-1), 3)}</td>` +
          `<td>${x.deltaShares ? x.deltaShares.map(v => (v >= 0 ? '+' : '') + fmt(v)).join(' / ') : '—'}</td>` +
          `<td>${badge(x.status, x.pass ? 'good' : x.insufficient ? 'warn' : '')}<small>${esc(x.reason)}</small></td>` +
          `<td style="text-align:center"><button type="button" class="btn-fav ${inFav ? 'on' : ''}" data-quick-fav="${esc(x.code)}" title="${inFav ? '管理收藏夾' : '加入收藏夾'}">${inFav ? '★' : '☆'}</button></td>` +
          '</tr>'
        );
      })
      .join('') +
    '</tbody></table></div>'
  );
}

function auditNote(code, ctx) {
  if (ctx.issue) return esc(ctx.issue);
  return ctx.dates
    .map(d => {
      if (D.issues[d]?.[code]) return esc(d + ' ' + D.issues[d][code]);
      if (!D.adjustments[d] || !D.series[d]?.[code]) return esc(d + ' 級距來源待核');
      const adjusted = D.adjustments[d][code] || [0, 0];
      return esc(`${d} 第16級 ${fmt(adjusted[0])} 股，${fmt(adjusted[1])} 戶`);
    })
    .join(' · ');
}

function signalTable(code) {
  const ctx = evaluation(applied);
  return (
    '<div class="section"><h2>所選窗口的週訊號</h2></div>' +
    '<div class="card">' +
    '<div class="toolbar">' + wndSelect() + '</div>' +
    `<p class="mini" style="margin-bottom:12px">${esc(ctx.dates.join(' → ') || '無完整連續交易週')}</p>` +
    '<div class="tblwrap"><table><thead><tr>' +
    '<th>級距</th><th>每週股數變動（股）</th><th>累計增幅（pp）</th><th>判定與原因</th><th>證據後首個開盤</th>' +
    '</tr></thead><tbody>' +
    BAND_NAMES.map(b => {
      const r = weeklySignal(code, { ...ctx, cfg: { ...applied, band: b } });
      return (
        `<tr data-signal-band="${b}">` +
        `<td><b>${b} 張</b></td>` +
        `<td>${r.deltaShares?.map(n => fmt(n)).join(' / ') || '—'}</td>` +
        `<td class="${sign(r.gain)}">${pp(r.gain)}</td>` +
        `<td>${esc(r.status)} · ${esc(r.reason)}</td>` +
        `<td>${esc(r.eligible || '待核')}</td>` +
        '</tr>'
      );
    }).join('') +
    '</tbody></table></div>' +
    `<p class="footnote">${auditNote(code, ctx)}</p>` +
    '</div>'
  );
}

function weekSelectionNotice() {
  let message;
  if (state.manualWeek) {
    const ctx = evaluation(applied);
    message = '手動指定篩選週 ' + (state.win || '—') + (ctx.issue ? '｜' + ctx.issue : '');
  } else {
    const { end, skipped } = state.selection;
    message = end ? '預設嚴格篩選週 ' + end : '目前策略沒有可評估窗口';
    if (skipped.length) {
      message +=
        '｜' +
        skipped
          .map(item => (item.reason.includes(item.end) ? item.reason : item.end + ' ' + item.reason))
          .join('；');
    } else if (!end) {
      message += '｜尚無已保存的統計週';
    }
  }
  const reset = state.manualWeek
    ? ' <button class="btn ghost sm" id="useDefaultWeek">回到預設篩選週</button>'
    : '';
  return `<div class="notice" id="weekSelection"><span>${esc(message)}</span>${reset}</div>`;
}

const POPULAR_TW_SUGGEST = [
  ['2330', '台積電', 'TWSE'],
  ['0050', '元大台灣50', 'TWSE'],
  ['0056', '元大高股息', 'TWSE'],
  ['00878', '國泰永續高股息', 'TWSE'],
  ['00919', '群益台灣精選高息', 'TWSE'],
  ['2454', '聯發科', 'TWSE'],
  ['2317', '鴻海', 'TWSE'],
  ['2303', '聯電', 'TWSE'],
  ['2308', '台達電', 'TWSE'],
  ['2382', '廣達', 'TWSE'],
  ['2404', '漢唐', 'TWSE'],
  ['2603', '長榮', 'TWSE'],
  ['2881', '富邦金', 'TWSE']
];

function buildStockSuggestCatalog(scope = 'ALL') {
  const byCode = new Map();
  const put = (code, name, tag, market) => {
    const sym = String(code || '').trim().toUpperCase();
    if (!sym) return;
    if (!byCode.has(sym)) {
      byCode.set(sym, { code: sym, name: String(name || sym), tag: String(tag || market), market });
    }
  };

  if (scope === 'ALL' || scope === 'TW') {
    for (const [c, nm, mkt] of POPULAR_TW_SUGGEST) {
      const info = D.stocks?.[c];
      put(c, info?.[0] || nm, info?.[1] || mkt, 'TW');
    }
    if (D.stocks) {
      for (const [c, info] of Object.entries(D.stocks)) {
        put(c, info?.[0] || c, info?.[1] || 'TWSE', 'TW');
      }
    }
  }

  if (scope === 'ALL' || scope === 'US') {
    for (const [c, nm, sec] of US_SUGGEST_LIST || []) {
      put(c, nm, `US · ${sec}`, 'US');
    }
    for (const [c, nm, sec] of D.usUniverse || []) {
      put(c, nm, `US · ${sec}`, 'US');
    }
    for (const r of state.usScreener?.rows || []) {
      put(r.code, r.name, `US · ${r.sector || '美股'}`, 'US');
    }
    for (const [c, q] of Object.entries(state.watchlistQuotes || {})) {
      if (q?.market === 'US') put(c, q.name || c, 'US · 自選', 'US');
    }
    for (const [c, d] of Object.entries(state.usDetailByCode || {})) {
      put(c, d?.name || c, `US · ${d?.sector || '美股'}`, 'US');
    }
  }

  return [...byCode.values()];
}

function getStockSuggestCandidates(query, scope = 'ALL', limit = 8) {
  const q = String(query || '').trim().toLowerCase();
  const catalog = buildStockSuggestCatalog(scope);
  const favBonus = typeof isStockInAnyFolder === 'function';

  if (!q) {
    // 空白時優先顯示使用者收藏的標的，再補熱門台／美股
    const favItems = [];
    const seen = new Set();
    for (const f of state.watchlistConfig?.folders || []) {
      for (const it of f.items || []) {
        if (seen.has(it.code)) continue;
        seen.add(it.code);
        const isTw = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(it.code);
        if (scope === 'TW' && !isTw) continue;
        if (scope === 'US' && isTw) continue;
        favItems.push({
          code: it.code,
          name: it.name || D.stocks?.[it.code]?.[0] || it.code,
          tag: isTw ? 'TW · 已收藏' : 'US · 已收藏',
          market: isTw ? 'TW' : 'US',
          inFav: true
        });
      }
    }
    const defaults = scope === 'US'
      ? catalog.slice(0, limit)
      : scope === 'TW'
        ? catalog.slice(0, limit)
        : [
            ...POPULAR_TW_SUGGEST.slice(0, 4).map(([c, n, m]) => ({ code: c, name: D.stocks?.[c]?.[0] || n, tag: m, market: 'TW' })),
            ...(US_SUGGEST_LIST || []).slice(0, 4).map(([c, n, s]) => ({ code: c, name: n, tag: `US · ${s}`, market: 'US' }))
          ];
    const merged = [...favItems];
    for (const d of defaults) {
      if (!seen.has(d.code)) {
        seen.add(d.code);
        merged.push({ ...d, inFav: favBonus && isStockInAnyFolder(d.code) });
      }
    }
    return merged.slice(0, limit);
  }

  const scored = [];
  for (const item of catalog) {
    const codeL = item.code.toLowerCase();
    const nameL = item.name.toLowerCase();
    const tagL = item.tag.toLowerCase();
    let score = 0;
    if (codeL === q) score = 120;
    else if (codeL.startsWith(q)) score = 90;
    else if (nameL.startsWith(q)) score = 75;
    else if (codeL.includes(q)) score = 55;
    else if (nameL.includes(q)) score = 45;
    else if (tagL.includes(q)) score = 25;
    if (!score) continue;
    const inFav = favBonus && isStockInAnyFolder(item.code);
    if (inFav) score += 8;
    scored.push({ ...item, inFav, score });
  }
  scored.sort((a, b) => b.score - a.score || a.code.length - b.code.length || a.code.localeCompare(b.code));
  return scored.slice(0, limit);
}

function resolveStockInput(rawText, scope = 'ALL') {
  const txt = String(rawText || '').trim();
  if (!txt) return '';
  const upper = txt.toUpperCase();
  const isTw = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(upper);
  const isUs = /^[A-Z][A-Z0-9.-]{0,7}$/.test(upper);
  if ((scope !== 'US' && isTw) || (scope !== 'TW' && isUs)) {
    return upper;
  }
  const matches = getStockSuggestCandidates(txt, scope, 1);
  return matches[0]?.code || upper;
}

// === components/charts.js ===
/**
 * SVG 視覺化圖表模組
 * 包含：大戶持股比例折線圖 (weeklyPlot)、漢唐日 K 與成交量 (dailyPlot)、換手成本分布圖 (distPlot)
 */

function weeklyPlot(code, bands, range) {
  let ds = archiveDays();
  if (range === 'recent') ds = ds.slice(-3);

  const allValues = ds.flatMap(day =>
    bands.map(b => vector(code, day, b)?.pct).filter(x => Number.isFinite(x))
  );
  if (!allValues.length) return '<div class="empty">沒有可繪製的集保數據</div>';

  let mn = Math.min(...allValues);
  let mx = Math.max(...allValues);
  const pad = Math.max(0.4, (mx - mn) * 0.3);
  mn -= pad;
  mx += pad;

  const w = 770;
  const h = 236;
  const left = 52;
  const right = 24;
  const top = 18;
  const bottom = 36;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const X = i => left + (ds.length <= 1 ? 0.5 : i / (ds.length - 1)) * plotW;
  const Y = v => top + ((mx - v) / (mx - mn)) * plotH;

  const yGrid = [0, 0.25, 0.5, 0.75, 1]
    .map(fr => {
      const val = mn + (mx - mn) * fr;
      return (
        `<line class="gridline" x1="${left}" x2="${w - right}" y1="${Y(val)}" y2="${Y(val)}"/>` +
        `<text class="axis" x="${left - 8}" y="${Y(val) + 3.5}" text-anchor="end">${fmt(val, 1)}%</text>`
      );
    })
    .join('');

  const axes = ds
    .map((day, i) => `<text class="axis" x="${X(i)}" y="${h - 10}" text-anchor="middle">${day.slice(5)}</text>`)
    .join('');

  const lines = bands
    .map(b => {
      const chunks = [];
      let chunk = [];
      ds.forEach((day, i) => {
        const v = vector(code, day, b);
        if (chunk.length && i > 0 && (monday(day) - monday(ds[i - 1]) !== 7 || !v)) {
          chunks.push(chunk);
          chunk = [];
        }
        if (v) chunk.push([X(i), Y(v.pct)]);
        else if (chunk.length) {
          chunks.push(chunk);
          chunk = [];
        }
      });
      if (chunk.length) chunks.push(chunk);

      const path = chunks
        .map(
          pts =>
            `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${COLORS[b]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
        )
        .join('');

      const circles = ds
        .map((day, i) => {
          const v = vector(code, day, b);
          if (!v) return '';
          return (
            `<circle cx="${X(i)}" cy="${Y(v.pct)}" r="${b === bands[0] ? '4.5' : '3.5'}" fill="${COLORS[b]}" stroke="#0b0e14" stroke-width="1.8">` +
            `<title>${code} ${day} ${b} 張：${fmt(v.pct, 6)}%／${fmt(v.shares)} 股／${fmt(v.owner)} 戶</title></circle>`
          );
        })
        .join('');

      return path + circles;
    })
    .join('');

  return (
    `<svg role="img" aria-label="${code} 集保大戶持股比例圖，缺週折線中斷" viewBox="0 0 ${w} ${h}" class="plot">` +
    `<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" rx="8" class="plot-bg"/>` +
    `${yGrid}${lines}${axes}</svg>`
  );
}

function dailyPlot() {
  const bars = D.daily2404.slice(-state.dailyRange);
  const width = 775;
  const height = 280;
  const marginLeft = 54;
  const marginR = 14;
  const top = 12;
  const priceH = 194;
  const volTop = 216;
  const volH = 36;
  const plotW = width - marginLeft - marginR;

  const lowest = Math.min(...bars.map(b => b[3]));
  const highest = Math.max(...bars.map(b => b[2]));
  const pad = (highest - lowest) * 0.1 || 10;

  const Y = p => top + ((highest + pad - p) / (highest - lowest + 2 * pad)) * priceH;
  const X = i => marginLeft + (i * plotW) / bars.length + plotW / (2 * bars.length);
  const barW = Math.max(1.2, Math.min(7, (plotW / bars.length) * 0.62));
  const vmax = Math.max(...bars.map(b => b[5]));

  const marks = bars
    .map((b, i) => {
      const x = X(i);
      const up = b[4] >= b[1];
      const color = up ? '#34d399' : '#f87171';
      return (
        `<line x1="${x}" x2="${x}" y1="${Y(b[2])}" y2="${Y(b[3])}" stroke="${color}" stroke-width="1.1"/>` +
        `<rect x="${x - barW / 2}" y="${Math.min(Y(b[1]), Y(b[4]))}" width="${barW}" height="${Math.max(1, Math.abs(Y(b[1]) - Y(b[4])))}" fill="${color}" rx="0.6"/>` +
        `<rect x="${x - barW / 2}" y="${volTop + volH * (1 - b[5] / vmax)}" width="${barW}" height="${(volH * b[5]) / vmax}" fill="${color}" opacity=".45">` +
        `<title>${b[0]} 開 ${b[1]} 高 ${b[2]} 低 ${b[3]} 收 ${b[4]} 量 ${fmt(b[5])} 股</title></rect>`
      );
    })
    .join('');

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(a => {
      const val = lowest - pad + (highest - lowest + 2 * pad) * a;
      return (
        `<line class="gridline" x1="${marginLeft}" x2="${width - marginR}" y1="${Y(val)}" y2="${Y(val)}"/>` +
        `<text class="axis" x="${marginLeft - 8}" y="${Y(val) + 3.5}" text-anchor="end">${fmt(val, 0)}</text>`
      );
    })
    .join('');

  return (
    `<svg class="plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="漢唐日線開高低收與成交量">` +
    `<rect class="plot-bg" x="${marginLeft}" y="${top}" width="${plotW}" height="${priceH + volH + 10}" rx="8"/>` +
    `${grid}${marks}` +
    `<text class="axis" x="${marginLeft}" y="${height - 6}">${bars[0]?.[0]}</text>` +
    `<text class="axis" text-anchor="end" x="${width - marginR}" y="${height - 6}">${bars.at(-1)?.[0]}</text>` +
    '</svg>' +
    '<div class="statbar">' +
    `<div><span class="mini">最新收盤（資料日）</span><strong>${fmt(bars.at(-1)?.[4], 2)}</strong></div>` +
    `<div><span class="mini">最後交易日</span><strong style="font-size:14px">${bars.at(-1)?.[0]}</strong></div>` +
    `<div><span class="mini">最後成交量</span><strong>${fmt(bars.at(-1)?.[5])}</strong></div>` +
    '</div>'
  );
}

function distPlot(res) {
  const { baseline, current, minKey, maxKey, step, c } = res;
  const list = [];
  for (let k = minKey; k <= maxKey; k++) {
    if ((baseline.get(k) || 0) + (current.get(k) || 0) > 0.00007) list.push(k);
  }
  if (!list.length) return '';

  const xMin = Math.min(...list);
  const xMax = Math.max(...list);
  const stride = Math.max(1, Math.ceil((xMax - xMin) / 140));
  const arr = [];

  for (let a = xMin; a <= xMax; a += stride) {
    let b = 0;
    let n = 0;
    for (let k = a; k < Math.min(a + stride, xMax + 1); k++) {
      b += baseline.get(k) || 0;
      n += current.get(k) || 0;
    }
    arr.push([a, b, n]);
  }

  const max = Math.max(...arr.flatMap(x => [x[1], x[2]]), 0.00001);
  const w = 730;
  const h = 236;
  const l = 48;
  const r = 16;
  const top = 12;
  const plotH = 178;
  const pw = w - l - r;

  const Y = x => top + ((max - x) / max) * plotH;
  const X = i => l + (i / Math.max(1, arr.length - 1)) * pw;
  const path = j => arr.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + Y(p[j]).toFixed(2)).join(' ');
  const kAt = i => Math.exp((arr[Math.round(i)]?.[0] || 0) * step);

  let mark = '';
  if (c) {
    const idx = arr.findIndex(x => x[0] <= c.k && x[0] + stride > c.k);
    if (idx >= 0) {
      mark = `<line x1="${X(idx)}" x2="${X(idx)}" y1="${top}" y2="${top + plotH}" stroke="#f59e0b" stroke-dasharray="4 3" stroke-width="1.5"/>`;
    }
  }

  return (
    `<svg viewBox="0 0 ${w} ${h}" class="plot" role="img" aria-label="成交股數換手衰減估算的成本分布">` +
    `<rect class="plot-bg" x="${l}" y="${top}" width="${pw}" height="${plotH}" rx="8"/>` +
    [0, 0.25, 0.5, 0.75, 1]
      .map(
        a =>
          `<line class="gridline" x1="${l}" x2="${w - r}" y1="${Y(max * a)}" y2="${Y(max * a)}"/>` +
          `<text class="axis" x="${l - 7}" y="${Y(max * a) + 3.5}" text-anchor="end">${fmt(max * a * 100, 1)}%</text>`
      )
      .join('') +
    `<path d="${path(1)}" stroke="#60a5fa" fill="none" stroke-width="2.2"/>` +
    `<path d="${path(2)}" stroke="#34d399" fill="none" stroke-width="2.2"/>` +
    mark +
    `<text class="axis" x="${l}" y="${h - 18}">NT$ ${fmt(kAt(0), 0)}</text>` +
    `<text class="axis" text-anchor="middle" x="${w / 2}" y="${h - 18}">NT$ ${fmt(kAt((arr.length - 1) / 2), 0)}</text>` +
    `<text class="axis" text-anchor="end" x="${w - r}" y="${h - 18}">NT$ ${fmt(kAt(arr.length - 1), 0)}</text>` +
    '</svg>' +
    '<div class="legend">' +
    '<span style="color:#60a5fa">● 基準分布</span>' +
    '<span style="color:#34d399">● 比較分布</span>' +
    '<span style="color:#f59e0b">│ 原底峰中心</span>' +
    '</div>'
  );
}

// === components/kline-chart.js ===
/**
 * Yahoo 奇摩股市風格互動式 K 線、均線（MA5/10/20/60）、成交量（MV5）與十字準線繪圖引擎
 * 配色採用台股慣例：紅漲綠跌。
 */

const MA_COLORS = {
  5: '#eab308',
  10: '#a855f7',
  20: '#3b82f6',
  60: '#f97316',
  200: '#22d3ee'
};

function aggregateBars(dailyBars, tf) {
  if (tf === 'D') return dailyBars.map(b => [...b]);
  const groups = [];
  let curKey = null;
  let cur = null;
  for (const [d, o, h, l, c, v] of dailyBars) {
    let key;
    if (tf === 'M') {
      key = d.slice(0, 7);
    } else {
      const parsed = dt(d);
      const day = (parsed.getUTCDay() + 6) % 7;
      parsed.setUTCDate(parsed.getUTCDate() - day);
      key = parsed.toISOString().slice(0, 10);
    }
    if (key !== curKey) {
      if (cur) groups.push(cur);
      curKey = key;
      cur = [d, o, h, l, c, v];
    } else {
      cur[0] = d;
      cur[2] = Math.max(cur[2], h);
      cur[3] = Math.min(cur[3], l);
      cur[4] = c;
      cur[5] += v;
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

function computeMA(bars, period) {
  return bars.map((_, idx) => {
    if (idx + 1 < period) return null;
    let sum = 0;
    for (let k = idx - period + 1; k <= idx; k++) sum += bars[k][4];
    return sum / period;
  });
}

function computeVolMA(bars, period = 5) {
  return bars.map((_, idx) => {
    if (idx + 1 < period) return null;
    let sum = 0;
    for (let k = idx - period + 1; k <= idx; k++) sum += bars[k][5];
    return sum / period;
  });
}

function drawDetailKline() {
  if (typeof document === 'undefined') return;
  const canvas = document.querySelector('#klineCanvas');
  if (!canvas || typeof canvas.getContext !== 'function') return;

  const isUsPage = state.page === 'us_stock';
  const activeCode = isUsPage ? state.usStock : state.stock;
  const detail = isUsPage ? state.usDetailByCode?.[activeCode] : state.stockDetailByCode?.[activeCode];
  if (!detail?.bars?.length) return;

  const maPeriods = isUsPage ? [5, 10, 20, 60, 200] : [5, 10, 20, 60];
  const allAgg = aggregateBars(detail.bars, state.detailTf || 'D');
  const allMa = {
    5: computeMA(allAgg, 5),
    10: computeMA(allAgg, 10),
    20: computeMA(allAgg, 20),
    60: computeMA(allAgg, 60),
    200: computeMA(allAgg, 200)
  };
  const allMv5 = computeVolMA(allAgg, 5);

  const count = state.detailTf === 'D' ? Math.min(state.detailRange || 60, allAgg.length) : allAgg.length;
  const startIdx = allAgg.length - count;
  const view = allAgg.slice(startIdx);
  if (!view.length) return;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 360;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 58;
  const padR = 16;
  const topP = 14;
  const priceH = 228;
  const volTop = 258;
  const volH = 76;
  const plotW = cssW - padL - padR;

  ctx.fillStyle = '#0d1118';
  ctx.fillRect(padL, topP, plotW, priceH);
  ctx.fillRect(padL, volTop, plotW, volH);

  let hi = -Infinity;
  let lo = Infinity;
  let maxV = 1;
  view.forEach((b, i) => {
    hi = Math.max(hi, b[2]);
    lo = Math.min(lo, b[3]);
    maxV = Math.max(maxV, b[5]);
    for (const p of maPeriods) {
      const mv = allMa[p][startIdx + i];
      if (state.detailMas[p] && mv !== null) {
        hi = Math.max(hi, mv);
        lo = Math.min(lo, mv);
      }
    }
  });
  const holdingCost = typeof getBestHoldingCostInfo === 'function' ? getBestHoldingCostInfo(activeCode) : null;
  const costPrice = holdingCost?.costPrice || null;
  if (costPrice && costPrice >= lo * 0.75 && costPrice <= hi * 1.25) {
    hi = Math.max(hi, costPrice);
    lo = Math.min(lo, costPrice);
  }
  const marginP = (hi - lo) * 0.08 || 2;
  hi += marginP;
  lo -= marginP;

  const Y = p => topP + ((hi - p) / (hi - lo)) * priceH;
  const stepX = plotW / Math.max(1, view.length);
  const X = i => padL + i * stepX + stepX / 2;
  const barW = Math.max(2, Math.min(11, stepX * 0.68));

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'right';
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const val = lo + (hi - lo) * f;
    const y = Y(val);
    ctx.beginPath();
    ctx.setLineDash([3, 4]);
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillText((isUsPage ? '$' : '') + fmt(val, val < 150 ? 1 : 0), padL - 6, y + 4);
  }
  ctx.setLineDash([]);

  // K 棒與成交量（統一紅漲綠跌）
  view.forEach((b, i) => {
    const x = X(i);
    const up = b[4] >= b[1];
    const color = up ? '#ef4444' : '#22c55e';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, Y(b[2]));
    ctx.lineTo(x, Y(b[3]));
    ctx.stroke();

    const yTop = Math.min(Y(b[1]), Y(b[4]));
    const bodyH = Math.max(1.5, Math.abs(Y(b[1]) - Y(b[4])));
    ctx.fillRect(x - barW / 2, yTop, barW, bodyH);

    const vh = (b[5] / maxV) * volH;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(x - barW / 2, volTop + volH - vh, barW, Math.max(1, vh));
    ctx.globalAlpha = 1;
  });

  // 均線 MA5/10/20/60(/200)
  for (const p of maPeriods) {
    if (!state.detailMas[p]) continue;
    ctx.strokeStyle = MA_COLORS[p];
    ctx.lineWidth = p === 200 ? 1.8 : 1.6;
    ctx.beginPath();
    let started = false;
    view.forEach((_, i) => {
      const val = allMa[p][startIdx + i];
      if (val === null) return;
      const x = X(i);
      const y = Y(val);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  // 持有成本均價線（若收藏夾有填寫購入價）
  if (costPrice) {
    const dpCost = isUsPage ? 2 : costPrice < 150 ? 2 : 1;
    const inRange = costPrice >= lo && costPrice <= hi;
    const cy = inRange ? Y(costPrice) : costPrice > hi ? topP + 10 : topP + priceH - 10;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, cy);
    ctx.lineTo(cssW - padR, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    const lbl = `成本 ${isUsPage ? '$' : ''}${fmt(costPrice, dpCost)}${inRange ? '' : costPrice > hi ? ' ↑' : ' ↓'}`;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const tw = ctx.measureText(lbl).width + 10;
    const bx = cssW - padR - tw - 4;
    const by = Math.max(topP + 2, Math.min(topP + priceH - 20, cy - 18));
    ctx.fillStyle = 'rgba(13, 17, 24, 0.92)';
    ctx.fillRect(bx, by, tw, 17);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.strokeRect(bx, by, tw, 17);
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'left';
    ctx.fillText(lbl, bx + 5, by + 12);
    ctx.restore();
  }

  // MV5 均量線
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  let mvStarted = false;
  view.forEach((_, i) => {
    const val = allMv5[startIdx + i];
    if (val === null) return;
    const x = X(i);
    const y = volTop + volH - (val / maxV) * volH;
    if (!mvStarted) {
      ctx.moveTo(x, y);
      mvStarted = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // X 軸日期
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText(view[0][0], padL, cssH - 8);
  ctx.textAlign = 'center';
  ctx.fillText(view[Math.floor(view.length / 2)][0], padL + plotW / 2, cssH - 8);
  ctx.textAlign = 'right';
  ctx.fillText(view.at(-1)[0], cssW - padR, cssH - 8);

  const activeIdx =
    state.detailHoverIdx !== null && state.detailHoverIdx < view.length
      ? state.detailHoverIdx
      : view.length - 1;
  const b = view[activeIdx];
  const prevB = activeIdx > 0 ? view[activeIdx - 1] : startIdx > 0 ? allAgg[startIdx - 1] : b;
  const diff = b[4] - prevB[4];
  const diffPct = prevB[4] ? (diff / prevB[4]) * 100 : 0;

  if (state.detailHoverIdx !== null && state.detailHoverIdx < view.length) {
    const cx = X(activeIdx);
    const cy = Y(b[4]);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, topP);
    ctx.lineTo(cx, volTop + volH);
    ctx.moveTo(padL, cy);
    ctx.lineTo(cssW - padR, cy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const readout = document.querySelector('#klineReadout');
  if (readout) {
    const dCls = diff > 0 ? 'tw-up' : diff < 0 ? 'tw-down' : '';
    const dp = isUsPage ? 2 : b[4] < 150 ? 2 : 1;
    const pfx = isUsPage ? '$' : '';
    const volStr = isUsPage && typeof fmtUsShares === 'function' ? fmtUsShares(b[5]) : `${fmt(b[5])} 張`;
    const maSpans = maPeriods
      .filter(p => state.detailMas[p])
      .map(
        p =>
          `<span style="color:${MA_COLORS[p]};font-weight:600">MA${p} ${pfx}${fmt(allMa[p][startIdx + activeIdx], dp)}</span>`
      )
      .join(' ');
    readout.innerHTML =
      `<b>${b[0]}</b>` +
      `<span>開 <b>${pfx}${fmt(b[1], dp)}</b></span>` +
      `<span>高 <b class="tw-up">${pfx}${fmt(b[2], dp)}</b></span>` +
      `<span>低 <b class="tw-down">${pfx}${fmt(b[3], dp)}</b></span>` +
      `<span>收 <b class="${dCls}">${pfx}${fmt(b[4], dp)} (${diffPct >= 0 ? '+' : ''}${fmt(diffPct, 2)}%)</b></span>` +
      `<span>量 <b>${volStr}</b></span>` +
      maSpans;
  }

  canvas.onmousemove = ev => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    if (mx < padL || mx > cssW - padR) return;
    const idx = Math.max(0, Math.min(view.length - 1, Math.floor((mx - padL) / stepX)));
    if (idx !== state.detailHoverIdx) {
      state.detailHoverIdx = idx;
      drawDetailKline();
    }
  };
  canvas.onmouseleave = () => {
    if (state.detailHoverIdx !== null) {
      state.detailHoverIdx = null;
      drawDetailKline();
    }
  };
}

// === components/official-feed-panel.js ===
/**
 * 官方集保週更新面板與狀態同步
 * 嚴格分離「內建凍結」、「官方下載」與「手動匯入」三種來源證據。
 * 支援 Electron (window.officialFeed) 與本機 Python 伺服器 (/api/official/*) 兩種執行環境。
 */

const frozenDays = dates();
const frozenLast = Object.keys(D.quality)
  .filter(d => !Object.hasOwn(savedWeeks, d))
  .sort()
  .at(-1);

const officialWeeks = {};
const officialMonths = {};
let feedBusy = false;
let feedStatus = '上次保存資料';
let feedMessage = '';
let checkedAt = '';

const hasHttpFeed =
  typeof location !== 'undefined' &&
  /^https?:$/.test(location.protocol) &&
  ['127.0.0.1', 'localhost'].includes(location.hostname);

const hasOfficialFeedBackend =
  (typeof window !== 'undefined' && !!window.officialFeed) || hasHttpFeed;

function receiveOfficial(packet) {
  for (const [day, week] of Object.entries(packet.weeks || {})) {
    officialWeeks[day] = week;
    applyWeek(day, week);
    D.issues[day] = week.issues;
    D.adjustments[day] = week.adjustments;
  }
  Object.assign(officialMonths, packet.months);
  if (Object.keys(packet.months || {}).length) {
    D.sessions = [...new Set([...D.sessions, ...Object.values(officialMonths).flatMap(m => m.days)])].sort();
    rebuildWeeks();
  }
}

function latestVerifiedDay() {
  return [...frozenDays.filter(d => !Object.hasOwn(savedWeeks, d)), ...Object.keys(officialWeeks)]
    .sort()
    .at(-1);
}

function feedPanel() {
  const day = latestVerifiedDay();
  const last = officialWeeks[day]?.quality;
  const gaps = weekEnds.filter(d => d > frozenLast && d < day && !D.observed[d]);
  const text = (feedBusy ? '檢查中' : feedStatus) + (feedMessage ? '｜' + feedMessage : '');

  let details = '';
  if (state.page === 'data') {
    const records = Object.entries(officialWeeks).sort((a, b) => b[0].localeCompare(a[0]));
    const items = [];
    for (const [d, w] of records) {
      items.push(
        `<p>${esc(`${d}｜TDCC 1-5｜${w.quality.valid} 檔有效，${w.quality.invalid} 檔待核｜${w.quality.validation}`)}<br>` +
        `${esc(`來源 ${w.quality.raw_source}｜SHA-256 ${w.quality.sha256}`)}<br>` +
        `${esc(`取得／已證實可用 ${w.observed}｜官方首次公布時間待證`)}</p>`
      );
    }
    for (const [d, w] of Object.entries(savedWeeks).sort()) {
      items.push(`<p>${esc(`${d}｜${w.quality.raw_source}｜手動快照，公布時點待證`)}</p>`);
    }
    items.push(`<p>交易日曆截至 ${esc(D.sessions.at(-1))}（證交所實際成交日期）。</p>`);
    if (gaps.length) {
      items.push(
        `<p>官方整批檔未取得的統計週：${esc(gaps.join('、'))}。個股歷史可由集保查詢，待證期保留缺口。</p>`
      );
    }
    details = `<div class="feed-details">${items.join('')}</div>`;
  }

  return (
    '<div class="card" id="feedPanel">' +
    '<div class="feed-bar">' +
    '<div class="feed-meta">' +
    '<span class="feed-title">集保週資料</span>' +
    `<span id="feedStatus">${esc(text)}</span>` +
    '<span class="feed-sep">|</span>' +
    `<span>最新已驗證統計日 <b id="feedDay">${esc(day || '—')}</b></span>` +
    `<span>目前篩選週 <b>${esc(state.win || '無可評估窗口')}</b></span>` +
    `<span class="mini">最後取得 ${esc(last?.fetched || '內建封存資料')} · 最近檢查 ${esc(checkedAt || '—')}</span>` +
    '</div>' +
    `<button id="refreshTDCC" class="btn sm"${feedBusy ? ' disabled' : ''}>${state.page === 'data' ? '重試集保與日曆' : '立即更新'}</button>` +
    '</div>' +
    details +
    '</div>'
  );
}

function paintFeed() {
  const panel = document.querySelector('#feedPanel');
  if (panel && ['home', 'data'].includes(state.page)) {
    panel.outerHTML = feedPanel();
  }
}

async function requestOfficialUpdate() {
  if (typeof window !== 'undefined' && window.officialFeed) {
    return window.officialFeed.update();
  }
  if (hasHttpFeed) {
    const resp = await fetch('/api/official/update', { method: 'POST', cache: 'no-store' });
    if (!resp.ok) throw Error('本機更新服務回應 HTTP ' + resp.status);
    return resp.json();
  }
  throw Error('純離線檔案無法直接連線官方來源，請使用桌面版、啟動 py scripts/serve_local.py，或至「資料與驗收」手動匯入 CSV');
}

async function refreshTDCC() {
  if (feedBusy) return;
  feedBusy = true;
  paintFeed();
  let changed = false;
  try {
    const packet = await requestOfficialUpdate();
    receiveOfficial(packet);
    changed = Object.keys(packet.weeks || {}).length + Object.keys(packet.months || {}).length > 0;
    if (changed && !state.manualWeek) useDefaultWeek();
    feedStatus = packet.status;
    feedMessage = packet.message;
    checkedAt = packet.checked;
  } catch (e) {
    feedStatus = '無法更新';
    feedMessage = e.message;
    toast(e.message);
  } finally {
    feedBusy = false;
    if (changed && ['home', 'data', 'stock', 'backtest', 'screen'].includes(state.page)) {
      render();
    } else {
      paintFeed();
    }
  }
}

if (typeof window !== 'undefined' && window.officialFeed) {
  const cached = window.officialFeed.read();
  receiveOfficial(cached);
  feedMessage = cached.notes.join('；');
} else if (hasHttpFeed) {
  fetch('/api/official/read', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(cached => {
      if (!cached) return;
      const hadUpdates = Object.keys(cached.weeks || {}).length + Object.keys(cached.months || {}).length > 0;
      receiveOfficial(cached);
      if (cached.notes?.length) feedMessage = cached.notes.join('；');
      if (hadUpdates && !state.manualWeek) useDefaultWeek();
      if (hadUpdates) render();
      else paintFeed();
    })
    .catch(() => {});
}

// === components/preset-dialog.js ===
/**
 * 原生 <dialog> 方案命名彈窗（補齊 Electron 不支援 window.prompt 之行為）
 */

if (typeof document !== 'undefined' && document.body?.addEventListener) {
  document.body.addEventListener(
    'click',
    event => {
      if (event.fromPresetDialog || !event.target?.closest?.('#savePreset')) return;
      event.stopImmediatePropagation();

      const dialog = document.createElement('dialog');
      dialog.className = 'preset-dialog';
      dialog.innerHTML =
        '<label>這份方案要叫什麼名字？<input maxlength="50" placeholder="例如：400張保守連兩週" autofocus></label>' +
        '<div class="dialog-actions">' +
        '<button type="button" class="btn main sm">儲存</button>' +
        '<button type="button" class="btn ghost sm">取消</button>' +
        '</div>';

      const input = dialog.querySelector('input');

      function save() {
        const name = input.value.trim();
        if (!name) return input.focus();
        const original = window.prompt;
        try {
          dialog.close();
          window.prompt = () => name;
          const button = document.querySelector('#savePreset');
          const replay = new MouseEvent('click', { bubbles: true });
          Object.defineProperty(replay, 'fromPresetDialog', { value: true });
          button.dispatchEvent(replay);
        } finally {
          window.prompt = original;
        }
      }

      const [ok, cancel] = dialog.querySelectorAll('button');
      ok.onclick = save;
      cancel.onclick = () => dialog.close();
      input.onkeydown = e => {
        if (e.key === 'Enter' && !e.isComposing) save();
      };
      dialog.onclose = () => dialog.remove();
      document.body.appendChild(dialog);
      dialog.showModal();
    },
    { capture: true }
  );
}

// === pages/home.js ===
/**
 * 頁面 01：研究總覽 (home)
 */

function renderFeaturedCase(win) {
  if (historicalView()) return '';

  const code = state.featuredCode || '2404';
  const stockInfo = D.stocks[code] || ['未驗證名稱', '?'];
  const name = stockInfo[0] || code;
  const sig = weeklySignal(code, win);
  const firstPct = sig.values?.[0]?.pct;
  const lastPct = sig.values?.at(-1)?.pct;
  const hasRange = Number.isFinite(firstPct) && Number.isFinite(lastPct);
  const dateRangeText = win?.dates?.length ? win.dates.join(' → ') : '尚無完整連續交易週';
  const statusBadge = sig.pass
    ? badge('原始數值已驗證', 'good')
    : sig.insufficient
      ? badge(sig.status, 'warn')
      : badge(sig.status, '');

  const editor = state.editingFeatured
    ? '<div class="featured-editor">' +
      `<input id="featuredCodeInput" autocomplete="off" data-stock-suggest="TW" data-suggest-submit="saveFeaturedBtn" placeholder="輸入代號或股名（如 0050、2330）" value="${esc(code)}" aria-label="更改固定驗收案例代號">` +
      '<button type="button" class="btn main sm" id="saveFeaturedBtn">更改</button>' +
      '<button type="button" class="btn ghost sm" id="cancelFeaturedBtn">取消</button>' +
      '</div>'
    : '';

  const shareChangeText = sig.deltaShares
    ? sig.deltaShares.map(v => (v >= 0 ? '+' : '') + fmt(v)).join(' / ') + ' 股'
    : '—';

  const heading =
    `<span class="featured-title-wrap">${esc(name)} ${esc(code)}｜固定驗收案例` +
    '<button type="button" class="icon-btn" id="editFeaturedBtn" title="更改固定驗收案例" aria-label="更改固定驗收案例">⚙</button>' +
    '</span>';

  return (
    '<div class="card hot">' +
    cardhead(heading, esc(dateRangeText), statusBadge) +
    editor +
    `<div class="feature"><span class="muted">${esc(applied.band)} 張大戶持股比例</span><strong>${hasRange ? `${fmt(firstPct, 3)}% → ${fmt(lastPct, 3)}%` : '—'}</strong></div>` +
    '<div class="statbar">' +
    `<div><span class="mini">${applied.weeks} 週累計</span><strong class="${sign(sig.gain)}">${Number.isFinite(sig.gain) ? pp(sig.gain, 6) + ' pp' : '—'}</strong></div>` +
    `<div><span class="mini">持股變化</span><strong>${esc(shareChangeText)}</strong></div>` +
    '</div>' +
    `<div style="margin-top:16px">${weeklyPlot(code, [applied.band], 'all')}</div>` +
    `<p class="footnote">證據最晚可得：${esc(sig.knownDate || '未知')}；最早觀察開盤：${esc(sig.eligible || '待核')}。${sig.insufficient ? esc('狀態：' + sig.reason + '。') : ''}不是經績效驗證的進場建議。</p>` +
    `<button class="btn main sm" data-stock="${esc(code)}" style="margin-top:12px">打開${esc(name)}完整分析 →</button>` +
    '</div>'
  );
}

function home() {
  const win = evaluation(applied);
  const rows = scan();
  const t = tally(rows);
  const best = rows
    .filter(x => x.pass)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 8);

  return (
    title(
      '台股籌碼研究總覽',
      '以集保分級股數計算，先找到異動，再辨別證據是否足以支持交易。',
      '<button class="btn main" data-nav="screen">查看完整篩選結果 →</button>'
    ) +
    '<div class="notice warn"><b>研究範圍聲明：</b>已載入六期原始集保全表，可依最新三期篩選約兩千檔上市櫃候選；股票母體採 11/13 行情備份，可能有存活偏差。除漢唐外，逐檔公司行動與正式回測未通過驗收。不是即時報價或買賣訊號。</div>' +
    '<div class="metricgrid">' +
    metric('目前候選股票池', fmt(D.universe.length), '四碼非零開頭、上市櫃行情備份') +
    metric('所選窗口通過數', fmt(t.pass), `級距 ${applied.band} 張 · 門檻 ${fmt(applied.minPp, 2)} pp`, 'green') +
    metric('資料／條件待證', fmt(t.unknown), '不列為正式有效進場') +
    metric('日 K 已核對', fmt(D.daily2404.length), '漢唐 2404 · 2024–2026') +
    '</div>' +
    '<div class="grid2">' +
    '<div class="card">' +
    cardhead('所選窗口增持候選', `同一最後週 ${esc(win?.end || '—')} · 依累計增幅排序`, settingsHint()) +
    (best.length
      ? '<div class="tblwrap"><table><thead><tr><th>個股</th><th>增幅</th><th>股數連增</th><th>訊號</th></tr></thead><tbody>' +
        best
          .map(
            x =>
              `<tr class="clickable" data-stock="${x.code}">` +
              `<td><b>${ticker(x.code)}</b></td>` +
              `<td class="green">${pp(x.gain)} pp</td>` +
              `<td>${x.deltaShares.map(v => '＋' + fmt(v)).join(' / ')}</td>` +
              `<td>${badge('週訊號候選', 'good')}</td>` +
              '</tr>'
          )
          .join('') +
        '</tbody></table></div>'
      : '<div class="empty">目前參數無通過候選</div>') +
    '<button class="btn ghost sm" data-nav="screen" style="margin-top:16px">展開所有股票 →</button>' +
    '</div>' +
    renderFeaturedCase(win) +
    '</div>' +
    '<div class="section"><h2>工作流程與交付能力</h2></div>' +
    '<div class="grid2 equal">' +
    '<div class="card">' +
    `<div class="feature"><strong>01. 篩選與比較</strong>${badge('可使用', 'good')}</div>` +
    `<div class="feature"><strong>02. 大戶級距切換與日期明細</strong>${badge('可使用', 'good')}</div>` +
    `<div class="feature"><strong>03. 本機策略方案與 A/B 訊號比較</strong>${badge('可使用', 'good')}</div>` +
    `<div class="feature"><strong>04. 全市場正式報酬回測</strong>${badge('待資料驗收', 'warn')}</div>` +
    '</div>' +
    '<div class="card">' +
    `<div class="feature"><strong>05. 漢唐日線與成交量</strong>${badge('可使用', 'good')}</div>` +
    `<div class="feature"><strong>06. 成本分布／底峰探索計算</strong>${badge('研究版', 'warn')}</div>` +
    `<div class="feature"><strong>07. 跨裝置雲端同步</strong>${badge('尚未部署', 'warn')}</div>` +
    `<div class="feature"><strong>08. 新資料匯入與 CSV 匯出</strong>${badge('可使用', 'good')}</div>` +
    '</div>' +
    '</div>'
  );
}

// === pages/briefing.js ===
/**
 * 頁面：每日 10:00 自動財經晨報 (briefing)
 * 支援手動開啟／關閉每日 10:00 自動晨報、隨時一鍵馬上製作、歷史日期切換、Markdown 匯出與本機隔離 AI 金鑰設定。
 */

function enrichTrackedChipNote(item) {
  const code = item.code;
  if (!/^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(code)) {
    return item.chipNote || '美股報價';
  }
  const ctx = evaluation(applied);
  const sig = weeklySignal(code, ctx);
  if (Number.isFinite(sig.gain)) {
    const dir = sig.gain > 0 ? '大戶增持' : sig.gain < 0 ? '大戶調節' : '持平';
    return `${applied.band}張${dir} ${pp(sig.gain, 3)} pp（${sig.status}）`;
  }
  return sig.reason || item.chipNote || '—';
}

function renderBriefingQuoteRows(items, showNewsReason = false) {
  return (items || [])
    .map(t => {
      const hasVal = typeof t.price === 'number';
      const cls = !hasVal ? '' : t.change > 0 ? 'tw-up' : t.change < 0 ? 'tw-down' : '';
      const clickable = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(t.code);
      const chipNote = enrichTrackedChipNote(t);
      const noteText = showNewsReason && t.mentionedIn
        ? (chipNote && chipNote !== t.mentionedIn && !chipNote.includes('可於個股頁核對') ? `${t.mentionedIn} · ${chipNote}` : t.mentionedIn)
        : chipNote;
      return (
        `<tr${clickable ? ` class="clickable" data-stock="${esc(t.code)}"` : ''}>` +
        `<td><b>${esc(t.code)}</b> <span class="cell-muted">${esc(t.name)}</span></td>` +
        `<td>${esc(t.market)}</td>` +
        `<td>${hasVal ? fmt(t.price, t.price < 150 ? 2 : 1) : '—'}</td>` +
        `<td class="${cls}">${hasVal ? `${pp(t.change, 2)} (${pp(t.changePct, 2)}%)` : '—'}</td>` +
        `<td>${esc(noteText)}</td>` +
        '</tr>'
      );
    })
    .join('');
}

function briefingPage() {
  const cfg = state.briefingConfig || {};
  const enabled = cfg.enabled !== false;
  const report = state.briefingReport;
  const datesList = state.briefingDates || [];

  const headerActions =
    '<div class="brief-controls">' +
    `<label class="switch-wrap" title="手動開啟或關閉每日台灣時間 10:00 自動產出晨報">` +
    `<input type="checkbox" id="toggleAutoBriefing" ${enabled ? 'checked' : ''}>` +
    '<span class="switch-track"><span class="switch-thumb"></span></span>' +
    `<span class="switch-label">${enabled ? '10:00 自動晨報：開啟' : '10:00 自動晨報：已關閉'}</span>` +
    '</label>' +
    `<button type="button" class="btn main" id="generateBriefingBtn"${state.briefingBusy ? ' disabled' : ''}>${state.briefingBusy ? '彙總製作中...' : '⚡ 馬上製作'}</button>` +
    `<button type="button" class="btn sm" id="toggleBriefingSettings" title="設定關注代號與選填 Gemini API Key">⚙ 設定</button>` +
    '</div>';

  const selectedTopics = Array.isArray(cfg.topics) ? cfg.topics : [];
  const availableTopics = Array.isArray(cfg.availableTopics) ? cfg.availableTopics : [];
  const topicCheckboxes = availableTopics
    .map(t => {
      const checked = !selectedTopics.length || selectedTopics.includes(t.id);
      return `<label class="topic-chip"><input type="checkbox" data-briefing-topic="${esc(t.id)}"${checked ? ' checked' : ''}><span>${esc(t.label)}</span></label>`;
    })
    .join('');

  const settingsPanel = state.briefingSettingsOpen
    ? '<div class="card" style="margin-bottom:18px">' +
      cardhead('晨報追蹤清單、題材篩選與選填 AI 設定', '敏感金鑰隔離保存於 Windows 本機資料夾（%LOCALAPPDATA%\\ChipScreener），絕不寫入專案或 Git') +
      '<div class="formgrid">' +
      '<div class="field">' +
      '<label>自訂追蹤標的代號（空白或逗號分隔，支援台美股）</label>' +
      `<input id="briefingWatchlistInput" value="${esc((cfg.watchlist || []).join(', '))}" placeholder="例如：2330, 0050, TSM, NVDA">` +
      '<small>僅查詢您自訂的清單；系統另會依今日晨報新聞自動找出重點股票顯示於下方速覽</small>' +
      '</div>' +
      '<div class="field">' +
      `<label>選填 Gemini API Key ${cfg.hasGeminiKey ? badge('已設定 ' + cfg.geminiKeyHint, 'good') : badge('未設定（使用免 Key 規則彙整）', '')}</label>` +
      '<input id="briefingGeminiKeyInput" type="password" placeholder="留空維持現狀；貼上新 Key 以啟用 AI 濃縮">' +
      '<small>未設定時完全免費使用規則式重點彙整；設定後將以真實新聞濃縮摘要並附來源</small>' +
      '</div>' +
      '</div>' +
      '<div class="field" style="margin-top:14px">' +
      '<label>晨報查詢題材（可複選，未變動或全選時採均衡預設）</label>' +
      `<div class="topic-grid" id="briefingTopicsGroup">${topicCheckboxes}</div>` +
      '<small>選擇特定題材後，系統將優先抓選並彙總符合所選題材的財經焦點；可隨時調整並重新製作</small>' +
      '</div>' +
      '<div class="toolbar" style="margin-top:14px;margin-bottom:0">' +
      '<button type="button" class="btn main sm" id="saveBriefingSettingsBtn">儲存晨報設定</button>' +
      (cfg.hasGeminiKey ? '<button type="button" class="btn danger sm" id="clearGeminiKeyBtn">清除已存 API Key</button>' : '') +
      `<span class="mini">系統排程狀態：${esc(cfg.windowsTaskStatus || '—')}</span>` +
      '</div>' +
      '</div>'
    : '';

  const toolbarRow =
    '<div class="card" style="padding:12px 16px;margin-bottom:18px">' +
    '<div class="feed-bar">' +
    '<div class="feed-meta">' +
    `<label>歷史晨報 <select id="briefingDateSelect" class="select" style="padding:5px 10px">${
      datesList.length
        ? datesList
            .map(d => `<option value="${esc(d)}" ${d === (report?.date || state.briefingSelectedDate) ? 'selected' : ''}>${esc(d)}</option>`)
            .join('')
        : '<option value="">尚無歷史紀錄</option>'
    }</select></label>` +
    (report
      ? `<span class="mini">產出時間 ${esc(report.generatedAt)} · ${esc(report.summaryMode)} · ${esc(report.trigger)}</span>`
      : `<span class="mini">${esc(cfg.windowsTaskStatus || '')}</span>`) +
    '</div>' +
    (report ? '<button type="button" class="btn sm" id="exportBriefingMd">↓ 匯出 Markdown 報告</button>' : '') +
    '</div>' +
    '</div>';

  let bodyHtml = '';
  if (state.briefingBusy && !report) {
    bodyHtml = '<div class="card"><div class="empty"><b>正在彙總台美股最新指數、重點新聞與追蹤標的...</b>通常約需 5～10 秒，請稍候</div></div>';
  } else if (state.briefingError && !report) {
    bodyHtml = `<div class="card"><div class="empty"><b>無法讀取或製作晨報</b>${esc(state.briefingError)}</div></div>`;
  } else if (!report) {
    bodyHtml =
      '<div class="card"><div class="empty"><b>尚無已儲存的晨報</b>' +
      '點擊右上角「<b>⚡ 馬上製作</b>」即可立即抓取最新台美股盤勢與權威財經新聞並產出報告。</div></div>';
  } else {
    const indicesCards = (report.indices || [])
      .map(idx => {
        const hasVal = typeof idx.price === 'number';
        const cls = !hasVal ? '' : idx.change > 0 ? 'tw-up' : idx.change < 0 ? 'tw-down' : '';
        const arrow = !hasVal ? '' : idx.change > 0 ? '▲' : idx.change < 0 ? '▼' : '';
        return (
          '<div class="index-card">' +
          `<div class="idx-head"><span>${esc(idx.name)}</span><span class="mini">${esc(idx.market)}</span></div>` +
          `<div class="idx-price ${cls}">${hasVal ? fmt(idx.price, 2) : '—'}</div>` +
          `<div class="idx-chg ${cls}">${hasVal ? `${arrow} ${pp(idx.change, 2)} (${pp(idx.changePct, 2)}%)` : '暫無報價'}</div>` +
          '</div>'
        );
      })
      .join('');

    const summaryItems = (report.summary || [])
      .map(line => `<li>${esc(line)}</li>`)
      .join('');

    const trackedRows = renderBriefingQuoteRows(report.tracked || [], false);
    const newsStockRows = renderBriefingQuoteRows(report.newsStocks || [], true);

    const newsList = report.news || [];
    const newsItems = newsList
      .map(n => {
        const catType = n.category === '台股' ? 'good' : n.category === '總經' ? 'warn' : '';
        const topicTags = (n.topics || []).map(t => badge(t, '')).join('');
        return (
          '<div class="news-item">' +
          '<div class="news-main">' +
          `<div class="news-meta">${badge(n.category, catType)}${topicTags}<span class="news-source">${esc(n.source)}</span>${n.published ? `<span class="mini">${esc(n.published)}</span>` : ''}</div>` +
          `<a class="news-title" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)} ↗</a>` +
          (n.snippet ? `<p class="news-snippet">${esc(n.snippet)}</p>` : '') +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    const topicInfo = Array.isArray(report.topicLabels) && report.topicLabels.length ? `題材：${report.topicLabels.join('、')}` : '';

    bodyHtml =
      // 1. 一分鐘重點總結
      '<div class="card" style="margin-bottom:18px">' +
      cardhead('一分鐘重點總結', `${esc(report.date)} 精簡摘要${topicInfo ? ' · ' + esc(topicInfo) : ''}`, badge(report.summaryMode, report.summaryMode.includes('AI') ? 'good' : '')) +
      `<ul class="brief-list">${summaryItems}</ul>` +
      '</div>' +
      // 2. 台美股盤勢快照
      '<div class="section" style="margin-top:0"><h2>台美股盤勢快照</h2><span class="mini">台股紅漲綠跌 · 來源：Yahoo Finance</span></div>' +
      `<div class="index-grid" style="margin-bottom:22px">${indicesCards}</div>` +
      // 3. 重點新聞精選（可收起，附消息來源）
      '<div class="section">' +
      `<h2>重點財經新聞精選（附消息來源）</h2>` +
      '<div class="section-actions">' +
      '<span class="mini">Yahoo 奇摩股市 · 中央社財經 · CNBC 財經（自動過濾非財經雜訊並去重）</span>' +
      `<button type="button" class="btn sm" id="toggleBriefingNews">${state.briefingNewsOpen ? `▲ 收起新聞 (${newsList.length})` : `▼ 展開新聞 (${newsList.length})`}</button>` +
      '</div>' +
      '</div>' +
      (state.briefingNewsOpen
        ? '<div class="card" id="briefingNewsCard" style="margin-bottom:22px">' +
          (newsItems || '<div class="empty">本次未抓取到符合條件的新聞項目</div>') +
          '</div>'
        : `<div class="card" id="briefingNewsCard" style="margin-bottom:22px;padding:12px 16px"><span class="mini">已收起 ${newsList.length} 則重點財經新聞，點擊右上「展開新聞」即可瀏覽標題與來源連結。</span></div>`) +
      // 4. 自訂追蹤標的異動速覽
      '<div class="section"><h2>自訂追蹤標的異動速覽</h2><span class="mini">僅依「設定」中之自訂清單查詢 · 點擊台股列可前往個股研究／詳情</span></div>' +
      '<div class="card" style="margin-bottom:22px">' +
      (trackedRows
        ? '<div class="tblwrap"><table><thead><tr><th>代號／名稱</th><th>市場</th><th>最新價</th><th>漲跌幅</th><th>籌碼／備註</th></tr></thead><tbody>' +
          trackedRows +
          '</tbody></table></div>'
        : '<div class="empty">尚未設定自訂追蹤標的，可於右上方「⚙ 設定」加入台美股代號</div>') +
      '</div>' +
      // 5. 晨報重點股票異動速覽（依今日新聞自動彙整）
      '<div class="section"><h2>晨報重點股票異動速覽</h2><span class="mini">自動自本次晨報新聞中萃取出之重點台美股（不含上方自訂清單）</span></div>' +
      '<div class="card">' +
      (newsStockRows
        ? '<div class="tblwrap"><table><thead><tr><th>代號／名稱</th><th>市場</th><th>最新價</th><th>漲跌幅</th><th>新聞提及／備註</th></tr></thead><tbody>' +
          newsStockRows +
          '</tbody></table></div>'
        : '<div class="empty">本次晨報新聞未額外提及可對應報價之重點個股</div>') +
      '</div>';
  }

  return (
    title(
      '每日 10:00 財經晨報',
      '每日台灣時間早上 10:00 自動彙總台美股盤勢與重點新聞（附原始消息來源），可隨時手動關閉或一鍵馬上製作。',
      headerActions
    ) +
    settingsPanel +
    toolbarRow +
    bodyHtml
  );
}

// === pages/watchlist.js ===
/**
 * 頁面：股票收藏夾 ＆ 自動分析 (watchlist)
 * - 支援多個自訂收藏夾（建立／重新命名／刪除）與獨立「自動分析」分頁
 * - 列表維持極簡：代號名稱、最新股價與漲跌幅（紅漲綠跌）、價值估算（開關式）、右側「...」選單
 * - 價值估算公式：
 *   算法 1：現價 × 持有股數（市值）
 *   算法 2：購入價格 × 持有股數（僅於填寫購入價格時計算未實現盈虧，紅賺／綠虧／白平）
 */

function isStockInAnyFolder(code) {
  const folders = state.watchlistConfig?.folders || [];
  return folders.some(f => (f.items || []).some(it => it.code === code));
}

function getBestHoldingCostInfo(code) {
  const folders = state.watchlistConfig?.folders || [];
  const activeFolder = folders.find(f => f.id === state.watchlistActiveTab);
  const ordered = activeFolder ? [activeFolder, ...folders.filter(f => f.id !== activeFolder.id)] : folders;
  for (const f of ordered) {
    const it = (f.items || []).find(x => x.code === code && x.costPrice > 0);
    if (it) {
      return {
        folderId: f.id,
        folderName: f.name,
        shares: Number(it.shares) || 0,
        costPrice: Number(it.costPrice),
        showValuation: Boolean(it.showValuation)
      };
    }
  }
  return null;
}

function renderQuickFavModal() {
  const code = state.quickFavCode;
  if (!code) return '';
  const cfg = state.watchlistConfig || {};
  const folders = cfg.folders || [];
  const autoStocks = cfg.autoStocks || [];
  const inAuto = autoStocks.includes(code);
  const info = D.stocks[code] || [code, /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(code) ? 'TWSE' : 'US'];

  const folderButtons = folders
    .map(f => {
      const has = (f.items || []).some(it => it.code === code);
      return (
        `<button type="button" class="wl-pick-row ${has ? 'active' : ''}" data-qfav-folder="${esc(f.id)}" data-qfav-code="${esc(code)}">` +
        `<span><b>${has ? '✓' : '+'}</b> ${esc(f.name)}</span>` +
        `<span class="mini">${(f.items || []).length} 檔</span>` +
        '</button>'
      );
    })
    .join('');

  return (
    '<div class="wl-modal-backdrop" id="quickFavBackdrop">' +
    '<div class="wl-modal card" role="dialog" aria-label="加入股票收藏夾">' +
    cardhead(
      `收藏設定｜${esc(code)} ${esc(info[0])}`,
      '選擇要加入或移出的自訂收藏夾，也可同步加入自動分析',
      '<button type="button" class="btn sm" id="closeQuickFavBtn">關閉</button>'
    ) +
    `<div class="wl-pick-list">${folderButtons}</div>` +
    '<div class="wl-quick-new-row">' +
    `<input id="quickFavNewFolderInput" placeholder="或直接輸入新收藏夾名稱建立並加入" style="flex:1">` +
    `<button type="button" class="btn sm" id="quickFavCreateBtn" data-qfav-code="${esc(code)}">+ 建立並加入</button>` +
    '</div>' +
    '<div class="wl-modal-foot">' +
    `<button type="button" class="btn ${inAuto ? 'main' : ''} sm" id="quickFavAutoBtn" data-qfav-code="${esc(code)}">${inAuto ? '✦ 已在自動分析（點擊移出）' : '✦ 同時加入自動分析'}</button>` +
    `<button type="button" class="btn sm" data-nav="watchlist">前往收藏夾頁 →</button>` +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function fmtUsShares(v) {
  if (typeof v !== 'number' || !isFinite(v)) return '—';
  if (v >= 1e9) return fmt(v / 1e9, 2) + 'B 股';
  if (v >= 1e6) return fmt(v / 1e6, 2) + 'M 股';
  if (v >= 1e3) return fmt(v / 1e3, 1) + 'K 股';
  return fmt(v, 0) + ' 股';
}

function isUsSymbol(code, market = '') {
  return market === 'US' || !/^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(String(code || ''));
}

function renderCustomValuationCell(item, quote) {
  if (!item.showValuation) {
    return '<span class="mini">未開啟（點 … 設定）</span>';
  }
  const shares = Number(item.shares) || 0;
  if (shares <= 0) {
    return '<span class="mini">請於 … 輸入持有股數</span>';
  }
  const price = typeof quote?.price === 'number' ? quote.price : null;
  if (price === null) {
    return `<span class="mini">${fmt(shares)} 股（點擊一鍵更新股價）</span>`;
  }

  const isUs = isUsSymbol(item.code, item.market);
  // 算法 1：現價 × 持有股數
  const marketVal = price * shares;
  let pnlHtml = '';
  // 算法 2：僅於有輸入購入價格時計算未實現盈虧（統一紅賺／綠虧／白平）
  if (typeof item.costPrice === 'number' && item.costPrice > 0) {
    const costTotal = item.costPrice * shares;
    const pnl = marketVal - costTotal;
    const pnlPct = costTotal > 0 ? (pnl / costTotal) * 100 : 0;
    const pnlCls = pnl > 0 ? 'tw-up' : pnl < 0 ? 'tw-down' : 'wl-pnl-flat';
    const signStr = pnl > 0 ? '+' : pnl < 0 ? '-' : '';
    const pctStr = pnlPct > 0 ? '+' : '';
    const pnlStr = isUs
      ? `${signStr}$${fmt(Math.abs(pnl), 2)}`
      : `${pnl > 0 ? '+' : ''}${fmt(pnl, 0)}`;
    pnlHtml = `<span class="wl-pnl ${pnlCls}">${pnlStr} (${pctStr}${fmt(pnlPct, 2)}%)</span>`;
  }

  const valMainStr = isUs ? `$${fmt(marketVal, 2)} USD` : `${fmt(marketVal, 0)} 元`;
  const costSubStr = item.costPrice > 0
    ? (isUs ? ` · 均價 $${fmt(item.costPrice, 2)}` : ` · 均價 ${fmt(item.costPrice, item.costPrice < 150 ? 2 : 1)}`)
    : '';

  return (
    '<div class="wl-val-wrap">' +
    `<strong class="wl-val-main">${valMainStr}</strong>` +
    pnlHtml +
    `<span class="mini" style="width:100%;display:block;margin-top:2px">${fmt(shares)} 股${costSubStr}</span>` +
    '</div>'
  );
}

function renderRowMenuDrawer(folder, item) {
  const checked = item.showValuation ? 'checked' : '';
  const inAuto = Boolean(item.inAuto);
  const sharesVal = item.shares > 0 ? String(item.shares) : '';
  const costVal = item.costPrice > 0 ? String(item.costPrice) : '';

  return (
    `<tr class="wl-drawer-row"><td colspan="4">` +
    '<div class="wl-drawer">' +
    '<div class="wl-drawer-section">' +
    '<div class="wl-drawer-title">價值估算（可開關）</div>' +
    '<div class="wl-drawer-fields">' +
    `<label class="wl-check-inline"><input type="checkbox" id="wlMenuValuationToggle" ${checked}><span>開啟價值估算</span></label>` +
    `<label class="wl-inline-field">持有股數 <input id="wlMenuSharesInput" type="number" min="0" step="1" placeholder="如 1000" value="${esc(sharesVal)}"></label>` +
    `<label class="wl-inline-field">購入價格（非必填） <input id="wlMenuCostInput" type="number" min="0" step="0.01" placeholder="留空僅算市值" value="${esc(costVal)}"></label>` +
    `<button type="button" class="btn main sm" id="wlMenuSaveBtn" data-wl-save="${esc(folder.id)}:${esc(item.code)}">儲存估值</button>` +
    '</div>' +
    '</div>' +
    '<div class="wl-drawer-actions">' +
    `<button type="button" class="btn sm ${inAuto ? 'good-outline' : ''}" data-wl-toggle-auto="${esc(item.code)}">${inAuto ? '✦ 移出自動分析' : '✦ 加入自動分析'}</button>` +
    `<button type="button" class="btn danger sm" data-wl-remove-item="${esc(folder.id)}:${esc(item.code)}">從此收藏夾刪除</button>` +
    `<button type="button" class="btn sm" id="wlMenuCloseBtn">收起</button>` +
    '</div>' +
    '</div>' +
    '</td></tr>'
  );
}

function renderCustomWatchlistTab(folder) {
  const quotes = state.watchlistQuotes || {};
  const items = folder?.items || [];

  const renameBox =
    state.watchlistRenamingFolderId === folder.id
      ? '<div class="toolbar" style="margin-bottom:12px">' +
        `<input id="wlRenameInput" value="${esc(folder.name)}" maxlength="30" placeholder="輸入新收藏夾名稱">` +
        `<button type="button" class="btn main sm" id="wlRenameSaveBtn" data-folder-id="${esc(folder.id)}">確認更名</button>` +
        '<button type="button" class="btn sm" id="wlRenameCancelBtn">取消</button>' +
        '</div>'
      : '';

  const folderTools =
    '<div class="feed-bar" style="margin-bottom:14px">' +
    '<div class="toolbar" style="margin:0">' +
    `<input id="addWatchlistCodeInput" autocomplete="off" data-stock-suggest="ALL" data-suggest-submit="addWatchlistStockBtn" placeholder="輸入代號或名稱（如 2330、台積電、NVDA）" style="width:295px">` +
    `<button type="button" class="btn main sm" id="addWatchlistStockBtn" data-folder-id="${esc(folder.id)}">+ 加入股票</button>` +
    '</div>' +
    '<div class="toolbar" style="margin:0">' +
    `<span class="mini">${state.watchlistQuotesUpdatedAt ? `報價更新：${esc(state.watchlistQuotesUpdatedAt)}` : '點擊右上方「一鍵更新股價」抓取即時價'}</span>` +
    `<button type="button" class="btn sm" id="wlStartRenameBtn" data-folder-id="${esc(folder.id)}">✎ 更名收藏夾</button>` +
    `<button type="button" class="btn danger sm" id="wlDeleteFolderBtn" data-folder-id="${esc(folder.id)}">刪除收藏夾</button>` +
    '</div>' +
    '</div>' +
    renameBox;

  if (!items.length) {
    return (
      '<div class="card">' +
      folderTools +
      `<div class="empty"><b>「${esc(folder.name)}」目前尚無股票</b>輸入上方台美股代號（或從全市場篩選、個股頁按 ★ 加入），即會顯示於極簡清單。</div>` +
      '</div>'
    );
  }

  const rowsHtml = items
    .map(item => {
      const isUs = isUsSymbol(item.code, item.market);
      const q = quotes[item.code];
      const hasVal = typeof q?.price === 'number';
      const dp = isUs ? 2 : hasVal && q.price < 150 ? 2 : 1;
      const dirCls = !hasVal ? '' : q.change > 0 ? 'tw-up' : q.change < 0 ? 'tw-down' : 'wl-pnl-flat';
      const arrow = !hasVal ? '' : q.change > 0 ? '▲' : q.change < 0 ? '▼' : '';
      const menuKey = `${folder.id}:${item.code}`;
      const isMenuOpen = state.watchlistMenuKey === menuKey;

      return (
        `<tr class="clickable" data-wl-open-stock="${esc(item.code)}">` +
        `<td><b>${esc(item.code)}</b> <span class="cell-muted">${esc(item.name)}</span>${isUs ? ' <span class="tag" style="margin-left:4px">US</span>' : ''}${item.inAuto ? ' <span class="tag good" style="margin-left:6px">自動分析中</span>' : ''}</td>` +
        `<td>${
          hasVal
            ? `<div class="wl-price-cell"><strong class="${dirCls}">${isUs ? '$' : ''}${fmt(q.price, dp)}</strong> <span class="wl-chg ${dirCls}">${arrow} ${pp(q.change, 2)} (${pp(q.changePct, 2)}%)</span></div>`
            : '<span class="mini">尚未更新報價</span>'
        }</td>` +
        `<td>${renderCustomValuationCell(item, q)}</td>` +
        `<td style="text-align:right"><button type="button" class="btn sm wl-more-btn ${isMenuOpen ? 'main' : ''}" data-wl-menu-toggle="${esc(menuKey)}" title="更多功能（價值估算／自動分析／刪除）">...</button></td>` +
        '</tr>' +
        (isMenuOpen ? renderRowMenuDrawer(folder, item) : '')
      );
    })
    .join('');

  return (
    '<div class="card">' +
    folderTools +
    '<div class="tblwrap"><table><thead><tr>' +
    '<th>股票代號／名稱</th><th>最新股價與漲跌幅</th><th>價值估算</th><th style="width:76px;text-align:right">功能</th>' +
    '</tr></thead><tbody>' +
    rowsHtml +
    '</tbody></table></div>' +
    '</div>'
  );
}

function renderDimToneTag(label, tone) {
  const cls = tone === 'up' ? 'tw-up-bg' : tone === 'down' ? 'tw-down-bg' : '';
  return `<div class="wl-dim-box ${cls}"><div class="wl-dim-label">${esc(label)}</div>`;
}

function renderAutoAnalysisTab() {
  const cfg = state.watchlistConfig || {};
  const autoMeta = cfg.autoStockMeta || [];
  const analysis = state.watchlistAnalysis;
  const counts = analysis?.counts || {};
  const analyzedItems = analysis?.items || [];
  const byCode = new Map(analyzedItems.map(x => [x.code, x]));

  const pills = [
    ['all', '全部', autoMeta.length],
    ['belowMa5', '低於 5 日線', counts.belowMa5 || 0],
    ['belowMa10', '低於 10 日線', counts.belowMa10 || 0],
    ['tdccBuy', '大戶買超', counts.tdccBuy || 0],
    ['tdccSell', '大戶賣超', counts.tdccSell || 0],
    ['instBuy', '法人買超', counts.instBuy || 0],
    ['instSell', '法人賣超', counts.instSell || 0],
    ['divergence', '籌碼背離提醒', counts.divergence || 0]
  ];

  const filterBar =
    '<div class="wl-filter-bar">' +
    pills
      .map(
        ([key, lbl, cnt]) =>
          `<button type="button" class="topic-chip ${state.watchlistFilter === key ? 'active' : ''}" data-wl-filter="${key}">${esc(lbl)} <b>${cnt}</b></button>`
      )
      .join('') +
    '</div>';

  const statusHead =
    '<div class="card" style="padding:14px 18px;margin-bottom:16px">' +
    '<div class="feed-bar">' +
    '<div class="feed-meta">' +
    `<span>獨立自動分析清單：<b>${autoMeta.length}</b> 檔</span>` +
    (analysis
      ? `<span>最近分析：<b>${esc(analysis.generatedAt)}</b> · ${esc(analysis.trigger)}</span>`
      : '<span>尚未產出自動分析報告，點擊右側「立即更新分析」即可生成</span>') +
    '</div>' +
    `<button type="button" class="btn main sm" id="runAutoAnalysisBtn"${state.watchlistAnalysisBusy ? ' disabled' : ''}>${state.watchlistAnalysisBusy ? '分析計算中...' : '⚡ 立即更新分析'}</button>` +
    '</div>' +
    (autoMeta.length ? filterBar : '') +
    '</div>';

  if (!autoMeta.length) {
    return (
      statusHead +
      '<div class="card"><div class="empty"><b>自動分析收藏夾目前為空</b>請於任意自訂收藏夾的「...」選單中點選「加入自動分析」（或於篩選／個股頁 ★ 收藏面板加入），系統將於每日 10:00 與手動更新時自動檢核 6 大技術與籌碼維度。</div></div>'
    );
  }

  const filter = state.watchlistFilter || 'all';
  const cards = autoMeta
    .map(meta => {
      const it = byCode.get(meta.code);
      if (!it) {
        if (filter !== 'all') return '';
        return (
          '<div class="card wl-ana-card" style="margin-bottom:14px">' +
          '<div class="splithead">' +
          `<div><h3 class="clickable" data-wl-open-stock="${esc(meta.code)}">${esc(meta.code)} ${esc(meta.name)}</h3><div class="mini">已加入自動分析，尚未執行本次掃描</div></div>` +
          `<div class="toolbar" style="margin:0"><button type="button" class="btn sm" data-wl-open-stock="${esc(meta.code)}">查看個股 →</button><button type="button" class="btn danger sm" data-wl-toggle-auto="${esc(meta.code)}">移出自動分析</button></div>` +
          '</div></div>'
        );
      }
      if (filter !== 'all' && !(it.filterFlags || []).includes(filter)) {
        return '';
      }
      if (it.error) {
        return (
          '<div class="card wl-ana-card" style="margin-bottom:14px">' +
          '<div class="splithead">' +
          `<div><h3 class="clickable" data-wl-open-stock="${esc(it.code)}">${esc(it.code)} ${esc(it.name)}</h3><div class="mini">${esc(it.error)}</div></div>` +
          `<button type="button" class="btn danger sm" data-wl-toggle-auto="${esc(it.code)}">移出自動分析</button>` +
          '</div></div>'
        );
      }

      const isUs = it.isTw === false || isUsSymbol(it.code, it.market);
      const dp = isUs ? 2 : it.price < 150 ? 2 : 1;
      const pfx = isUs ? '$' : '';
      const cls = it.change > 0 ? 'tw-up' : it.change < 0 ? 'tw-down' : 'wl-pnl-flat';
      const arrow = it.change > 0 ? '▲' : it.change < 0 ? '▼' : '';
      const ov = it.overall || {};
      const ovType = ov.tone === 'up' ? 'good' : ov.tone === 'down' ? 'bad' : 'warn';

      const sMa = it.shortMa || {};
      const mMa = it.midMa || {};
      const td = it.tdcc || {};
      const inst = it.inst || {};
      const vol = it.volume || {};
      const mg = it.margin || {};
      const rsi = it.rsi || {};
      const macd = it.macd || {};
      const r52 = it.range52w || {};

      const dimsHtml = isUs
        ? '<div class="wl-dim-grid">' +
          renderDimToneTag('1. 短均位階 (MA5 / MA10)', sMa.tone) +
          `<div class="wl-dim-val">${esc(sMa.status)}</div>` +
          `<div class="wl-dim-sub">MA5 ${sMa.ma5 != null ? `$${fmt(sMa.ma5, 2)} (${pp(sMa.bias5Pct, 2)}%)` : '—'} · MA10 ${sMa.ma10 != null ? `$${fmt(sMa.ma10, 2)} (${pp(sMa.bias10Pct, 2)}%)` : '—'}</div></div>` +
          renderDimToneTag('2. 中長趨勢 (MA20 / MA60 / MA200)', mMa.tone) +
          `<div class="wl-dim-val">${esc(mMa.status)}</div>` +
          `<div class="wl-dim-sub">月線 ${mMa.ma20 != null ? '$' + fmt(mMa.ma20, 2) : '—'} · 季線 ${mMa.ma60 != null ? '$' + fmt(mMa.ma60, 2) : '—'} · 年線 ${mMa.ma200 != null ? '$' + fmt(mMa.ma200, 2) : '—'}</div></div>` +
          renderDimToneTag('3. RSI(14) 動能指標', rsi.tone) +
          `<div class="wl-dim-val">${esc(rsi.status || '—')}</div>` +
          '<div class="wl-dim-sub">70 以上超買警戒 · 30 以下超賣觀察</div></div>' +
          renderDimToneTag('4. MACD (12, 26, 9)', macd.tone) +
          `<div class="wl-dim-val">${esc(macd.status || '—')}</div>` +
          `<div class="wl-dim-sub">DIF ${macd.dif != null ? pp(macd.dif, 2) : '—'} · DEA ${macd.dea != null ? pp(macd.dea, 2) : '—'} · 柱 ${macd.hist != null ? pp(macd.hist, 2) : '—'}</div></div>` +
          renderDimToneTag('5. 量價配合 (vs MV5)', vol.tone) +
          `<div class="wl-dim-val">${esc(vol.status)}</div>` +
          `<div class="wl-dim-sub">${vol.mv5 != null ? `今日 ${fmtUsShares(vol.vol)} / 5日均量 ${fmtUsShares(vol.mv5)}` : '—'}</div></div>` +
          renderDimToneTag('6. 52 週區間位階', r52.tone) +
          `<div class="wl-dim-val">${esc(r52.status || '—')}</div>` +
          `<div class="wl-dim-sub">${r52.high != null ? `區間 $${fmt(r52.low, 2)}–$${fmt(r52.high, 2)} · 距高點 ${pp(r52.fromHighPct, 2)}%` : '—'}</div></div>` +
          '</div>'
        : '<div class="wl-dim-grid">' +
          renderDimToneTag('1. 短均位階 (MA5 / MA10)', sMa.tone) +
          `<div class="wl-dim-val">${esc(sMa.status)}</div>` +
          `<div class="wl-dim-sub">MA5 ${sMa.ma5 != null ? `${fmt(sMa.ma5, dp)} (${pp(sMa.bias5Pct, 2)}%)` : '—'} · MA10 ${sMa.ma10 != null ? `${fmt(sMa.ma10, dp)} (${pp(sMa.bias10Pct, 2)}%)` : '—'}</div></div>` +
          renderDimToneTag('2. 中期趨勢 (MA20 / MA60)', mMa.tone) +
          `<div class="wl-dim-val">${esc(mMa.status)}</div>` +
          `<div class="wl-dim-sub">月線 ${mMa.ma20 != null ? fmt(mMa.ma20, dp) : '—'} · 季線 ${mMa.ma60 != null ? fmt(mMa.ma60, dp) : '—'}</div></div>` +
          renderDimToneTag('3. TDCC 大戶 (400張週變化)', td.tone) +
          `<div class="wl-dim-val">${esc(td.status)} ${td.deltaPp400 != null ? pp(td.deltaPp400, 3) + ' pp' : ''}</div>` +
          `<div class="wl-dim-sub">${td.weekDay ? `${esc(td.weekDay)} 占比 ${fmt(td.pct400, 2)}% · 千張 ${pp(td.deltaPp1000, 3)} pp` : '尚無近期集保週比較'}</div></div>` +
          renderDimToneTag('4. 三大法人買賣超 (近5日)', inst.tone) +
          `<div class="wl-dim-val">${esc(inst.status)}${inst.inst5Total != null ? ` ${pp(inst.inst5Total, 0)} 張` : ''}</div>` +
          `<div class="wl-dim-sub">${inst.inst5Total != null ? `外資 ${pp(inst.foreign5, 0)} · 投信 ${pp(inst.trust5, 0)} · 最新日 ${pp(inst.lastTotal, 0)}` : esc(inst.status)}</div></div>` +
          renderDimToneTag('5. 量價配合 (vs MV5)', vol.tone) +
          `<div class="wl-dim-val">${esc(vol.status)}</div>` +
          `<div class="wl-dim-sub">${vol.mv5 != null ? `今日 ${fmt(vol.vol)} 張 / 5日均量 ${fmt(vol.mv5)} 張` : '—'}</div></div>` +
          renderDimToneTag('6. 融資融券變化 (近5日)', mg.tone) +
          `<div class="wl-dim-val">${esc(mg.status)}</div>` +
          `<div class="wl-dim-sub">${mg.marginBal != null ? `融資餘 ${fmt(mg.marginBal)} 張 · 券資比 ${fmt(mg.shortMarginRatio, 2)}%` : esc(mg.status)}</div></div>` +
          '</div>';

      return (
        '<div class="card wl-ana-card" style="margin-bottom:14px">' +
        '<div class="splithead">' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        `<h3 class="clickable" data-wl-open-stock="${esc(it.code)}" style="margin:0;cursor:pointer">${esc(it.code)} ${esc(it.name)}</h3>` +
        (isUs ? badge('US', '') : '') +
        `<span class="${cls}" style="font-weight:700;font-variant-numeric:tabular-nums">${pfx}${fmt(it.price, dp)} (${arrow} ${pp(it.changePct, 2)}%)</span>` +
        `<span class="mini">${esc(it.tradeDate || '')}</span>` +
        badge(ov.label || '檢核完成', ovType) +
        (ov.divergenceAlert ? badge(ov.divergenceAlert, 'warn') : '') +
        '</div>' +
        '<div class="toolbar" style="margin:0">' +
        `<button type="button" class="btn sm" data-wl-open-stock="${esc(it.code)}">整合個股檢視 →</button>` +
        `<button type="button" class="btn danger sm" data-wl-toggle-auto="${esc(it.code)}">移出自動分析</button>` +
        '</div>' +
        '</div>' +
        dimsHtml +
        `<div class="verdict-box" style="margin-top:10px"><b>綜合判斷：</b>${esc(ov.summary || '')}</div>` +
        '</div>'
      );
    })
    .filter(Boolean)
    .join('');

  return (
    statusHead +
    (cards || '<div class="card"><div class="empty">目前快篩條件下無符合股票，請點選「全部」切換。</div></div>')
  );
}

function watchlistPage() {
  const cfg = state.watchlistConfig || {};
  const folders = cfg.folders || [];
  const autoCount = (cfg.autoStocks || []).length;
  const activeTab = state.watchlistActiveTab === 'auto'
    ? 'auto'
    : folders.some(f => f.id === state.watchlistActiveTab)
      ? state.watchlistActiveTab
      : folders[0]?.id || 'auto';

  const enabled = cfg.autoEnabled !== false;
  const headerActions =
    '<div class="brief-controls">' +
    `<label class="switch-wrap" title="獨立開關每日台灣時間 10:00 自動分析收藏清單">` +
    `<input type="checkbox" id="toggleAutoWatchlist" ${enabled ? 'checked' : ''}>` +
    '<span class="switch-track"><span class="switch-thumb"></span></span>' +
    `<span class="switch-label">${enabled ? '10:00 自動分析：開啟' : '10:00 自動分析：已關閉'}</span>` +
    '</label>' +
    `<button type="button" class="btn main" id="refreshWatchlistPricesBtn"${state.watchlistPriceBusy ? ' disabled' : ''}>${state.watchlistPriceBusy ? '更新報價中...' : '↻ 一鍵更新股價'}</button>` +
    `<button type="button" class="btn" id="createFolderBtn">+ 新增收藏夾</button>` +
    '</div>';

  const createFolderPanel = state.watchlistCreatingFolder
    ? '<div class="card" style="padding:14px 16px;margin-bottom:16px">' +
      '<div class="toolbar" style="margin:0">' +
      '<input id="newFolderNameInput" placeholder="輸入新收藏夾名稱（如：半導體波段、高股息存股）" maxlength="30" style="width:320px">' +
      '<button type="button" class="btn main sm" id="saveNewFolderBtn">建立收藏夾</button>' +
      '<button type="button" class="btn sm" id="cancelNewFolderBtn">取消</button>' +
      '</div></div>'
    : '';

  const tabsBar =
    '<div class="wl-tabs-row">' +
    folders
      .map(
        f =>
          `<button type="button" class="wl-tab ${activeTab === f.id ? 'active' : ''}" data-wl-tab="${esc(f.id)}">` +
          `<span>${esc(f.name)}</span><span class="wl-tab-cnt">${(f.items || []).length}</span></button>`
      )
      .join('') +
    `<button type="button" class="wl-tab wl-tab-auto ${activeTab === 'auto' ? 'active' : ''}" data-wl-tab="auto">` +
    `<span>✦ 自動分析</span><span class="wl-tab-cnt">${autoCount}</span></button>` +
    '</div>';

  const errNotice = state.watchlistError
    ? `<div class="notice warn" style="margin-bottom:14px">${esc(state.watchlistError)}</div>`
    : '';

  const activeFolder = folders.find(f => f.id === activeTab);
  const contentHtml =
    activeTab === 'auto'
      ? renderAutoAnalysisTab()
      : activeFolder
        ? renderCustomWatchlistTab(activeFolder)
        : '<div class="card"><div class="empty">請先建立一個收藏夾</div></div>';

  return (
    title(
      '股票收藏夾 ＆ 自動分析',
      '市值／損益估算；隔離保存於 %LOCALAPPDATA%\\ChipScreener\\user-v1\\watchlists.json。',
      headerActions
    ) +
    createFolderPanel +
    tabsBar +
    errNotice +
    contentHtml
  );
}

// === pages/us-market.js ===
/**
 * 美股全站頁面模組：
 * 1. 美股總覽 (us_home)：四大指數、美債10Y殖利率、VIX、板塊強弱與領漲領跌榜
 * 2. 美股板塊篩選 (us_screen)：32 檔旗艦美股與熱門 ETF，支援板塊與技術條件快篩
 * 3. 美股個股詳情 (us_stock)：任意美股 2 年日/週/月 K 線（含 MA5/10/20/60/200）、RSI(14)、MACD(12,26,9)、52 週位階與 USD 持股成本損益
 * 配色統一採用台股「紅漲綠跌」習慣。
 */

function renderUsSubChart(tech) {
  const tab = state.usSubTab || 'macd';
  const macd = tech.macdSeries || {};
  const datesArr = macd.dates || [];
  if (!datesArr.length) {
    return '<div class="empty">暫無足夠交易日計算技術副圖</div>';
  }

  if (tab === 'rsi') {
    const arr = tech.rsiSeries || [];
    const pts = arr
      .map((v, i) => {
        if (v === null || v === undefined) return null;
        const x = 44 + (i / Math.max(1, arr.length - 1)) * 716;
        const y = 14 + ((100 - v) / 100) * 116;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter(Boolean)
      .join(' ');
    const lastRsi = tech.rsi?.value;
    const y70 = 14 + (30 / 100) * 116;
    const y30 = 14 + (70 / 100) * 116;
    return (
      '<div class="statbar" style="margin-top:0;margin-bottom:12px">' +
      `<div><span class="mini">最新 RSI(14)</span><strong class="${lastRsi >= 55 ? 'tw-up' : lastRsi <= 45 ? 'tw-down' : ''}">${lastRsi != null ? fmt(lastRsi, 2) : '—'}</strong><span class="mini">${esc(tech.rsi?.status || '')}</span></div>` +
      '<div><span class="mini">超買警戒線</span><strong>70.0</strong><span class="mini">短線過熱參考</span></div>' +
      '<div><span class="mini">超賣觀察線</span><strong>30.0</strong><span class="mini">低檔反彈參考</span></div>' +
      '</div>' +
      '<svg viewBox="0 0 780 156" class="plot" role="img" aria-label="RSI 14 動能走勢圖">' +
      '<rect class="plot-bg" x="40" y="10" width="728" height="124" rx="8"/>' +
      `<rect x="40" y="${y70.toFixed(1)}" width="728" height="${(y30 - y70).toFixed(1)}" fill="rgba(59,130,246,0.06)"/>` +
      `<line class="gridline" x1="40" x2="768" y1="${y70.toFixed(1)}" y2="${y70.toFixed(1)}" stroke-dasharray="4 4"/>` +
      `<line class="gridline" x1="40" x2="768" y1="${y30.toFixed(1)}" y2="${y30.toFixed(1)}" stroke-dasharray="4 4"/>` +
      `<text class="axis" x="35" y="${(y70 + 4).toFixed(1)}" text-anchor="end">70</text>` +
      `<text class="axis" x="35" y="${(y30 + 4).toFixed(1)}" text-anchor="end">30</text>` +
      (pts ? `<polyline fill="none" stroke="#38bdf8" stroke-width="2" points="${pts}"/>` : '') +
      `<text class="axis" x="44" y="148">${esc(datesArr[0])}</text>` +
      `<text class="axis" text-anchor="end" x="764" y="148">${esc(datesArr.at(-1))}</text>` +
      '</svg>'
    );
  }

  // MACD (12, 26, 9)
  const dif = macd.dif || [];
  const dea = macd.dea || [];
  const hist = macd.hist || [];
  const allVals = [...dif, ...dea, ...hist].filter(v => typeof v === 'number');
  const maxAbs = Math.max(...allVals.map(v => Math.abs(v)), 0.1);
  const Y = v => 72 - (v / maxAbs) * 56;
  const slotW = 720 / Math.max(1, datesArr.length);

  const histBars = hist
    .map((v, i) => {
      if (typeof v !== 'number') return '';
      const x = 44 + i * slotW + slotW * 0.18;
      const bw = Math.max(3, slotW * 0.64);
      const h = (Math.abs(v) / maxAbs) * 56;
      const y = v >= 0 ? 72 - h : 72;
      const fill = v >= 0 ? '#ef4444' : '#22c55e';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.2, h).toFixed(1)}" fill="${fill}" opacity="0.82" rx="1"><title>${datesArr[i]} 柱狀 ${pp(v, 3)}</title></rect>`;
    })
    .join('');

  const buildLine = arr =>
    arr
      .map((v, i) => (typeof v === 'number' ? `${(44 + i * slotW + slotW / 2).toFixed(1)},${Y(v).toFixed(1)}` : null))
      .filter(Boolean)
      .join(' ');

  const difPts = buildLine(dif);
  const deaPts = buildLine(dea);
  const m = tech.macd || {};

  return (
    '<div class="statbar" style="margin-top:0;margin-bottom:12px">' +
    `<div><span class="mini">DIF (快線)</span><strong class="${(m.dif || 0) >= 0 ? 'tw-up' : 'tw-down'}">${m.dif != null ? pp(m.dif, 3) : '—'}</strong><span class="mini">EMA12 - EMA26</span></div>` +
    `<div><span class="mini">DEA (慢線)</span><strong>${m.dea != null ? pp(m.dea, 3) : '—'}</strong><span class="mini">9 日訊號線</span></div>` +
    `<div><span class="mini">MACD 柱狀體</span><strong class="${(m.hist || 0) >= 0 ? 'tw-up' : 'tw-down'}">${m.hist != null ? pp(m.hist, 3) : '—'}</strong><span class="mini">${esc(m.status || '')}</span></div>` +
    '</div>' +
    '<svg viewBox="0 0 780 156" class="plot" role="img" aria-label="MACD 指標圖">' +
    '<rect class="plot-bg" x="40" y="10" width="728" height="124" rx="8"/>' +
    '<line class="gridline" x1="40" x2="768" y1="72" y2="72"/>' +
    `<text class="axis" x="36" y="20" text-anchor="end">+${fmt(maxAbs, 1)}</text>` +
    '<text class="axis" x="36" y="75" text-anchor="end">0</text>' +
    `<text class="axis" x="36" y="132" text-anchor="end">-${fmt(maxAbs, 1)}</text>` +
    histBars +
    (difPts ? `<polyline fill="none" stroke="#eab308" stroke-width="1.8" points="${difPts}"/>` : '') +
    (deaPts ? `<polyline fill="none" stroke="#60a5fa" stroke-width="1.6" points="${deaPts}"/>` : '') +
    `<text class="axis" x="44" y="148">${esc(datesArr[0])}（黃 DIF · 藍 DEA · 紅綠柱）</text>` +
    `<text class="axis" text-anchor="end" x="764" y="148">${esc(datesArr.at(-1))}</text>` +
    '</svg>'
  );
}

function renderUsMoversTable(rows, emptyText) {
  if (!rows?.length) {
    return `<div class="empty">${esc(emptyText)}</div>`;
  }
  return (
    '<div class="tblwrap"><table><thead><tr>' +
    '<th>代號／名稱</th><th>板塊</th><th>現價 (USD)</th><th>漲跌幅</th><th>RSI(14)</th><th style="width:46px;text-align:center">收藏</th>' +
    '</tr></thead><tbody>' +
    rows
      .map(r => {
        const cls = r.change > 0 ? 'tw-up' : r.change < 0 ? 'tw-down' : 'wl-pnl-flat';
        const arrow = r.change > 0 ? '▲' : r.change < 0 ? '▼' : '';
        const inFav = typeof isStockInAnyFolder === 'function' && isStockInAnyFolder(r.code);
        return (
          `<tr class="clickable" data-us-stock="${esc(r.code)}">` +
          `<td><b>${esc(r.code)}</b> <span class="cell-muted">${esc(r.name)}</span></td>` +
          `<td>${badge(r.sector, '')}</td>` +
          `<td style="font-variant-numeric:tabular-nums"><b>$${fmt(r.price, 2)}</b></td>` +
          `<td class="${cls}" style="font-variant-numeric:tabular-nums;font-weight:700">${arrow} ${pp(r.changePct, 2)}%</td>` +
          `<td style="font-variant-numeric:tabular-nums">${r.rsi14 != null ? fmt(r.rsi14, 1) : '—'}</td>` +
          `<td style="text-align:center"><button type="button" class="btn-fav ${inFav ? 'on' : ''}" data-quick-fav="${esc(r.code)}" title="加入股票收藏夾">${inFav ? '★' : '☆'}</button></td>` +
          '</tr>'
        );
      })
      .join('') +
    '</tbody></table></div>'
  );
}

function usHomePage() {
  const ov = state.usOverview;
  const headerActions =
    '<div class="brief-controls">' +
    '<div class="toolbar" style="margin:0">' +
    '<input id="usQuickSearchInput" autocomplete="off" data-stock-suggest="US" data-suggest-submit="usQuickSearchBtn" placeholder="輸入美股代號或名稱（如 NVDA、輝達、SPY）" style="width:280px">' +
    '<button type="button" class="btn main" id="usQuickSearchBtn">查詢美股</button>' +
    '</div>' +
    `<button type="button" class="btn sm" id="refreshUsOverviewBtn"${state.usOverviewLoading ? ' disabled' : ''}>${state.usOverviewLoading ? '更新中...' : '↻ 重新抓取'}</button>` +
    '</div>';

  const head = title(
    '美股市場總覽',
    '涵蓋美股四大指數、美債殖利率、VIX 恐慌指數與 32 檔旗艦板塊焦點（統一紅漲綠跌，來源：Yahoo Finance）。',
    headerActions
  );

  if (state.usOverviewLoading && !ov) {
    return head + '<div class="card"><div class="empty"><b>正在載入美股主要指數與 32 檔旗艦板塊資料...</b>首次抓取約需 3～6 秒，之後將啟用本機快取</div></div>';
  }
  if (state.usOverviewError && !ov) {
    return head + `<div class="card"><div class="empty"><b>無法載入美股總覽</b>${esc(state.usOverviewError)}</div></div>`;
  }
  if (!ov) {
    return head + '<div class="card"><div class="empty">點擊右上角「↻ 重新抓取」載入美股最新市場快照</div></div>';
  }

  const idxCards = (ov.indices || [])
    .map(idx => {
      const hasVal = typeof idx.price === 'number';
      const cls = !hasVal ? '' : idx.change > 0 ? 'tw-up' : idx.change < 0 ? 'tw-down' : 'wl-pnl-flat';
      const arrow = !hasVal ? '' : idx.change > 0 ? '▲' : idx.change < 0 ? '▼' : '';
      return (
        '<div class="index-card">' +
        `<div class="idx-head"><span>${esc(idx.name)}</span><span class="mini">${esc(idx.tag)}</span></div>` +
        `<div class="idx-price ${cls}">${hasVal ? fmt(idx.price, 2) : '—'}</div>` +
        `<div class="idx-chg ${cls}">${hasVal ? `${arrow} ${pp(idx.change, 2)} (${pp(idx.changePct, 2)}%)` : '暫無報價'}</div>` +
        '</div>'
      );
    })
    .join('');

  const scrSynced = state.usScreener?.counts && (state.usScreener.count || 0) >= (ov.universeCount || 0);
  const counts = scrSynced ? state.usScreener.counts : (ov.counts || {});
  const totalCount = scrSynced ? state.usScreener.count : (ov.universeCount || counts.total || 0);
  const isOvScanning = Boolean((scrSynced ? state.usScreener.scanning : ov.scanning));
  const scanProg = scrSynced ? state.usScreener.progress : ov.progress;
  const ovSectors = (scrSynced && state.usScreener.sectors?.length ? state.usScreener.sectors.slice(0, 8) : ov.sectors) || [];

  const sectorCardsSynced = ovSectors
    .map(s => {
      const cls = s.avgChangePct > 0 ? 'tw-up' : s.avgChangePct < 0 ? 'tw-down' : 'wl-pnl-flat';
      return (
        `<div class="card metric clickable" data-us-jump-sector="${esc(s.name)}" style="cursor:pointer">` +
        `<span class="label">${esc(s.name)}（${s.count} 檔）</span>` +
        `<div class="value ${cls}">${pp(s.avgChangePct, 2)}%</div>` +
        `<span class="foot">紅盤 ${s.upCount} 檔 · 綠盤 ${s.downCount} 檔 · 點擊進篩選 →</span>` +
        '</div>'
      );
    })
    .join('');

  const scanHintText = isOvScanning && scanProg
    ? `背景掃描中 ${scanProg.done}/${scanProg.total} 檔，完成後將自動對齊全數`
    : '與「美股全市場篩選」即時同步相同母體數量 · 點擊直接前往';

  const dualQuickBanner =
    '<div class="us-mode-tabs" style="margin-bottom:20px">' +
    `<button type="button" class="us-mode-card active smart" data-us-jump-mode="smart">` +
    `<div class="us-mode-card-top"><span>機構資金吸籌篩選</span><span class="us-score-pill tw-up">${counts.smartMoney ?? '—'} 檔</span></div>` +
    '<div class="us-mode-card-sub">CMF(20) 資金淨流入 · 20日買賣量比佔優 · 站穩月線吸籌</div></button>' +
    `<button type="button" class="us-mode-card active dip" data-us-jump-mode="dip">` +
    `<div class="us-mode-card-top"><span>超跌估值修正篩選</span><span class="us-score-pill tw-down">${counts.dipBuy ?? '—'} 檔</span></div>` +
    '<div class="us-mode-card-sub">S&amp;P 500 權值回檔 ≥ 12% · RSI 超賣或觸布林下軌</div></button>' +
    `<button type="button" class="us-mode-card active all" data-us-jump-mode="all">` +
    `<div class="us-mode-card-top"><span>S&amp;P 500 全市場標的</span><span class="us-score-pill">${totalCount ? fmt(totalCount) : '—'} 檔</span></div>` +
    '<div class="us-mode-card-sub">完整 11 大 GICS 產業與技術快篩 · 一鍵匯出 CSV</div></button>' +
    '</div>';

  return (
    head +
    `<div class="section" style="margin-top:0"><h2>美股大盤、債市與波動指標</h2><span class="mini">更新時間 ${esc(ov.updatedAt)} · 統一紅漲綠跌</span></div>` +
    `<div class="index-grid" style="margin-bottom:22px">${idxCards}</div>` +
    `<div class="section"><h2>美股全市場雙模式篩選捷徑（S&amp;P 500）</h2><span class="mini">${esc(scanHintText)}</span></div>` +
    dualQuickBanner +
    '<div class="section"><h2>GICS 產業強弱概覽（點擊直接篩選）</h2><span class="mini">計算各產業代表標的當日平均漲跌幅</span></div>' +
    `<div class="metricgrid">${sectorCardsSynced}</div>` +
    '<div class="grid2 equal">' +
    '<div class="card">' +
    cardhead('今日領漲焦點（Top 5）', '點擊股票列檢視完整 K 線、MA200、RSI 與 MACD', '<button type="button" class="btn sm" data-nav="us_screen">前往 S&amp;P 500 篩選 →</button>') +
    renderUsMoversTable(ov.leaders, '暫無資料') +
    '</div>' +
    '<div class="card">' +
    cardhead('今日弱勢／回檔觀察（Top 5）', '搭配 RSI 與 52 週位階判斷低檔支撐', '<button type="button" class="btn sm" data-nav="watchlist">前往收藏夾 →</button>') +
    renderUsMoversTable(ov.laggards, '暫無資料') +
    '</div>' +
    '</div>'
  );
}

function getFilteredUsScreenerRows() {
  const scr = state.usScreener;
  const allRows = scr?.rows || [];
  const mode = state.usScreenerMode || 'smart';
  const q = (state.usQuery || '').trim().toLowerCase();
  const sec = state.usSector || 'ALL';
  const flt = state.usFilter || 'all';

  let rows = allRows.filter(r => {
    if (mode === 'smart' && !r.smartPass) return false;
    if (mode === 'dip' && !r.dipPass) return false;
    if (sec !== 'ALL' && r.sector !== sec) return false;
    if (q && !(r.code + ' ' + r.name + ' ' + r.sector).toLowerCase().includes(q)) return false;
    if (flt !== 'all' && !(r.flags || []).includes(flt)) return false;
    return true;
  });

  const sortMode = state.usSort || 'scoreDesc';
  rows = [...rows].sort((a, b) => {
    if (sortMode === 'scoreDesc') {
      if (mode === 'smart') return (b.smartScore ?? 0) - (a.smartScore ?? 0) || (b.cmf20 ?? -9) - (a.cmf20 ?? -9);
      if (mode === 'dip') return (b.dipScore ?? 0) - (a.dipScore ?? 0) || (a.rsi14 ?? 99) - (b.rsi14 ?? 99);
      return b.changePct - a.changePct;
    }
    if (sortMode === 'chgDesc') return b.changePct - a.changePct;
    if (sortMode === 'chgAsc') return a.changePct - b.changePct;
    if (sortMode === 'cmfDesc') return (b.cmf20 ?? -9) - (a.cmf20 ?? -9);
    if (sortMode === 'rsiAsc') return (a.rsi14 ?? 999) - (b.rsi14 ?? 999);
    if (sortMode === 'rsiDesc') return (b.rsi14 ?? -1) - (a.rsi14 ?? -1);
    if (sortMode === 'fromHighAsc') return (a.fromHighPct ?? 0) - (b.fromHighPct ?? 0);
    if (sortMode === 'volRatio') return (b.volRatio ?? 0) - (a.volRatio ?? 0);
    if (sortMode === 'code') return a.code.localeCompare(b.code);
    return b.changePct - a.changePct;
  });
  return rows;
}

function renderUsReasonTags(reasons, tone) {
  if (!reasons?.length) return '<span class="mini">—</span>';
  const cls = tone === 'smart' ? 'good' : tone === 'dip' ? 'warn' : '';
  return `<div class="us-reason-list">${reasons.slice(0, 3).map(t => badge(t, cls)).join('')}</div>`;
}

function usScreenPage() {
  const scr = state.usScreener;
  const mode = state.usScreenerMode || 'smart';
  const isScanning = Boolean(scr?.scanning);
  const done = scr?.progress?.done || scr?.count || 0;
  const total = scr?.progress?.total || scr?.universeTotal || 512;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  const headerActions =
    '<div class="brief-controls">' +
    '<div class="toolbar" style="margin:0">' +
    '<input id="usDirectCodeInput" autocomplete="off" data-stock-suggest="US" data-suggest-submit="usDirectCodeBtn" placeholder="查任意美股或名稱（如 COIN、輝達）" style="width:245px">' +
    '<button type="button" class="btn main sm" id="usDirectCodeBtn">前往詳情</button>' +
    '</div>' +
    `<button type="button" class="btn sm" id="refreshUsScreenerBtn"${state.usScreenerLoading || isScanning ? ' disabled' : ''}>${isScanning ? `掃描中 ${done}/${total}` : state.usScreenerLoading ? '啟動中...' : '↻ 重新掃描 S&P 500'}</button>` +
    '</div>';

  const head = title(
    '美股全市場篩選（S&amp;P 500）',
    '以 503 檔 S&P 500 成分股（含 9 檔指標 ADR/ETF）為母體，提供「機構資金吸籌」與「超跌估值修正」雙模式量化篩選。',
    headerActions
  );

  if (state.usScreenerLoading && !scr) {
    return head + '<div class="card"><div class="empty"><b>正在啟動 S&amp;P 500 全市場掃描引擎...</b>前 36 檔旗艦代表將於 2 秒內先行載入，其餘成分股於背景漸進更新</div></div>';
  }
  if (state.usScreenerError && !scr) {
    return head + `<div class="card"><div class="empty"><b>美股全市場篩選載入失敗</b>${esc(state.usScreenerError)}</div></div>`;
  }

  const allRows = scr?.rows || [];
  const counts = scr?.counts || {
    total: allRows.length,
    smartMoney: allRows.filter(x => x.smartPass).length,
    dipBuy: allRows.filter(x => x.dipPass).length
  };
  const rows = getFilteredUsScreenerRows();
  state.usShowList = rows;

  const limit = 50;
  const pages = Math.ceil(rows.length / limit);
  if (state.usPageNum >= pages && pages > 0) state.usPageNum = pages - 1;
  if (state.usPageNum < 0) state.usPageNum = 0;
  const pageItems = rows.slice(state.usPageNum * limit, (state.usPageNum + 1) * limit);

  const scanBar = isScanning
    ? '<div class="us-scan-bar">' +
      `<div class="us-scan-bar-head"><span><b>正在背景漸進掃描 S&amp;P 500 全市場...</b>（已完成 ${fmt(done)} / ${fmt(total)} 檔，下方達標名單將即時自動更新）</span><b>${pct}%</b></div>` +
      `<div class="us-scan-track"><div class="us-scan-fill" style="width:${Math.max(4, pct)}%"></div></div>` +
      '</div>'
    : '';

  const modeCards =
    '<div class="us-mode-tabs">' +
    `<button type="button" class="us-mode-card ${mode === 'smart' ? 'active smart' : ''}" data-us-mode="smart">` +
    `<div class="us-mode-card-top"><span>機構資金吸籌</span><span class="us-score-pill ${mode === 'smart' ? 'tw-up' : ''}">${fmt(counts.smartMoney)} 檔</span></div>` +
    '<div class="us-mode-card-sub">CMF(20) ≥ +0.05 · 買賣量比 ≥ 1.2x · 站穩月線且吸籌評分 ≥ 55</div></button>' +
    `<button type="button" class="us-mode-card ${mode === 'dip' ? 'active dip' : ''}" data-us-mode="dip">` +
    `<div class="us-mode-card-top"><span>超跌估值修正</span><span class="us-score-pill ${mode === 'dip' ? 'tw-down' : ''}">${fmt(counts.dipBuy)} 檔</span></div>` +
    '<div class="us-mode-card-sub">距 52 週高點 ≤ -12% · RSI ≤ 38 或布林下軌且評分 ≥ 50</div></button>' +
    `<button type="button" class="us-mode-card ${mode === 'all' ? 'active all' : ''}" data-us-mode="all">` +
    `<div class="us-mode-card-top"><span>S&amp;P 500 全部標的</span><span class="us-score-pill">${fmt(counts.total)} 檔</span></div>` +
    '<div class="us-mode-card-sub">檢視完整已掃描母體，自由搭配 11 大 GICS 產業與技術快篩</div></button>' +
    '</div>';

  const ruleText =
    mode === 'smart'
      ? '<b>機構資金吸籌規則：</b>篩選 20 日資金流向 <code>CMF(20) ≥ +0.05</code>、20 日買盤／賣盤成交量比 <code>≥ 1.20x</code>、收盤站上 <code>MA20 月線</code> 且綜合吸籌評分 <code>≥ 55</code> 之 S&amp;P 500 成分股（依吸籌評分由高至低排序）。'
      : mode === 'dip'
        ? '<b>超跌估值修正規則：</b>篩選自 52 週高點回檔 <code>≥ 12%</code>、且 <code>RSI(14) ≤ 38</code> 或觸及布林下軌（<code>%B ≤ 0.15</code>）且綜合修正評分 <code>≥ 50</code> 之 S&amp;P 500 成分股，並標註是否守穩 200 日年線或下影線承接。'
        : `<b>S&amp;P 500 全市場清單：</b>已載入 ${fmt(allRows.length)} / ${fmt(total)} 檔美股，可依 GICS 產業、技術快篩膠囊與排序條件檢視。`;

  const sectorNames = [...new Set(allRows.map(r => r.sector).filter(Boolean))].sort();
  const sec = state.usSector || 'ALL';
  const flt = state.usFilter || 'all';
  const sortMode = state.usSort || 'scoreDesc';

  const filters = [
    ['all', '全部'],
    ['cmfPos', 'CMF 資金流入'],
    ['aboveShortMa', '站上 MA5/10'],
    ['belowMa5', '低於 5 日線'],
    ['aboveMa200', '站穩 200 日年線'],
    ['macdBull', 'MACD 多頭'],
    ['rsiLow', 'RSI 低檔 (≤35)'],
    ['volSurge', '爆量 (≥1.3x MV5)']
  ];

  let theadHtml = '';
  let tbodyHtml = '';

  if (mode === 'smart') {
    theadHtml =
      '<tr><th>代號／名稱</th><th>產業</th><th>現價 (USD)</th><th>漲跌幅</th><th>吸籌評分</th><th>CMF(20)</th><th>買賣量比</th><th>OBV／均線</th><th>吸籌命中訊號</th><th style="width:46px;text-align:center">收藏</th></tr>';
    tbodyHtml = pageItems
      .map(r => {
        const cls = r.change > 0 ? 'tw-up' : r.change < 0 ? 'tw-down' : 'wl-pnl-flat';
        const arrow = r.change > 0 ? '▲' : r.change < 0 ? '▼' : '';
        const inFav = typeof isStockInAnyFolder === 'function' && isStockInAnyFolder(r.code);
        return (
          `<tr class="clickable" data-us-stock="${esc(r.code)}">` +
          `<td><b>${esc(r.code)}</b> <span class="cell-muted">${esc(r.name)}</span></td>` +
          `<td>${badge(r.sector, '')}</td>` +
          `<td style="font-variant-numeric:tabular-nums"><b>$${fmt(r.price, 2)}</b></td>` +
          `<td class="${cls}" style="font-variant-numeric:tabular-nums;font-weight:700">${arrow} ${pp(r.changePct, 2)}%</td>` +
          `<td><span class="us-score-pill tw-up">${r.smartScore}</span></td>` +
          `<td class="tw-up" style="font-variant-numeric:tabular-nums;font-weight:700">${r.cmf20 != null ? pp(r.cmf20, 2) : '—'}</td>` +
          `<td style="font-variant-numeric:tabular-nums;font-weight:600">${r.udVolRatio != null ? fmt(r.udVolRatio, 2) + 'x' : '—'}</td>` +
          `<td>${r.obvRising ? badge('OBV走揚', 'good') : badge(r.shortStatus, '')}</td>` +
          `<td>${renderUsReasonTags(r.smartReasons, 'smart')}</td>` +
          `<td style="text-align:center"><button type="button" class="btn-fav ${inFav ? 'on' : ''}" data-quick-fav="${esc(r.code)}" title="管理收藏夾">${inFav ? '★' : '☆'}</button></td>` +
          '</tr>'
        );
      })
      .join('');
  } else if (mode === 'dip') {
    theadHtml =
      '<tr><th>代號／名稱</th><th>產業</th><th>現價 (USD)</th><th>漲跌幅</th><th>修正評分</th><th>距52週高點</th><th>RSI(14)</th><th>布林 %B</th><th>超跌命中訊號</th><th style="width:46px;text-align:center">收藏</th></tr>';
    tbodyHtml = pageItems
      .map(r => {
        const cls = r.change > 0 ? 'tw-up' : r.change < 0 ? 'tw-down' : 'wl-pnl-flat';
        const arrow = r.change > 0 ? '▲' : r.change < 0 ? '▼' : '';
        const inFav = typeof isStockInAnyFolder === 'function' && isStockInAnyFolder(r.code);
        return (
          `<tr class="clickable" data-us-stock="${esc(r.code)}">` +
          `<td><b>${esc(r.code)}</b> <span class="cell-muted">${esc(r.name)}</span></td>` +
          `<td>${badge(r.sector, '')}</td>` +
          `<td style="font-variant-numeric:tabular-nums"><b>$${fmt(r.price, 2)}</b></td>` +
          `<td class="${cls}" style="font-variant-numeric:tabular-nums;font-weight:700">${arrow} ${pp(r.changePct, 2)}%</td>` +
          `<td><span class="us-score-pill tw-down">${r.dipScore}</span></td>` +
          `<td class="tw-down" style="font-variant-numeric:tabular-nums;font-weight:700">${r.fromHighPct != null ? pp(r.fromHighPct, 1) + '%' : '—'}</td>` +
          `<td class="${(r.rsi14 ?? 50) <= 32 ? 'tw-down' : ''}" style="font-variant-numeric:tabular-nums;font-weight:700">${r.rsi14 != null ? fmt(r.rsi14, 1) : '—'}</td>` +
          `<td style="font-variant-numeric:tabular-nums">${r.bbPos != null ? fmt(r.bbPos, 2) : '—'}</td>` +
          `<td>${renderUsReasonTags(r.dipReasons, 'dip')}</td>` +
          `<td style="text-align:center"><button type="button" class="btn-fav ${inFav ? 'on' : ''}" data-quick-fav="${esc(r.code)}" title="管理收藏夾">${inFav ? '★' : '☆'}</button></td>` +
          '</tr>'
        );
      })
      .join('');
  } else {
    theadHtml =
      '<tr><th>代號／名稱</th><th>產業</th><th>現價 (USD)</th><th>漲跌幅</th><th>短均狀態</th><th>CMF(20)</th><th>RSI(14)</th><th>距52週高</th><th>雙模式判定</th><th style="width:46px;text-align:center">收藏</th></tr>';
    tbodyHtml = pageItems
      .map(r => {
        const cls = r.change > 0 ? 'tw-up' : r.change < 0 ? 'tw-down' : 'wl-pnl-flat';
        const arrow = r.change > 0 ? '▲' : r.change < 0 ? '▼' : '';
        const inFav = typeof isStockInAnyFolder === 'function' && isStockInAnyFolder(r.code);
        const modeTags = [
          r.smartPass ? badge(`機構吸籌 ${r.smartScore}`, 'good') : '',
          r.dipPass ? badge(`超跌修正 ${r.dipScore}`, 'warn') : ''
        ]
          .filter(Boolean)
          .join(' ');
        return (
          `<tr class="clickable" data-us-stock="${esc(r.code)}">` +
          `<td><b>${esc(r.code)}</b> <span class="cell-muted">${esc(r.name)}</span></td>` +
          `<td>${badge(r.sector, '')}</td>` +
          `<td style="font-variant-numeric:tabular-nums"><b>$${fmt(r.price, 2)}</b></td>` +
          `<td class="${cls}" style="font-variant-numeric:tabular-nums;font-weight:700">${arrow} ${pp(r.changePct, 2)}%</td>` +
          `<td>${badge(r.shortStatus, r.shortTone === 'up' ? 'good' : r.shortTone === 'down' ? 'bad' : '')}</td>` +
          `<td class="${(r.cmf20 || 0) >= 0.05 ? 'tw-up' : (r.cmf20 || 0) <= -0.05 ? 'tw-down' : ''}" style="font-variant-numeric:tabular-nums">${r.cmf20 != null ? pp(r.cmf20, 2) : '—'}</td>` +
          `<td class="${r.rsi14 >= 60 ? 'tw-up' : r.rsi14 <= 35 ? 'tw-down' : ''}" style="font-variant-numeric:tabular-nums">${r.rsi14 != null ? fmt(r.rsi14, 1) : '—'}</td>` +
          `<td style="font-variant-numeric:tabular-nums">${r.fromHighPct != null ? pp(r.fromHighPct, 1) + '%' : '—'}</td>` +
          `<td>${modeTags || '<span class="mini">觀察中</span>'}</td>` +
          `<td style="text-align:center"><button type="button" class="btn-fav ${inFav ? 'on' : ''}" data-quick-fav="${esc(r.code)}" title="管理收藏夾">${inFav ? '★' : '☆'}</button></td>` +
          '</tr>'
        );
      })
      .join('');
  }

  return (
    head +
    scanBar +
    modeCards +
    `<div class="notice" style="margin-bottom:16px">${ruleText}</div>` +
    '<div class="card">' +
    '<div class="toolbar">' +
    `<input id="usSearchInput" placeholder="搜尋代號、名稱或產業" value="${esc(state.usQuery || '')}" style="width:205px">` +
    '<select id="usSectorSelect" class="select">' +
    `<option value="ALL" ${sec === 'ALL' ? 'selected' : ''}>全部 GICS 產業（${allRows.length}）</option>` +
    sectorNames
      .map(s => `<option value="${esc(s)}" ${sec === s ? 'selected' : ''}>${esc(s)}（${allRows.filter(x => x.sector === s).length}）</option>`)
      .join('') +
    '</select>' +
    '<select id="usSortSelect" class="select">' +
    `<option value="scoreDesc" ${sortMode === 'scoreDesc' ? 'selected' : ''}>策略評分最高</option>` +
    `<option value="cmfDesc" ${sortMode === 'cmfDesc' ? 'selected' : ''}>CMF(20) 資金流入最高</option>` +
    `<option value="rsiAsc" ${sortMode === 'rsiAsc' ? 'selected' : ''}>RSI(14) 最低超賣</option>` +
    `<option value="fromHighAsc" ${sortMode === 'fromHighAsc' ? 'selected' : ''}>距 52 週高點回檔最深</option>` +
    `<option value="chgDesc" ${sortMode === 'chgDesc' ? 'selected' : ''}>當日漲幅最高</option>` +
    `<option value="chgAsc" ${sortMode === 'chgAsc' ? 'selected' : ''}>當日跌幅最深</option>` +
    `<option value="volRatio" ${sortMode === 'volRatio' ? 'selected' : ''}>量比最高</option>` +
    `<option value="code" ${sortMode === 'code' ? 'selected' : ''}>代號排序</option>` +
    '</select>' +
    '<button type="button" class="btn sm" id="exportUsScreener">↓ 匯出 CSV</button>' +
    '</div>' +
    '<div class="wl-filter-bar" style="margin-top:0;padding-top:0;border-top:0;margin-bottom:12px">' +
    filters
      .map(
        ([k, lbl]) =>
          `<button type="button" class="topic-chip ${flt === k ? 'active' : ''}" data-us-filter="${k}">${esc(lbl)}</button>`
      )
      .join('') +
    '</div>' +
    `<div class="mini" style="margin-bottom:10px">符合條件 ${fmt(rows.length)} 檔（每頁 ${limit} 筆）· 更新 ${esc(scr?.updatedAt || '—')} · 點擊任一列進入美股個股詳情</div>` +
    (pageItems.length
      ? `<div class="tblwrap"><table><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table></div>`
      : '<div class="empty">目前條件下無符合之美股標的，可切換上方雙模式、調整產業或放寬技術快篩。</div>') +
    '<div class="toolbar" style="justify-content:flex-end;margin-top:16px;margin-bottom:0">' +
    `<button type="button" class="btn sm" id="usPrevPage" ${state.usPageNum <= 0 ? 'disabled' : ''}>← 上一頁</button>` +
    `<span class="mini">${pages ? state.usPageNum + 1 : 0} / ${pages} 頁</span>` +
    `<button type="button" class="btn sm" id="usNextPage" ${state.usPageNum + 1 >= pages ? 'disabled' : ''}>下一頁 →</button>` +
    '</div>' +
    '</div>'
  );
}

function usStockPage() {
  const code = state.usStock || 'NVDA';
  const detail = state.usDetailByCode?.[code];
  const inFav = typeof isStockInAnyFolder === 'function' && isStockInAnyFolder(code);

  const backStrip =
    state.stockReturnPage === 'watchlist'
      ? '<div class="wl-back-strip">' +
        '<button type="button" class="btn sm" id="backToWatchlistBtn">← 返回股票收藏夾</button>' +
        '<span class="mini">美股整合個股檢視（日／週／月 K 線、MA5–MA200、RSI、MACD 與美元持股損益）</span>' +
        '</div>'
      : '';

  const headerControls =
    '<div class="stock-head-tools">' +
    `<button type="button" class="btn sm ${inFav ? 'fav-active' : ''}" data-quick-fav="${esc(code)}">${inFav ? '★ 已收藏' : '☆ 加入收藏'}</button>` +
    `<div class="toolbar" style="margin:0"><input id="usStockCodeInput" autocomplete="off" data-stock-suggest="US" data-suggest-submit="goUsStockBtn" placeholder="代號或名稱（如 NVDA、輝達）" value="${esc(code)}" style="width:205px"><button type="button" class="btn main" id="goUsStockBtn">查詢</button></div>` +
    `<button type="button" class="btn sm" id="refreshUsDetailBtn"${state.usDetailLoading ? ' disabled' : ''}>↻ 更新</button>` +
    '</div>';

  const displayName = detail?.name || code;
  const pageTitle =
    backStrip +
    title(
      `美股詳情｜${esc(code)} ${esc(displayName)}`,
      `交易所：${esc(detail?.exchange || 'US')} · 計價：USD ($) · 統一紅漲綠跌`,
      headerControls
    );

  if (state.usDetailLoading) {
    return pageTitle + `<div class="card"><div class="empty"><b>正在載入 ${esc(code)} 兩年日 K 線、均線、RSI 與 MACD...</b>請稍候片刻</div></div>`;
  }
  if (state.usDetailError) {
    return (
      pageTitle +
      `<div class="card"><div class="empty"><b>無法載入 ${esc(code)} 美股詳情</b>${esc(state.usDetailError)}` +
      '<div style="margin-top:14px"><button type="button" class="btn main sm" id="refreshUsDetailBtn">重新載入</button></div></div></div>'
    );
  }
  if (!detail?.bars?.length) {
    return (
      pageTitle +
      `<div class="card"><div class="empty"><b>尚未載入 ${esc(code)} 行情資料</b>` +
      '<div style="margin-top:14px"><button type="button" class="btn main sm" id="refreshUsDetailBtn">立即載入美股詳情</button></div></div></div>'
    );
  }

  const bars = detail.bars;
  const last = bars.at(-1);
  const prev = bars.at(-2) || last;
  const tech = detail.tech || {};
  const chg = last[4] - prev[4];
  const chgPct = prev[4] ? (chg / prev[4]) * 100 : 0;
  const ampPct = prev[4] ? ((last[2] - last[3]) / prev[4]) * 100 : 0;
  const dirClass = chg > 0 ? 'tw-up' : chg < 0 ? 'tw-down' : 'wl-pnl-flat';
  const arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '';
  const r52 = tech.range52w || { low: last[3], high: last[2], posPct: 50 };

  const maQuickList = [
    ['MA5 (5日)', tech.ma5],
    ['MA10 (10日)', tech.ma10],
    ['MA20 (月線)', tech.ma20],
    ['MA60 (季線)', tech.ma60],
    ['MA200 (年線)', tech.ma200]
  ];

  // USD 持股成本摘要（僅以美元顯示）
  const holdCost = typeof getBestHoldingCostInfo === 'function' ? getBestHoldingCostInfo(code) : null;
  let holdingHtml = '';
  if (holdCost && holdCost.costPrice > 0) {
    const shares = holdCost.shares || 0;
    const costPer = holdCost.costPrice;
    const diffPer = last[4] - costPer;
    const pct = (diffPer / costPer) * 100;
    const marketVal = shares > 0 ? last[4] * shares : null;
    const costTotal = shares > 0 ? costPer * shares : null;
    const pnlTotal = marketVal !== null ? marketVal - costTotal : null;
    const pnlCls = diffPer > 0 ? 'tw-up' : diffPer < 0 ? 'tw-down' : 'wl-pnl-flat';
    const signStr = pnlTotal > 0 ? '+' : pnlTotal < 0 ? '-' : '';
    holdingHtml =
      '<div class="wl-cost-summary">' +
      `<div class="wl-cost-head"><span>📌 美股持股成本損益（來源：${esc(holdCost.folderName)} · USD）</span><span class="mini">下方 K 線已標示購入均價線 $${fmt(costPer, 2)}</span></div>` +
      '<div class="wl-cost-cells">' +
      `<div><span class="mini">購入均價</span><strong>$${fmt(costPer, 2)}</strong></div>` +
      `<div><span class="mini">持有股數</span><strong>${shares > 0 ? `${fmt(shares)} 股` : '未填股數'}</strong></div>` +
      `<div><span class="mini">現價市值 (USD)</span><strong>${marketVal !== null ? `$${fmt(marketVal, 2)}` : '—'}</strong></div>` +
      `<div><span class="mini">購入總成本 (USD)</span><strong>${costTotal !== null ? `$${fmt(costTotal, 2)}` : '—'}</strong></div>` +
      `<div><span class="mini">未實現損益 (USD)</span><strong class="${pnlCls}">${pnlTotal !== null ? `${signStr}$${fmt(Math.abs(pnlTotal), 2)} ` : ''}(${pct > 0 ? '+' : ''}${fmt(pct, 2)}%)</strong></div>` +
      '</div></div>';
  }

  const sMa = tech.shortMa || {};
  const mMa = tech.midMa || {};
  const rsi = tech.rsi || {};
  const macd = tech.macd || {};
  const vol = tech.volume || {};
  const ov = tech.overall || {};

  const sigCards = [
    ['1. 短均位階 (MA5/10)', sMa.status, `MA5 $${sMa.ma5 != null ? fmt(sMa.ma5, 2) : '—'} (${pp(sMa.bias5Pct, 2)}%)`, sMa.tone],
    ['2. 中長趨勢 (MA20/60/200)', mMa.status, `年線 MA200 ${mMa.ma200 != null ? '$' + fmt(mMa.ma200, 2) : '—'}`, mMa.tone],
    ['3. RSI(14) 動能', rsi.status, '70 以上超買 · 30 以下超賣', rsi.tone],
    ['4. MACD (12,26,9)', macd.status, `DIF ${macd.dif != null ? pp(macd.dif, 2) : '—'} / DEA ${macd.dea != null ? pp(macd.dea, 2) : '—'}`, macd.tone],
    ['5. 量價配合 (vs MV5)', vol.status, `成交 ${fmtUsShares(vol.vol)} / 均量 ${fmtUsShares(vol.mv5)}`, vol.tone],
    ['6. 52 週位階', r52.status, `距 52 週高點 ${pp(r52.fromHighPct, 2)}%`, r52.tone]
  ];

  const smartInfo = tech.smartMoney || {};
  const dipInfo = tech.dipBuy || {};
  const modeBadges = [
    smartInfo.pass ? badge(`機構資金吸籌 ${smartInfo.score}分`, 'good') : '',
    dipInfo.pass ? badge(`超跌估值修正 ${dipInfo.score}分`, 'warn') : '',
    tech.cmf20 != null ? badge(`CMF(20) ${pp(tech.cmf20, 2)}`, tech.cmf20 >= 0.05 ? 'good' : tech.cmf20 <= -0.05 ? 'bad' : '') : ''
  ]
    .filter(Boolean)
    .join(' ');

  return (
    pageTitle +
    // 1. 報價看板
    '<div class="card" style="margin-bottom:18px">' +
    '<div class="quote-top">' +
    '<div>' +
    `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">${badge(detail.exchange || 'US', '')}${detail.sector ? badge(detail.sector, '') : ''}${modeBadges}<span class="mini">資料日 ${esc(last[0])} 收盤 · USD</span></div>` +
    '<div class="quote-price-row">' +
    `<span class="quote-price ${dirClass}">$${fmt(last[4], 2)}</span>` +
    `<span class="quote-chg-badge ${chg > 0 ? 'tw-up-bg' : chg < 0 ? 'tw-down-bg' : ''}">${arrow} $${fmt(Math.abs(chg), 2)} (${pp(chgPct, 2)}%)</span>` +
    '</div>' +
    '</div>' +
    '<div class="quote-grid">' +
    `<div class="quote-cell"><div class="label">開盤</div><div class="val">$${fmt(last[1], 2)}</div></div>` +
    `<div class="quote-cell"><div class="label">最高</div><div class="val tw-up">$${fmt(last[2], 2)}</div></div>` +
    `<div class="quote-cell"><div class="label">最低</div><div class="val tw-down">$${fmt(last[3], 2)}</div></div>` +
    `<div class="quote-cell"><div class="label">昨收</div><div class="val">$${fmt(prev[4], 2)}</div></div>` +
    `<div class="quote-cell"><div class="label">成交量</div><div class="val">${fmtUsShares(last[5])}</div></div>` +
    `<div class="quote-cell"><div class="label">當日振幅</div><div class="val">${fmt(ampPct, 2)}%</div></div>` +
    '</div>' +
    '</div>' +
    '<div class="range-bar-row">' +
    `<span>52週低 $${fmt(r52.low, 2)}</span>` +
    `<div class="range-track"><div class="range-fill" style="width:${Math.max(3, Math.min(100, r52.posPct || 50))}%"></div></div>` +
    `<span>52週高 $${fmt(r52.high, 2)}（位階 ${fmt(r52.posPct, 0)}%）</span>` +
    '</div>' +
    '</div>' +
    // 2. 均線速查 + 6 大技術體檢 + USD 持股成本
    '<div class="card" style="margin-bottom:18px">' +
    cardhead('美股六大技術體檢 ＆ 均線速查', '整合 MA5 / MA10 / MA20 / MA60 / MA200、RSI(14)、MACD 與 52 週位階', ov.divergenceAlert ? badge(ov.divergenceAlert, 'warn') : badge(ov.label || '技術分析', ov.tone === 'up' ? 'good' : ov.tone === 'down' ? 'bad' : '')) +
    '<div class="wl-ma-mini-grid" style="grid-template-columns:repeat(5,minmax(0,1fr));margin-bottom:12px">' +
    maQuickList
      .map(([lbl, mv]) => {
        if (mv == null) return `<div class="wl-int-panel"><span class="mini">${lbl}</span><div><b>—</b></div></div>`;
        const dpct = ((last[4] - mv) / mv) * 100;
        return `<div class="wl-int-panel"><span class="mini">${lbl}</span><div style="font-variant-numeric:tabular-nums"><b>$${fmt(mv, 2)}</b> <span class="mini ${dpct >= 0 ? 'tw-up' : 'tw-down'}">${pp(dpct, 2)}%</span></div></div>`;
      })
      .join('') +
    '</div>' +
    '<div class="wl-dim-grid">' +
    sigCards
      .map(
        ([lbl, val, sub, tone]) =>
          renderDimToneTag(lbl, tone) +
          `<div class="wl-dim-val">${esc(val || '—')}</div>` +
          `<div class="wl-dim-sub">${esc(sub)}</div></div>`
      )
      .join('') +
    '</div>' +
    `<div class="verdict-box" style="margin-top:12px"><b>結構總評：</b>${esc(ov.summary || '')}</div>` +
    holdingHtml +
    '</div>' +
    // 3. 互動式 K 線 + MA5/10/20/60/200 + 成交量
    '<div class="card" style="margin-bottom:18px">' +
    '<div class="toolbar" style="justify-content:space-between;margin-bottom:12px">' +
    '<div class="toolbar" style="margin:0">' +
    `<div class="seg">${[['D', '日K'], ['W', '週K'], ['M', '月K']].map(([k, lbl]) => `<button type="button" data-tf="${k}" class="${state.detailTf === k ? 'on' : ''}">${lbl}</button>`).join('')}</div>` +
    `<div class="seg" style="${state.detailTf !== 'D' ? 'opacity:.45;pointer-events:none' : ''}">${[[22, '1個月'], [60, '3個月'], [120, '半年'], [250, '1年']].map(([n, lbl]) => `<button type="button" data-detail-range="${n}" class="${state.detailRange === n ? 'on' : ''}">${lbl}</button>`).join('')}</div>` +
    '</div>' +
    '<div class="legend" style="margin:0">' +
    [5, 10, 20, 60, 200]
      .map(
        p =>
          `<label><input type="checkbox" data-detail-ma="${p}" ${state.detailMas[p] ? 'checked' : ''}><span style="color:${MA_COLORS[p]}">●</span>MA${p}</label>`
      )
      .join('') +
    '</div>' +
    '</div>' +
    '<div id="klineReadout" class="kline-readout"></div>' +
    '<canvas id="klineCanvas" class="kline-canvas" height="360"></canvas>' +
    '</div>' +
    // 4. MACD / RSI 技術副圖
    '<div class="card">' +
    cardhead(
      '動能與趨勢技術副圖（近 60 個交易日）',
      '可切換檢視 MACD (12, 26, 9) 或 RSI (14)',
      `<div class="seg"><button type="button" data-us-sub="macd" class="${(state.usSubTab || 'macd') === 'macd' ? 'on' : ''}">MACD 趨勢</button><button type="button" data-us-sub="rsi" class="${state.usSubTab === 'rsi' ? 'on' : ''}">RSI(14) 動能</button></div>`
    ) +
    renderUsSubChart(tech) +
    '</div>'
  );
}

// === pages/screen.js ===
/**
 * 頁面 02：全市場篩選 (screen)
 */

function screen() {
  const cfg = applied;
  const win = evaluation(cfg);
  const raw = scan(cfg, win);
  const t = tally(raw);

  const q = state.query.trim().toLowerCase();
  let rows = raw.filter(r => !q || (r.code + ' ' + r.name).toLowerCase().includes(q));

  if (state.filter === 'pass') rows = rows.filter(r => r.pass);
  if (state.filter === 'unknown') rows = rows.filter(r => r.insufficient);
  if (state.filter === 'miss') rows = rows.filter(r => !r.pass);

  rows.sort(
    state.sort === 'name'
      ? (a, b) => a.code.localeCompare(b.code)
      : state.sort === 'market'
        ? (a, b) => a.market.localeCompare(b.market)
        : (a, b) => (b.gain ?? -9999) - (a.gain ?? -9999)
  );

  const limit = 40;
  const pages = Math.ceil(rows.length / limit);
  const items = rows.slice(state.pageNum * limit, (state.pageNum + 1) * limit);
  state.showList = rows;

  return (
    title(
      '全市場籌碼篩選',
      '從真實集保原始股數計算，而非展示人工假資料。',
      '<button class="btn" data-nav="settings">⚙ 調整篩選參數</button>'
    ) +
    `<div class="notice">目前母體：${fmt(D.universe.length)} 檔候選股票。所選窗口可判定：${fmt(t.all - t.unknown)} 檔，資料不足：${fmt(t.unknown)} 檔。<b>注意：</b>來自 2026-11-13 的股票名單，未重建歷史逐日母體，也尚未逐檔完成公司行動核對；篩選通過僅代表算術條件符合。</div>` +
    '<div class="metricgrid">' +
    metric('符合現行條件', fmt(t.pass), '通過股數 + 比例 + 門檻', 'green') +
    metric('不符條件', fmt(t.all - t.pass - t.unknown), '明列原因') +
    metric('資料／複合條件待證', fmt(t.unknown), '須查證，不當作通過') +
    metric('目前觀測截止', win?.end || '—', '公布證據與交易開盤分開處理') +
    '</div>' +
    '<div class="card">' +
    cardhead('篩選控制台', '參數更動只在「策略設定」按套用後影響篩選', settingsHint()) +
    '<div class="toolbar">' +
    `<input id="searchCode" placeholder="搜尋股票代號或名稱" value="${esc(state.query)}" aria-label="股票搜尋">` +
    `<span class="mini">連續 ${cfg.weeks} 週增持，累計至少 ${fmt(cfg.minPp, 2)} 百分點</span>` +
    wndSelect() +
    `<select id="filterPass">` +
    `<option value="pass" ${state.filter === 'pass' ? 'selected' : ''}>只看通過</option>` +
    `<option value="all" ${state.filter === 'all' ? 'selected' : ''}>全部結果</option>` +
    `<option value="miss" ${state.filter === 'miss' ? 'selected' : ''}>未通過／待證</option>` +
    `<option value="unknown" ${state.filter === 'unknown' ? 'selected' : ''}>資料與條件待證</option>` +
    '</select>' +
    '<select id="sortBy">' +
    `<option value="gain" ${state.sort === 'gain' ? 'selected' : ''}>增幅最高</option>` +
    `<option value="name" ${state.sort === 'name' ? 'selected' : ''}>代號順序</option>` +
    `<option value="market" ${state.sort === 'market' ? 'selected' : ''}>市場排序</option>` +
    '</select>' +
    '<button class="btn sm" id="exportScreener">↓ 匯出結果 CSV</button>' +
    '</div>' +
    `<div class="mini" style="margin-bottom:10px">篩選結果 ${fmt(rows.length)} 筆，每頁 40 筆 · 點擊股票可查看各週原始值</div>` +
    renderTable(items) +
    '<div class="toolbar" style="justify-content:flex-end;margin-top:16px;margin-bottom:0">' +
    `<button class="btn sm" id="prevPage" ${state.pageNum <= 0 ? 'disabled' : ''}>← 上一頁</button>` +
    `<span class="mini">${pages ? state.pageNum + 1 : 0} / ${pages} 頁</span>` +
    `<button class="btn sm" id="nextPage" ${state.pageNum + 1 >= pages ? 'disabled' : ''}>下一頁 →</button>` +
    '</div>' +
    '</div>'
  );
}

// === pages/stock.js ===
/**
 * 頁面 03：個股研究 ⇄ 個股詳情（雙模式滑動切換）
 */

function buildDetailAnalysis(code, detail) {
  const bars = detail.bars;
  const last = bars.at(-1);
  const prev = bars.at(-2) || last;
  const close = last[4];
  const chg = close - prev[4];
  const vol = last[5];

  const ma5 = computeMA(bars, 5).at(-1);
  const ma10 = computeMA(bars, 10).at(-1);
  const ma20 = computeMA(bars, 20).at(-1);
  const ma60 = computeMA(bars, 60).at(-1);
  const mv5 = computeVolMA(bars, 5).at(-1);

  const instRows = detail.inst || [];
  const inst5 = instRows.slice(-5);
  const trust5 = inst5.reduce((s, r) => s + r[2], 0);
  const totalInst5 = inst5.reduce((s, r) => s + r[1] + r[2] + r[3], 0);

  const ctx = evaluation(applied);
  const sig = weeklySignal(code, ctx);
  const tdccGain = sig.gain;
  const tdccUp = Number.isFinite(tdccGain) ? tdccGain > 0 : null;

  const signals = [];

  if (ma5 !== null && ma10 !== null) {
    if (close >= ma5 && close >= ma10) {
      signals.push({ label: '短線均線', text: `站上 5日(${fmt(ma5, 1)}) 與 10日線(${fmt(ma10, 1)})`, tone: 'up' });
    } else if (close < ma5 && close < ma10) {
      signals.push({ label: '短線均線', text: `低於 5日(${fmt(ma5, 1)}) 與 10日線(${fmt(ma10, 1)})`, tone: 'down' });
    } else {
      signals.push({
        label: '短線均線',
        text: close >= ma10 ? `跌破 5日線、守 10日線(${fmt(ma10, 1)})` : `站回 5日線、受壓 10日線`,
        tone: 'neutral'
      });
    }
  }

  if (ma20 !== null && ma60 !== null) {
    if (close >= ma20 && close >= ma60) {
      signals.push({ label: '中長趨勢', text: '站穩月線與季線之上', tone: 'up' });
    } else if (close < ma20 && close < ma60) {
      signals.push({ label: '中長趨勢', text: '位於月線與季線之下', tone: 'down' });
    } else {
      signals.push({
        label: '中長趨勢',
        text: close >= ma60 ? '月線下整理、守穩季線' : '反彈站上月線、季線反壓',
        tone: 'neutral'
      });
    }
  }

  const volRatio = mv5 ? vol / mv5 : 1;
  if (chg > 0 && volRatio >= 1.15) {
    signals.push({ label: '量價配合', text: `價漲量增（為5日均量 ${fmt(volRatio, 2)} 倍）`, tone: 'up' });
  } else if (chg < 0 && volRatio >= 1.2) {
    signals.push({ label: '量價配合', text: `帶量回檔（為5日均量 ${fmt(volRatio, 2)} 倍）`, tone: 'down' });
  } else {
    signals.push({ label: '量價配合', text: `量能溫和（5日均量 ${fmt(mv5, 0)} 張）`, tone: 'neutral' });
  }

  if (instRows.length) {
    signals.push({
      label: '法人近5日',
      text:
        totalInst5 >= 0
          ? `合計買超 ${pp(totalInst5, 0)} 張（投信 ${pp(trust5, 0)}）`
          : `合計賣超 ${fmt(Math.abs(totalInst5))} 張（投信 ${pp(trust5, 0)}）`,
      tone: totalInst5 >= 0 ? 'up' : 'down'
    });
  } else {
    signals.push({ label: '法人近5日', text: '暫無近期法人紀錄', tone: 'neutral' });
  }

  if (tdccUp !== null) {
    signals.push({
      label: `${applied.band}張大戶`,
      text: tdccUp ? `週買超增持 ${pp(tdccGain, 3)} pp` : `週賣超調節 ${pp(tdccGain, 3)} pp`,
      tone: tdccUp ? 'up' : 'down'
    });
  } else {
    signals.push({ label: `${applied.band}張大戶`, text: sig.reason || '集保資料待核', tone: 'neutral' });
  }

  const shortBull = ma5 !== null && ma10 !== null && close >= ma5 && close >= ma10;
  const chipBull = (instRows.length && totalInst5 > 0) || tdccUp === true;
  let summary = '';
  if (shortBull && chipBull) {
    summary = `收盤站上 5 日與 10 日均線，且近期${tdccUp ? '大戶週籌碼增持' : ''}${instRows.length && totalInst5 > 0 ? '法人近五日偏多操作' : ''}，屬於「價強籌碼穩」偏多結構。`;
  } else if (!shortBull && chipBull) {
    summary = `短線股價低於 5 日或 10 日均線整理，但${tdccUp ? ` ${applied.band} 張大戶逆勢增持` : '三大法人逢低承接'}，屬於「短線價弱、籌碼有撐」的觀察結構。`;
  } else if (shortBull && !chipBull) {
    summary = `短線股價維持均線之上，惟近期法人與大戶尚未同步增持，宜留意高檔追價與籌碼背離風險。`;
  } else {
    summary = `目前股價位於 5 日與 10 日均線之下，且籌碼面偏保守，建議等待站回短期均線或法人／大戶轉買訊號。`;
  }

  return { signals, summary };
}

function renderDetailChips(detail) {
  if (state.detailChipTab === 'margin') {
    const rows = detail.margin || [];
    if (!rows.length) {
      return '<div class="empty"><b>此標的暫無融資融券交易資料</b>（部分 ETF 或未開放信用交易標的無此紀錄）</div>';
    }
    const last = rows.at(-1);
    const m5 = rows.slice(-5).reduce((s, r) => s + r[2], 0);
    const s5 = rows.slice(-5).reduce((s, r) => s + r[4], 0);
    const ratio = last[1] > 0 ? (last[3] / last[1]) * 100 : 0;
    const maxAbs = Math.max(...rows.map(r => Math.abs(r[2])), 1);

    const barsSvg = rows
      .map((r, i) => {
        const chg = r[2];
        const slotW = 720 / rows.length;
        const x = 44 + i * slotW + slotW * 0.15;
        const bw = Math.max(6, slotW * 0.7);
        const h = (Math.abs(chg) / maxAbs) * 60;
        const y = chg >= 0 ? 72 - h : 72;
        const fill = chg >= 0 ? '#ef4444' : '#22c55e';
        return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, h).toFixed(1)}" fill="${fill}" rx="2"><title>${r[0]} 融資增減 ${pp(chg, 0)} 張（餘額 ${fmt(r[1])} 張）</title></rect>`;
      })
      .join('');

    return (
      '<div class="statbar" style="margin-top:0;margin-bottom:14px">' +
      `<div><span class="mini">最新融資餘額</span><strong>${fmt(last[1])} 張</strong><span class="mini ${m5 >= 0 ? 'tw-up' : 'tw-down'}">近5日 ${pp(m5, 0)} 張</span></div>` +
      `<div><span class="mini">最新融券餘額</span><strong>${fmt(last[3])} 張</strong><span class="mini ${s5 >= 0 ? 'tw-up' : 'tw-down'}">近5日 ${pp(s5, 0)} 張</span></div>` +
      `<div><span class="mini">目前券資比</span><strong>${fmt(ratio, 2)}%</strong><span class="mini">資料日 ${esc(last[0])}</span></div>` +
      '</div>' +
      '<svg viewBox="0 0 780 152" class="plot" role="img" aria-label="融資增減變化圖">' +
      '<rect class="plot-bg" x="40" y="10" width="728" height="124" rx="8"/>' +
      '<line class="gridline" x1="40" x2="768" y1="72" y2="72"/>' +
      barsSvg +
      `<text class="axis" x="44" y="146">${rows[0][0]}（逐日融資增減）</text>` +
      `<text class="axis" text-anchor="end" x="764" y="146">${rows.at(-1)[0]}</text>` +
      '</svg>'
    );
  }

  const rows = detail.inst || [];
  if (!rows.length) {
    return '<div class="empty"><b>此標的暫無三大法人買賣超資料</b></div>';
  }
  const sumCol = (arr, col) => arr.reduce((acc, r) => acc + r[col], 0);
  const r5 = rows.slice(-5);
  const r20 = rows.slice(-20);
  const f5 = sumCol(r5, 1), t5 = sumCol(r5, 2), d5 = sumCol(r5, 3);
  const f20 = sumCol(r20, 1), t20 = sumCol(r20, 2), d20 = sumCol(r20, 3);
  const maxAbs = Math.max(...rows.map(r => Math.abs(r[1] + r[2] + r[3])), 1);

  const barsSvg = rows
    .map((r, i) => {
      const net = r[1] + r[2] + r[3];
      const slotW = 720 / rows.length;
      const x = 44 + i * slotW + slotW * 0.15;
      const bw = Math.max(6, slotW * 0.7);
      const h = (Math.abs(net) / maxAbs) * 58;
      const y = net >= 0 ? 72 - h : 72;
      const fill = net >= 0 ? '#ef4444' : '#22c55e';
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1.5, h).toFixed(1)}" fill="${fill}" rx="2"><title>${r[0]} 合計 ${pp(net, 0)} 張（外資 ${pp(r[1], 0)} / 投信 ${pp(r[2], 0)} / 自營 ${pp(r[3], 0)}）</title></rect>`;
    })
    .join('');

  const recent = [...rows].reverse().slice(0, 6);

  return (
    '<div class="statbar" style="margin-top:0;margin-bottom:14px">' +
    `<div><span class="mini">外資買賣超（近5日）</span><strong class="${f5 >= 0 ? 'tw-up' : 'tw-down'}">${pp(f5, 0)} 張</strong><span class="mini">近20日 ${pp(f20, 0)} 張</span></div>` +
    `<div><span class="mini">投信買賣超（近5日）</span><strong class="${t5 >= 0 ? 'tw-up' : 'tw-down'}">${pp(t5, 0)} 張</strong><span class="mini">近20日 ${pp(t20, 0)} 張</span></div>` +
    `<div><span class="mini">自營商買賣超（近5日）</span><strong class="${d5 >= 0 ? 'tw-up' : 'tw-down'}">${pp(d5, 0)} 張</strong><span class="mini">近20日 ${pp(d20, 0)} 張</span></div>` +
    '</div>' +
    '<svg viewBox="0 0 780 152" class="plot" role="img" aria-label="三大法人合計買賣超圖">' +
    '<rect class="plot-bg" x="40" y="10" width="728" height="124" rx="8"/>' +
    '<line class="gridline" x1="40" x2="768" y1="72" y2="72"/>' +
    `<text class="axis" x="36" y="20" text-anchor="end">+${fmt(maxAbs)}</text>` +
    `<text class="axis" x="36" y="75" text-anchor="end">0</text>` +
    `<text class="axis" x="36" y="132" text-anchor="end">-${fmt(maxAbs)}</text>` +
    barsSvg +
    `<text class="axis" x="44" y="146">${rows[0][0]}</text>` +
    `<text class="axis" text-anchor="end" x="764" y="146">${rows.at(-1)[0]}</text>` +
    '</svg>' +
    '<div class="tblwrap" style="margin-top:12px"><table><thead><tr><th>日期</th><th>外資（張）</th><th>投信（張）</th><th>自營商（張）</th><th>三大法人合計</th></tr></thead><tbody>' +
    recent
      .map(r => {
        const tot = r[1] + r[2] + r[3];
        return (
          `<tr><td><b>${r[0]}</b></td>` +
          `<td class="${r[1] >= 0 ? 'tw-up' : 'tw-down'}">${pp(r[1], 0)}</td>` +
          `<td class="${r[2] >= 0 ? 'tw-up' : 'tw-down'}">${pp(r[2], 0)}</td>` +
          `<td class="${r[3] >= 0 ? 'tw-up' : 'tw-down'}">${pp(r[3], 0)}</td>` +
          `<td class="${tot >= 0 ? 'tw-up' : 'tw-down'}"><b>${pp(tot, 0)}</b></td></tr>`
        );
      })
      .join('') +
    '</tbody></table></div>'
  );
}

function renderStockDetailMode(code, info) {
  if (state.stockDetailLoading) {
    return `<div class="card"><div class="empty"><b>正在載入 ${esc(code)} ${esc(info[0])} 詳細行情與法人籌碼...</b>請稍候片刻</div></div>`;
  }
  if (state.stockDetailError) {
    return (
      `<div class="card"><div class="empty"><b>無法載入 ${esc(code)} 個股詳情</b>${esc(state.stockDetailError)}` +
      '<div style="margin-top:14px"><button type="button" class="btn main sm" id="retryDetailBtn">重新載入</button></div></div></div>'
    );
  }
  const detail = state.stockDetailByCode?.[code];
  if (!detail?.bars?.length) {
    return (
      `<div class="card"><div class="empty"><b>尚未載入 ${esc(code)} 日行情與法人資料</b>` +
      '<div style="margin-top:14px"><button type="button" class="btn main sm" id="retryDetailBtn">立即載入個股詳情</button></div></div></div>'
    );
  }

  const bars = detail.bars;
  const last = bars.at(-1);
  const prev = bars.at(-2) || last;
  const dp = last[4] < 150 ? 2 : 1;
  const chg = last[4] - prev[4];
  const chgPct = prev[4] ? (chg / prev[4]) * 100 : 0;
  const ampPct = prev[4] ? ((last[2] - last[3]) / prev[4]) * 100 : 0;
  const recentYear = bars.slice(-252);
  const hi52 = Math.max(...recentYear.map(b => b[2]));
  const lo52 = Math.min(...recentYear.map(b => b[3]));
  const pos52 = hi52 > lo52 ? ((last[4] - lo52) / (hi52 - lo52)) * 100 : 50;
  const dirClass = chg > 0 ? 'tw-up' : chg < 0 ? 'tw-down' : '';
  const arrow = chg > 0 ? '▲' : chg < 0 ? '▼' : '';

  const analysis = buildDetailAnalysis(code, detail);
  const ma5Val = computeMA(bars, 5).at(-1);
  const ma10Val = computeMA(bars, 10).at(-1);
  const ma20Val = computeMA(bars, 20).at(-1);
  const ma60Val = computeMA(bars, 60).at(-1);
  const maQuickList = [
    ['MA5（5日）', ma5Val],
    ['MA10（10日）', ma10Val],
    ['MA20（月線）', ma20Val],
    ['MA60（季線）', ma60Val]
  ];

  const ctx = evaluation(applied);
  const scrSig = weeklySignal(code, ctx);
  const scrBadgeType = scrSig.pass ? 'good' : scrSig.insufficient ? 'warn' : '';
  const holdCost = typeof getBestHoldingCostInfo === 'function' ? getBestHoldingCostInfo(code) : null;
  let holdingHtml = '';
  if (holdCost && holdCost.costPrice > 0) {
    const shares = holdCost.shares || 0;
    const costPer = holdCost.costPrice;
    const diffPer = last[4] - costPer;
    const pct = (diffPer / costPer) * 100;
    const marketVal = shares > 0 ? last[4] * shares : null;
    const costTotal = shares > 0 ? costPer * shares : null;
    const pnlTotal = marketVal !== null ? marketVal - costTotal : null;
    const pnlCls = diffPer > 0 ? 'tw-up' : diffPer < 0 ? 'tw-down' : 'wl-pnl-flat';
    holdingHtml =
      '<div class="wl-cost-summary">' +
      `<div class="wl-cost-head"><span>📌 持股成本損益（來源：${esc(holdCost.folderName)}）</span><span class="mini">下方 K 線已標示購入均價線 ${fmt(costPer, dp)}</span></div>` +
      '<div class="wl-cost-cells">' +
      `<div><span class="mini">購入均價</span><strong>${fmt(costPer, dp)}</strong></div>` +
      `<div><span class="mini">持有股數</span><strong>${shares > 0 ? `${fmt(shares)} 股` : '未填股數'}</strong></div>` +
      `<div><span class="mini">現價市值（算法1）</span><strong>${marketVal !== null ? `${fmt(marketVal, 0)} 元` : '—'}</strong></div>` +
      `<div><span class="mini">購入總成本（算法2）</span><strong>${costTotal !== null ? `${fmt(costTotal, 0)} 元` : '—'}</strong></div>` +
      `<div><span class="mini">未實現損益</span><strong class="${pnlCls}">${pnlTotal !== null ? `${pnlTotal > 0 ? '+' : ''}${fmt(pnlTotal, 0)} 元 ` : ''}(${pct > 0 ? '+' : ''}${fmt(pct, 2)}%)</strong></div>` +
      '</div></div>';
  }

  return (
    // 1. Yahoo 風格報價看板
    '<div class="card" style="margin-bottom:18px">' +
    '<div class="quote-top">' +
    '<div>' +
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">${badge(info[1] || 'TWSE', '')}<span class="mini">資料日 ${esc(last[0])} 收盤 · 台股紅漲綠跌</span></div>` +
    '<div class="quote-price-row">' +
    `<span class="quote-price ${dirClass}">${fmt(last[4], dp)}</span>` +
    `<span class="quote-chg-badge ${chg > 0 ? 'tw-up-bg' : chg < 0 ? 'tw-down-bg' : ''}">${arrow} ${fmt(Math.abs(chg), dp)} (${pp(chgPct, 2)}%)</span>` +
    '</div>' +
    '</div>' +
    '<div class="quote-grid">' +
    `<div class="quote-cell"><div class="label">開盤</div><div class="val">${fmt(last[1], dp)}</div></div>` +
    `<div class="quote-cell"><div class="label">最高</div><div class="val tw-up">${fmt(last[2], dp)}</div></div>` +
    `<div class="quote-cell"><div class="label">最低</div><div class="val tw-down">${fmt(last[3], dp)}</div></div>` +
    `<div class="quote-cell"><div class="label">昨收</div><div class="val">${fmt(prev[4], dp)}</div></div>` +
    `<div class="quote-cell"><div class="label">成交量(張)</div><div class="val">${fmt(last[5])}</div></div>` +
    `<div class="quote-cell"><div class="label">當日振幅</div><div class="val">${fmt(ampPct, 2)}%</div></div>` +
    '</div>' +
    '</div>' +
    '<div class="range-bar-row">' +
    `<span>52週低 ${fmt(lo52, dp)}</span>` +
    `<div class="range-track"><div class="range-fill" style="width:${Math.max(3, Math.min(100, pos52))}%"></div></div>` +
    `<span>52週高 ${fmt(hi52, dp)}（位階 ${fmt(pos52, 0)}%）</span>` +
    '</div>' +
    '</div>' +
    // 2. 綜合研究檢核、均線速查與持股成本損益（整合自收藏夾、篩選條件與個股研究）
    '<div class="card" style="margin-bottom:18px">' +
    cardhead(
      '綜合研究檢核 ＆ 均線速查',
      '同步整合「全市場篩選」週訊號、均線位階與收藏夾持股成本損益',
      `<button type="button" class="btn sm" data-set-mode="study">切換「1. 個股研究 (TDCC 原始級距)」</button>`
    ) +
    '<div class="wl-integrate-grid">' +
    '<div class="wl-int-panel">' +
    '<div class="mini" style="margin-bottom:6px">全市場篩選條件檢核（現行策略參數）</div>' +
    `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${badge(scrSig.status, scrBadgeType)}<b>${esc(applied.band)} 張（${applied.weeks} 週）</b><span class="mini">${Number.isFinite(scrSig.gain) ? `累計 ${pp(scrSig.gain, 3)} pp` : ''}</span></div>` +
    `<div class="mini" style="margin-top:6px">${esc(scrSig.reason || '無此標的近期集保篩選資料')}</div>` +
    '</div>' +
    '<div class="wl-int-panel">' +
    '<div class="mini" style="margin-bottom:6px">均線價位速查（收盤價比較）</div>' +
    '<div class="wl-ma-mini-grid">' +
    maQuickList
      .map(([lbl, mv]) => {
        if (mv === null) return `<div class="wl-ma-cell"><span class="mini">${lbl}</span><b>—</b></div>`;
        const diffPct = ((last[4] - mv) / mv) * 100;
        const cCls = diffPct >= 0 ? 'tw-up' : 'tw-down';
        return `<div class="wl-ma-cell"><span class="mini">${lbl}</span><b>${fmt(mv, dp)}</b><span class="mini ${cCls}">${pp(diffPct, 2)}%</span></div>`;
      })
      .join('') +
    '</div>' +
    '</div>' +
    '</div>' +
    holdingHtml +
    '</div>' +
    // 3. 客觀條件燈號 + 一句話結構總評
    '<div class="card" style="margin-bottom:18px">' +
    cardhead('結構體檢與客觀條件分析', '依收盤均線、量能、三大法人與集保大戶自動判定') +
    '<div class="signal-grid">' +
    analysis.signals
      .map(
        s =>
          `<div class="signal-card ${s.tone === 'up' ? 'tw-up-bg' : s.tone === 'down' ? 'tw-down-bg' : ''}">` +
          `<div class="sig-title">${esc(s.label)}</div>` +
          `<div class="sig-text">${esc(s.text)}</div>` +
          '</div>'
      )
      .join('') +
    '</div>' +
    `<div class="verdict-box"><b>結構總評：</b>${esc(analysis.summary)}</div>` +
    '</div>' +
    // 3. Yahoo 風格互動 K 線 + 均線 + 成交量
    '<div class="card" style="margin-bottom:18px">' +
    '<div class="toolbar" style="justify-content:space-between;margin-bottom:12px">' +
    '<div class="toolbar" style="margin:0">' +
    `<div class="seg">${[['D', '日K'], ['W', '週K'], ['M', '月K']].map(([k, lbl]) => `<button type="button" data-tf="${k}" class="${state.detailTf === k ? 'on' : ''}">${lbl}</button>`).join('')}</div>` +
    `<div class="seg" style="${state.detailTf !== 'D' ? 'opacity:.45;pointer-events:none' : ''}">${[[22, '1個月'], [60, '3個月'], [120, '半年'], [250, '1年']].map(([n, lbl]) => `<button type="button" data-detail-range="${n}" class="${state.detailRange === n ? 'on' : ''}">${lbl}</button>`).join('')}</div>` +
    '</div>' +
    '<div class="legend" style="margin:0">' +
    [5, 10, 20, 60]
      .map(
        p =>
          `<label><input type="checkbox" data-detail-ma="${p}" ${state.detailMas[p] ? 'checked' : ''}><span style="color:${MA_COLORS[p]}">●</span>MA${p}</label>`
      )
      .join('') +
    '</div>' +
    '</div>' +
    '<div id="klineReadout" class="kline-readout"></div>' +
    '<canvas id="klineCanvas" class="kline-canvas" height="360"></canvas>' +
    '</div>' +
    // 4. 三大法人買賣超 / 融資融券變化
    '<div class="card">' +
    cardhead(
      '每日籌碼動向（單位：張）',
      '紅柱代表買超／融資增加，綠柱代表賣超／融資減少',
      `<div class="seg"><button type="button" data-detail-chip="inst" class="${state.detailChipTab === 'inst' ? 'on' : ''}">三大法人買賣超</button><button type="button" data-detail-chip="margin" class="${state.detailChipTab === 'margin' ? 'on' : ''}">融資融券變化</button></div>`
    ) +
    renderDetailChips(detail) +
    '</div>'
  );
}

function stock() {
  const code = state.stock;
  const qName = state.watchlistQuotes?.[code]?.name;
  const fallbackMkt = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(code) ? '待確認' : 'US';
  const info = D.stocks[code] || [qName || '未驗證股票名稱', fallbackMkt];
  const ds = archiveDays().filter(day => D.series[day]?.[code]);
  const latest = ds.at(-1);
  const chartBand = state.bands.length ? state.bands : [applied.band];
  const rawDays = state.manualWeek ? ds : dates().filter(day => D.series[day]?.[code]);

  if (!rawDays.includes(state.selectedDay)) {
    state.selectedDay = rawDays.at(-1) || '';
  }

  const latest400 = vector(code, latest, '400');
  const mode = state.stockMode || 'study';
  const modeLabel = mode === 'detail' ? '個股詳情' : '個股研究';
  const inFav = typeof isStockInAnyFolder === 'function' && isStockInAnyFolder(code);

  const backStrip =
    state.stockReturnPage === 'watchlist'
      ? '<div class="wl-back-strip">' +
        '<button type="button" class="btn sm" id="backToWatchlistBtn">← 返回股票收藏夾</button>' +
        `<span class="mini">已整合顯示「個股詳情 (K線/法人/資券)」、「個股研究 (TDCC)」與「全市場篩選檢核」</span>` +
        '</div>'
      : '';

  const headerControls =
    '<div class="stock-head-tools">' +
    `<button type="button" class="btn sm ${inFav ? 'fav-active' : ''}" data-quick-fav="${esc(code)}">${inFav ? '★ 已收藏' : '☆ 加入收藏'}</button>` +
    `<div class="toolbar" style="margin:0"><input id="stockCode" autocomplete="off" data-stock-suggest="ALL" data-suggest-submit="goStock" placeholder="輸入代號或股名（如 2330、台積）" value="${esc(code)}" style="width:210px"><button class="btn main" id="goStock">查詢</button></div>` +
    `<div id="modeSwitch" class="mode-pill-track" data-mode="${esc(mode)}" role="tablist" aria-label="個股模式切換">` +
    '<div class="mode-pill-thumb"></div>' +
    '<button type="button" class="mode-pill-btn" data-set-mode="study" id="btnStudy">1. 個股研究</button>' +
    '<button type="button" class="mode-pill-btn" data-set-mode="detail" id="btnDetail">2. 個股詳情</button>' +
    '</div>' +
    '</div>';

  const pageTitle =
    backStrip +
    title(
      `${modeLabel}｜${esc(code)} ${esc(info[0])}`,
      `市場：${esc(info[1])}　·　目前可驗證集保快照 ${ds.length} 期　·　原始股數直接重算`,
      headerControls
    );

  if (mode === 'detail') {
    return pageTitle + renderStockDetailMode(code, info);
  }

  return (
    pageTitle +
    (!ds.length
      ? '<div class="notice warn">沒有此股的集保原始資料；名稱可能來自舊市場名單。請在資料頁匯入可信集保 CSV。</div>'
      : '') +
    '<div class="metricgrid">' +
    metric('最後一次集保資料', latest || '—', '缺週時不拼接') +
    metric('400 張持股比例', latest400 ? fmt(latest400.pct, 3) + '%' : '—', '以最新快照的總股數為分母') +
    metric('總集保股數', fmt(latest400?.den), '股數／戶數分開追蹤') +
    metric('400 張戶數', fmt(latest400?.owner), '非持股人身分辨識') +
    '</div>' +
    '<div class="card">' +
    cardhead(
      '大戶累計持股比例',
      '同一座標對齊；遇缺週折線自動斷開',
      `<div class="seg"><button data-chart-range="all" class="${state.chartRange === 'all' ? 'on' : ''}">全部</button><button data-chart-range="recent" class="${state.chartRange === 'recent' ? 'on' : ''}">近三期</button></div>`
    ) +
    '<div class="legend" style="margin:0 0 12px">' +
    BAND_NAMES.map(
      b =>
        `<label><input type="checkbox" data-band="${b}" ${chartBand.includes(b) ? 'checked' : ''}><span style="color:${COLORS[b]}">●</span>${b} 張</label>`
    ).join('') +
    '</div>' +
    weeklyPlot(code, chartBand, state.chartRange) +
    '<p class="footnote">選取級距僅改變圖表，並不修改實際選股策略。400 張含千張級距，不能把兩條線相加。</p>' +
    '</div>' +
    signalTable(code) +
    '<div class="section"><h2>指定週原始股數（與訊號分開）</h2><span class="mini">股、張、人數、分母與公布證據分開顯示</span></div>' +
    '<div class="card">' +
    `<div class="toolbar"><select id="daySelect" class="select">${rawDays.map(d => `<option value="${d}" ${d === state.selectedDay ? 'selected' : ''}>${d}</option>`).join('')}</select></div>` +
    '<div class="tblwrap"><table><thead><tr><th>級距</th><th>占比 %</th><th>持有股數</th><th>持有張數</th><th>戶數</th><th>集保總股數</th></tr></thead><tbody>' +
    BAND_NAMES.map(b => {
      const v = vector(code, state.selectedDay, b);
      return (
        `<tr><td>${b} 張以上</td>` +
        `<td>${v ? fmt(v.pct, 6) : '—'}</td>` +
        `<td>${v ? fmt(v.shares) : '—'}</td>` +
        `<td>${v ? fmt(v.shares / 1000, 3) : '—'}</td>` +
        `<td>${v ? fmt(v.owner) : '—'}</td>` +
        `<td>${v ? fmt(v.den) : '—'}</td></tr>`
      );
    }).join('') +
    '</tbody></table></div>' +
    `<p class="footnote">${esc(state.selectedDay)} 最早已知公開證據：${esc(D.observed[state.selectedDay] || '未知，禁止嚴格時點重播')}。不是集保官方實際公布秒數。</p>` +
    '</div>'
  );
}

// === pages/backtest.js ===
/**
 * 頁面 04：回測與設定 A / B 比較 (backtest)
 */

function performanceEvidence() {
  const days = D.daily2404;
  const eventDay = days.findIndex(d => d[0] === '2026-11-16');
  const entry = eventDay >= 0 ? days[eventDay] : null;
  const close = days.at(-1);
  const available = entry && close && days.length - 1 - eventDay;

  return (
    '<div class="section"><h2>真正的收益回測驗收狀態</h2></div>' +
    '<div class="card">' +
    cardhead('漢唐 2404｜400 張真實已驗證事件', '不是模擬產生的勝率', badge('持有期未成熟', 'warn')) +
    '<div class="feature"><span>資料可用上界</span><b>2026-11-14 16:15:45</b></div>' +
    '<div class="feature"><span>第三週第一個觀察開盤</span><b>2026-11-16 09:00</b></div>' +
    `<div class="feature"><span>11-16 現有行情開盤</span><b>${entry ? fmt(entry[1], 2) : '缺資料'}</b></div>` +
    `<div class="feature"><span>觀測到的最後交易日</span><b>${close?.[0]}</b></div>` +
    `<div class="feature"><span>已經走完的後續交易日</span><b>${available ?? 0} 日</b></div>` +
    `<div class="feature"><span>預設持有期</span><b>${DEFAULT.profitDays} 個交易日</b></div>` +
    '<div class="notice" style="margin-top:16px;margin-bottom:0">正式報酬、勝率、損益比、最大回撤：<b>不可計算</b>（持有期不足，且跨全市場回測缺行情及當時可用性證據）。原始樣本沒有證明漲跌停是否能成交、沒有經股利調整的完整報酬。</div>' +
    '</div>' +
    '<div class="section"><h2>接近實用回測還缺什麼</h2></div>' +
    '<div class="grid2 equal">' +
    '<div class="card"><h3>已具備</h3><p class="help">全市場多期原始集保、按公開時間計算的週訊號、同一公式的 A/B 篩選、個股日行情樣本。</p></div>' +
    '<div class="card"><h3>仍欠缺</h3><p class="help">逐日歷史股票母體、各股日 K 和當時版本、公司行動、5/10/20/40 日已成熟的交易事件、交易可成交性驗證。</p></div>' +
    '</div>'
  );
}

function backtest() {
  const model = comparison();
  const rows = model.rows;

  const sideCard = (side, ctx) => {
    const stats = tally(rows.map(r => r[side]));
    const isA = side === 'a';
    return (
      `<div class="card" data-summary="${side}">` +
      cardhead(
        `${side.toUpperCase()}｜${ctx.cfg.weeks} 週（${ctx.cfg.band} 張 · ${fmt(ctx.cfg.minPp, 2)} pp）`,
        esc(ctx.dates.join(' → ') || '無連續交易週'),
        badge(isA ? '現行套用' : '草稿試算', isA ? 'good' : '')
      ) +
      `<div class="statbar">` +
      `<div><span class="mini">通過</span><strong class="${isA ? 'green' : 'blue'}">${fmt(stats.pass)}</strong></div>` +
      `<div><span class="mini">資料不足</span><strong>${fmt(stats.unknown)}</strong></div>` +
      `<div><span class="mini">母體</span><strong>${fmt(stats.all)}</strong></div>` +
      '</div>' +
      `<p class="footnote">通過 ${fmt(stats.pass)} · 不足 ${fmt(stats.unknown)} · 母體 ${fmt(stats.all)}｜${esc(ctx.issue || '依逐檔資料核對')}</p>` +
      '</div>'
    );
  };

  const comparable = rows.filter(r => !r.a.insufficient && !r.b.insufficient);
  const onlyA = comparable.filter(x => x.a.pass && !x.b.pass).length;
  const onlyB = comparable.filter(x => x.b.pass && !x.a.pass).length;
  const both = comparable.filter(x => x.a.pass && x.b.pass).length;
  const selected = rows.find(r => r.code === (state.compareCode || '2404'));

  return (
    title('回測與設定 A / B 比較', '固定 2026-11-13 名單作回溯比較，歷史逐日股票池待證。') +
    '<div class="card" style="margin-bottom:18px">' +
    `<div class="toolbar" style="margin-bottom:0">${wndSelect()}<button class="btn" data-nav="settings">編輯 B 草稿</button></div>` +
    '</div>' +
    `<div class="grid2 equal" style="margin-bottom:18px">${sideCard('a', model.a)}${sideCard('b', model.b)}</div>` +
    '<div class="card" style="margin-bottom:18px">' +
    cardhead('兩側資料足夠的比較', `可比 ${fmt(comparable.length)} 檔 · 僅 A 通過 ${fmt(onlyA)} · 僅 B 通過 ${fmt(onlyB)} · 共同通過 ${fmt(both)}`) +
    '<div class="statbar" style="margin-bottom:16px">' +
    `<div><span class="mini">兩側皆可比</span><strong>${fmt(comparable.length)}</strong></div>` +
    `<div><span class="mini">僅 A 通過</span><strong>${fmt(onlyA)}</strong></div>` +
    `<div><span class="mini">僅 B 通過</span><strong>${fmt(onlyB)}</strong></div>` +
    `<div><span class="mini">共同通過</span><strong class="green">${fmt(both)}</strong></div>` +
    '</div>' +
    '<div class="toolbar">' +
    `<label>逐檔核對 <input id="compareCode" value="${esc(state.compareCode || '2404')}" style="width:120px"></label>` +
    '<button class="btn sm" id="exportCompare">↓ 匯出全母體 A/B CSV</button>' +
    '</div>' +
    (selected
      ? `<p id="compareResult" class="help">${esc(`${selected.code} ${selected.name}｜A ${selected.a.status} · ${selected.a.reason}｜B ${selected.b.status} · ${selected.b.reason}`)}</p>`
      : '<p id="compareResult" class="help">查無此代號</p>') +
    '</div>' +
    '<div class="notice warn">正式報酬與勝率待歷史行情、公司行動及交易可行性驗收。</div>' +
    (historicalView() ? '' : performanceEvidence())
  );
}

// === pages/peak.js ===
/**
 * 頁面 05：底峰研究 (peak)
 */

function peak() {
  const cfg = state.peakConfig;
  const code = state.peakStock || '2404';
  const stockName = D.stocks[code]?.[0] || '';
  const titleLabel = stockName ? `${stockName} ${code}` : code;
  const bars = D.dailyByCode?.[code] || (code === '2404' ? D.daily2404 : []);
  const days = bars.map(x => x[0]);

  if (days.length) {
    if (!days.includes(state.peakBase)) {
      state.peakBase = days.includes('2026-10-30') ? '2026-10-30' : days[Math.max(0, days.length - 15)];
    }
    if (!days.includes(state.peakCompare)) {
      state.peakCompare = days.includes('2026-11-19') ? '2026-11-19' : days.at(-1);
    }
  }

  const result = state.peakLoading
    ? { error: `正在下載 ${titleLabel} 日 K 與已發行股數資料...` }
    : state.peakError
      ? { error: state.peakError }
      : modeledDistribution(state.peakBase, state.peakCompare, cfg, bars);

  const heading =
    `<span class="featured-title-wrap">${esc(titleLabel)}｜比較條件` +
    '<button type="button" class="icon-btn" id="editPeakStockBtn" title="更改股票" aria-label="更改股票">⚙</button>' +
    '</span>';

  const subtitle =
    '分布 = (1 − r) × 昨日分布 + r × 當日區間分布，r = 成交股數 / 已發行股數' +
    (days.length ? ` · 已載入 ${fmt(days.length)} 個交易日（${days[0]} ~ ${days.at(-1)}）` : '');

  const stockEditor = state.editingPeakStock
    ? '<div class="featured-editor">' +
      `<input id="peakStockCode" autocomplete="off" data-stock-suggest="TW" data-suggest-submit="changePeakStockBtn" placeholder="輸入代號或股名（如 2404、2330）" value="${esc(code)}" aria-label="更改股票代號">` +
      `<button type="button" class="btn main sm" id="changePeakStockBtn"${state.peakLoading ? ' disabled' : ''}>${state.peakLoading ? '載入中...' : '更換'}</button>` +
      '<button type="button" class="btn ghost sm" id="cancelPeakStockBtn">取消</button>' +
      '</div>'
    : '';

  const form =
    '<div class="formgrid">' +
    `<div class="field"><label>基準日（鎖定原價帶）</label><input type="date" id="peakBase" min="${days[0] || ''}" max="${days.at(-1) || ''}" value="${esc(state.peakBase)}"></div>` +
    `<div class="field"><label>比較日期</label><input type="date" id="peakCompare" min="${days[0] || ''}" max="${days.at(-1) || ''}" value="${esc(state.peakCompare)}"></div>` +
    `<div class="field"><label>模型暖機交易日</label><select data-peak-setting="warmup">${[150, 200, 500].map(n => `<option value="${n}" ${cfg.warmup === n ? 'selected' : ''}>${n} 日</option>`).join('')}</select></div>` +
    `<div class="field"><label>價格格寬（%）</label><select data-peak-setting="grid">${[0.75, 1, 1.25].map(n => `<option value="${n}" ${cfg.grid === n ? 'selected' : ''}>${n}%</option>`).join('')}</select></div>` +
    `<div class="field"><label>允許原帶下降（百分點）</label><input type="number" min="0" max="100" step="0.5" data-peak-setting="dropPp" value="${cfg.dropPp}"></div>` +
    `<div class="field"><label>底峰最低保留比例（%）</label><input type="number" min="0" max="100" step="1" data-peak-setting="retention" value="${cfg.retention}"></div>` +
    '</div>' +
    `<button class="btn main" id="calcPeak" style="margin-top:16px"${!days.length || state.peakLoading ? ' disabled' : ''}>重新計算成本分布</button>`;

  const resultBody = result.error
    ? `<div class="empty"><b>${esc(result.error)}</b>${state.peakLoading ? '請稍候...' : '可改為 150 或 200 日暖機，或選擇更晚的基準日。'}</div>`
    : '<div class="statbar">' +
      `<div><span class="mini">模型狀態</span><strong style="font-size:15px">${esc(result.result)}</strong></div>` +
      `<div><span class="mini">初始化殘留</span><strong>${fmt(result.initial * 100, 3)}%</strong></div>` +
      '</div>' +
      (result.c
        ? `<div class="feature"><span>原峰中心</span><strong>NT$ ${fmt(result.c.center, 2)}</strong></div>` +
          `<div class="feature"><span>原價帶基準占比</span><strong>${fmt(result.c.band * 100, 3)}%</strong></div>` +
          `<div class="feature"><span>比較日原帶占比</span><strong>${fmt(result.currentBand * 100, 3)}%</strong></div>` +
          `<div class="feature"><span>原帶占比變化</span><strong class="${sign(-result.drop)}">${pp(-result.drop)} pp</strong></div>` +
          `<div class="feature"><span>剩餘原帶比例</span><strong>${fmt(result.retain, 1)}%</strong></div>` +
          `<div class="feature"><span>鄰近峰位移</span><strong>${result.compPeak ? fmt(result.compPeak.k - result.c.k) + ' 格' : '附近無峰'}</strong></div>`
        : `<p class="notice" style="margin-top:14px">以基準前 ${cfg.rangeDays} 日高低與峰值條件檢視，該日沒有足夠證據鎖定底峰；模型仍會顯示分布，並非資料缺失。</p>`) +
      `<p class="footnote">比較期間現金除息事件數：${result.events.length}。跨事件請保守解讀，不能直接視為穩健訊號。</p>`;

  return (
    title(
      '低位籌碼峰｜研究模型',
      '使用實際日成交股數、當時股數估算與固定價格格，展示底峰是否留存。',
      badge('尚未正式驗收', 'warn')
    ) +
    '<div class="notice warn"><b>此頁是實際執行的探索模型，不是通過驗收的底峰訊號。</b>原始日 K 大多為事後回補資料，部分公司行動的當時可知證據未補齊。成本分布是換手率模型，不能識別真實持有人或直接當成主力成本。</div>' +
    '<div class="grid2">' +
    '<div class="card">' +
    cardhead(heading, subtitle) +
    stockEditor +
    form +
    '</div>' +
    '<div class="card">' +
    cardhead('原價帶保留判定', '條件與規格 v0.4 對齊', result.error ? badge('條件不足', 'warn') : badge('探索結果', 'warn')) +
    resultBody +
    '</div>' +
    '</div>' +
    (!result.error
      ? '<div class="section"><h2>價位成本分布</h2></div>' +
        `<div class="card">${distPlot(result)}<p class="footnote">基準模型回看起點 ${result.start}；以固定格寬 ${cfg.grid}% 估算。圖上只有分布形狀，尚未驗證與未來報酬的統計關係。</p></div>`
      : '')
  );
}

// === pages/settings.js ===
/**
 * 頁面 06：策略設定與方案管理 (settings)
 */

function settingsPage() {
  const s = draft;
  const field = (key, label, min, max, step, unit, desc) =>
    `<div class="field"><label>${label} <span class="mini">（${unit}）</span></label>` +
    `<input type="number" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}">` +
    `<small>${desc}</small></div>`;

  return (
    title(
      '策略設定與方案管理',
      '一套設定描述選股，B 草稿獨立做比較；不會因為改欄位就改變現行結果。',
      badge('參數保存在本機資料夾', '')
    ) +
    `<div class="notice good">現行選股：<b>${applied.band} 張 · ${applied.weeks} 週 · 累計 +${fmt(applied.minPp, 2)} 百分點</b>。此頁變更先存為 B 草稿，只有按「套用到選股」才會取代現行設定。</div>` +
    '<div class="grid2">' +
    '<div class="card">' +
    cardhead('常用選股條件', '大戶級距、連升週數與最低增幅門檻') +
    '<div class="formgrid">' +
    `<div class="field"><label>大戶級距（張）</label><select data-setting="band">${BAND_NAMES.map(b => `<option value="${b}" ${s.band === b ? 'selected' : ''}>${b} 張以上</option>`).join('')}</select><small>400 張預設含 1,000 張，四條線是重疊累計級距</small></div>` +
    `<div class="field"><label>連續增持週數</label><select data-setting="weeks">${[1, 2, 3, 4].map(n => `<option value="${n}" ${s.weeks === n ? 'selected' : ''}>${n} 週變動（${n + 1} 期快照）</option>`).join('')}</select><small>會依實際交易週檢查連續性，不跨缺週串接</small></div>` +
    field('minPp', '累計持股最低增加', 0, 20, 0.01, '百分點', '+0.20 pp = 40.00% → 40.20%') +
    field('weeklyMin', '每一週最低增加', 0, 10, 0.01, '百分點', '0 代表只要求每次嚴格大於 0；0.05 是強化條件') +
    `<div class="checkfield"><input id="setShares" type="checkbox" data-setting="needShares" ${s.needShares ? 'checked' : ''}><label for="setShares">要求每週級距股數同時增加</label></div>` +
    `<div class="checkfield"><input id="setPeak" type="checkbox" data-setting="needPeak" ${s.needPeak ? 'checked' : ''}><label for="setPeak">同時要求低位峰保留（未驗收保持待證）</label></div>` +
    `<div class="checkfield fullrow"><input id="setPrice" type="checkbox" data-setting="needPrice" ${s.needPrice ? 'checked' : ''}><label for="setPrice">同時要求價格確認（未取得可靠日 K 保持待證）</label></div>` +
    '</div>' +
    '</div>' +
    '<div class="card">' +
    cardhead('保存與應用', '保留現行方案與研究草稿，歷史原始資料不隨調參變動') +
    `<div class="feature"><span>A｜目前已套用的方案</span><b>${applied.band} 張 / ${fmt(applied.minPp, 2)} pp</b></div>` +
    `<div class="feature"><span>B｜本次草稿</span><b>${s.band} 張 / ${fmt(s.minPp, 2)} pp</b></div>` +
    '<div class="toolbar" style="margin-top:18px">' +
    '<button class="btn main" id="applySetting">✓ 套用 B 到選股</button>' +
    '<button class="btn" id="goCompare">先跑 A/B 比較 →</button>' +
    '</div>' +
    '<div class="toolbar">' +
    '<button class="btn ghost sm" id="resetDraft">恢復原始預設</button>' +
    '<button class="btn ghost sm" id="copyApplied">複製現行到 B</button>' +
    '<button class="btn ghost sm" id="savePreset">另存方案</button>' +
    '</div>' +
    '<div class="line"></div>' +
    '<h3 style="margin-bottom:10px">已保存的研究方案</h3>' +
    '<div class="tblwrap"><table><thead><tr><th>名稱</th><th>級距／門檻</th><th>操作</th></tr></thead><tbody>' +
    presets
      .map(
        (p, i) =>
          `<tr><td>${esc(p.name)}</td><td>${p.settings.band} 張 / ${fmt(Number(p.settings.minPp), 2)} pp</td><td><button class="tableaction" data-load-preset="${i}">載入草稿</button></td></tr>`
      )
      .join('') +
    '</tbody></table></div>' +
    '<div class="toolbar" style="margin-top:16px;margin-bottom:0">' +
    '<button class="btn sm" id="exportPresets">↓ 匯出設定 JSON</button>' +
    '<label class="btn sm" style="cursor:pointer">↑ 匯入設定 JSON<input type="file" accept=".json,application/json" id="importPresets" hidden></label>' +
    '</div>' +
    '</div>' +
    '</div>' +
    '<div class="section"><h2>進階研究與成交參數</h2></div>' +
    '<div class="card">' +
    '<div class="notice warn">此處先完整保留設定欄位。底峰模型使用暖機、格寬與保留比例等參數；收益計算需要價格資料及事件驗收，不能只靠輸入費率就虛構績效。</div>' +
    '<div class="formgrid">' +
    `<div class="field"><label>成本分布暖機交易日</label><select data-setting="warmup">${[150, 200, 500].map(n => `<option value="${n}" ${s.warmup === n ? 'selected' : ''}>${n} 日</option>`).join('')}</select><small>150／200／500 日三種研究版本</small></div>` +
    field('grid', '價格格寬', 0.5, 2, 0.25, '%', '主要網格預設 1%，可做 .75% 與 1.25% 敏感性對照') +
    field('retention', '原底峰最低保留比例', 0, 100, 1, '%', '原始價帶在後期的保留幅度') +
    field('dropPp', '原價帶最大占比下降', 0, 30, 0.5, '百分點', '固定原帶占比下降超過值視為失敗') +
    field('lowPosition', '底峰低位限制', 5, 80, 5, '%', '原峰中心需在近期高低區間下方比例') +
    field('peakMin', '原帶最低占比', 0, 60, 1, '%', '原始五格未平滑占比') +
    field('rangeDays', '低位區間回看', 20, 250, 10, '交易日', '範圍與基準日期同時固定') +
    field('profitDays', '預設回測持有', 5, 100, 5, '交易日', '歷史結果是否成熟要用後續實際交易日核對') +
    field('feeBuy', '模擬買入費率', 0, 0.03, 0.0001, '比率', '0.001425 = 0.1425%') +
    field('feeSell', '模擬賣出成本', 0, 0.03, 0.0001, '比率', '含交易費及交易稅，單位是比率') +
    field('slip', '單邊滑價', 0, 0.03, 0.0001, '比率', '0.001 = 0.1%；回測扣成本用') +
    '</div>' +
    '</div>'
  );
}

// === pages/data.js ===
/**
 * 頁面 07：資料來源、匯入與驗收 (data)
 */

function dataPage() {
  const ds = dates();
  const count = Object.keys(D.stocks).length;
  const records = Object.values(D.quality).reduce((a, b) => a + b.valid, 0);

  return (
    title(
      '資料來源、匯入與驗收',
      '資料檔與訊號的時點可追溯，未知時間絕不冒充已公布。',
      badge('固定研究版本 ' + D.run)
    ) +
    '<div class="metricgrid">' +
    metric('已存集保快照', ds.length, '含本機快照') +
    metric('級距驗證成功的股期', fmt(records), '按四碼上市櫃候選母體') +
    metric('母體股票', fmt(count), '2026-11-13 當期行情備份') +
    metric('核對日 K', fmt(D.daily2404.length), '只有漢唐 2404 的完整日序列') +
    '</div>' +
    '<div class="notice">CSV 第 16 級是差異調整。固定資料逐檔核對第 1–15 級股數和減第 16 級等於第 17 級，戶數只加第 1–15 級。11/13 有 29 檔非零調整，已納入母體。資料不足列保留原因。</div>' +
    '<div class="card">' +
    cardhead('每期資料可用性', '日期、來源版本與最早已知公開證據相互獨立') +
    '<div class="tblwrap"><table><thead><tr><th>統計日</th><th>可驗證股票數</th><th>資料品質剔除</th><th>最晚已知公開時間（台北）</th><th>時點性</th></tr></thead><tbody>' +
    ds
      .map(
        day =>
          `<tr><td><b>${day}</b></td>` +
          `<td>${fmt(D.quality[day]?.valid || 0)}</td>` +
          `<td>${fmt(D.quality[day]?.invalid || 0)}</td>` +
          `<td>${esc(D.observed[day] || '未取得')}</td>` +
          `<td>${D.observed[day] ? badge(officialWeeks[day] ? '官方已取得' : '備份可得', 'good') : badge('待證', 'warn')}</td></tr>`
      )
      .join('') +
    '</tbody></table></div>' +
    `<p class="footnote">資料版本：${D.run}。備份取得時間不是交易當下公布時間；原集保官方上架的精確時刻仍待證。</p>` +
    '</div>' +
    '<div class="section"><h2>匯入更多集保歷史資料</h2></div>' +
    '<div class="grid2">' +
    '<div class="card">' +
    cardhead('匯入官方 1-5 集保 CSV', '驗證 1–17 級股數、戶數與分母，通過後自動持久化於本機') +
    '<div class="filezone">' +
    '<b>選擇集保原始 CSV 檔案</b>' +
    '<p class="mini" style="margin:4px 0 8px">需含：資料日期、證券代號、持股分級、人數、股數</p>' +
    '<input type="file" id="importTDCC" accept=".csv,text/csv" multiple>' +
    '</div>' +
    '<p class="footnote">新匯入期的發布時間無法由 CSV 單獨證明，因此顯示「公布時點待證」，不能用於嚴格回測。原本已驗證的資料禁止覆蓋。</p>' +
    `<div id="importStatus" class="mini" style="margin-top:8px">${esc(storageSummary())}</div>` +
    '</div>' +
    '<div class="card">' +
    cardhead('來源及資料品管', '目前各資料維度之驗收狀態') +
    `<div class="feature"><span>TDCC 集保股權分散</span>${badge('已核對分級', 'good')}</div>` +
    `<div class="feature"><span>市場行情與公司股數</span>${badge('分層樣本驗收', 'good')}</div>` +
    `<div class="feature"><span>公司行動、個股退市</span>${badge('部分樣本', 'warn')}</div>` +
    `<div class="feature"><span>全市場日 K 的當時可知版本</span>${badge('尚未取得', 'warn')}</div>` +
    `<div class="feature"><span>正式 5/10/20/40 日報酬</span>${badge('不可宣稱', 'warn')}</div>` +
    '<p class="footnote">公開資料來源可能有取用與再傳輸限制；本版僅供個人離線研究，不包含商業再授權。</p>' +
    '</div>' +
    '</div>' +
    '<div class="section"><h2>查看原始驗收證據</h2></div>' +
    '<div class="card">' +
    '<div class="toolbar">' +
    '<button class="btn sm" id="exportQuality">↓ 匯出目前資料清單</button>' +
    '<button class="btn sm" id="export2404">↓ 匯出 2404 日線 CSV</button>' +
    '<button class="btn sm" id="exportWeekly">↓ 匯出 2404 集保 CSV</button>' +
    '</div>' +
    `<div class="notice" style="margin-bottom:12px"><b>完整原始資料仍留在壓縮包：</b><code>evidence/raw/</code>、<code>evidence/runs/</code>、<code>reports/${D.run}/</code>。本介面僅讀取經驗收的數值，不會改動原始證據。</div>` +
    '<p class="help">官方原始資料：<a href="https://www.tdcc.com.tw/portal/zh/smWeb/qryStock" target="_blank" rel="noopener">集保查詢</a>、<a href="https://www.twse.com.tw/" target="_blank" rel="noopener">證交所</a>、<a href="https://www.tpex.org.tw/" target="_blank" rel="noopener">櫃買中心</a>。集保與交易日曆會在開啟後背景更新，離線時保留已驗證資料。</p>' +
    '</div>'
  );
}

// === app.js ===
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
