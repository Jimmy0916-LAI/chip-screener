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

D.dailyByCode = D.dailyByCode || { '2404': D.daily2404 };

let state = {
  page: 'home',
  stock: '2404',
  stockMode: 'study',
  stockDetailByCode: {},
  stockDetailLoading: false,
  stockDetailError: '',
  detailTf: 'D',
  detailRange: 60,
  detailMas: { 5: true, 10: true, 20: true, 60: true },
  detailChipTab: 'inst',
  detailHoverIdx: null,
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
