// Desktop storage adapter. Included between the v0.5 constants and the UI state.
const storageNotes = [];
function loadLocal(kind) {
  const result = window.desktopStore.read(kind);
  if (!result.ok) storageNotes.push('無法讀取本機檔案：' + result.error);
  if (result.slot && result.slot !== 'current') storageNotes.push((kind === 'settings' ? '策略設定' : '資料快照') + '已從備份復原');
  else if (!result.slot && result.damaged) storageNotes.push('本機檔案損毀，已載入預設內容');
  return result;
}
const configFile = loadLocal('settings'), snapshotFile = loadLocal('snapshot');
let savedConfig, savedWeeks = snapshotFile.value || {};
function legacy(key, fallback) {
  try { const text = localStorage.getItem('chipscr_' + key); return text === null ? fallback : JSON.parse(text); }
  catch { return fallback; }
}
function getConfig() {
  const applied = configFile.value?.applied ?? legacy('applied', {});
  const draft = configFile.value?.draft ?? legacy('draft', applied);
  const presets = configFile.value?.presets ?? legacy('presets', [{name:'原始 v0.4',settings:DEFAULT}]);
  return {
    format:'chip-screener-config-v1', applied:validateSettings(applied), draft:validateSettings(draft),
    presets:presets.map(p => ({name:String(p.name).slice(0,50),settings:validateSettings(p.settings)}))
  };
}
try { savedConfig = getConfig(); }
catch {
  storageNotes.push('舊策略格式無效，已載入原始策略');
  savedConfig = {format:'chip-screener-config-v1',applied:DEFAULT,draft:DEFAULT,presets:[{name:'原始 v0.4',settings:DEFAULT}]};
}
let {applied,draft,presets} = structuredClone(savedConfig);
function persist(kind, value) {
  const result = window.desktopStore.save(kind,value);
  if(!result.ok) throw Error('本機寫入失敗，保留上次成功資料：' + result.error);
  if(!result.redundant) storageNotes.push('本次已保存，備份寫入失敗');
}
function saveConfig() {
  const next = {format:'chip-screener-config-v1',applied,draft,presets};
  try {
    persist('settings',next);
    savedConfig = structuredClone(next);
    return true;
  } catch (e) {
    ({applied,draft,presets} = structuredClone(savedConfig));
    render(); toast(e.message); return false;
  }
}
// Migrate existing B02 Local Storage without modifying its original keys.
if (!configFile.value && configFile.ok && !configFile.damaged && ['applied','draft','presets'].some(key => legacy(key,null) !== null)) {
  try { persist('settings', savedConfig); } catch(e) { storageNotes.push(e.message); }
}
function applyWeek(day, week) {
  D.series[day] = week.rows;
  D.observed[day] = week.observed;
  D.quality[day] = week.quality;
  if (!D.dates.includes(day)) D.dates.push(day);
  D.dates.sort();
  for (const code of Object.keys(week.rows)) if (!D.stocks[code]) D.stocks[code] = ['名稱待證','?'];
}
for (const [day, week] of Object.entries(savedWeeks)) {
  // An upgraded embedded baseline has precedence for its own fixed dates.
  if (!Object.hasOwn(D.series,day)) applyWeek(day,week);
}
function saveWeek(day, rows, invalid, filename) {
  const week = {rows, observed:null, quality:{valid:Object.keys(rows).length,invalid,raw_source:'手動匯入 '+filename}};
  const next = {...savedWeeks,[day]:week};
  persist('snapshot', next);
  savedWeeks = next;
  applyWeek(day,week);
}
function storageSummary() {
  const days = Object.keys(savedWeeks).sort();
  return '桌面版 ' + (snapshotFile.version || configFile.version || '未知') +
    '｜本機快照 ' + days.length + ' 期' + (days.length ? '｜' + days.at(-1) + '｜' + savedWeeks[days.at(-1)].quality.raw_source : '｜使用內建資料') +
    (storageNotes.length ? '｜' + [...new Set(storageNotes)].join('；') : '');
}
