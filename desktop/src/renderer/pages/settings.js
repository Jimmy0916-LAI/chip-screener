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
    signalSettings(draft.signals || DEFAULT_SIGNAL_STRATEGY) +
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

function signalSettings(config) {
  const checked = id => config.enabled.includes(id) ? ' checked' : '';
  const input = (id, label, min, max, value) =>
    `<label>${label} <input id="${id}" type="number" min="${min}" max="${max}" value="${value}"></label>`;
  return '<div class="card" id="signalSettings"><h3>多條件訊號</h3>' +
    '<p class="help">集保條件沿用上方級距與週門檻。日 K 依交易日曆、價格快取與評估時點判定。</p>' +
    '<div class="toolbar"><label>組合方式 <select id="signalMode">' +
    `<option value="all"${config.mode === 'all' ? ' selected' : ''}>全部符合</option>` +
    `<option value="any"${config.mode === 'any' ? ' selected' : ''}>任一符合</option>` +
    '</select></label></div>' +
    '<div class="formgrid">' +
    `<label><input id="signalTdcc" type="checkbox"${checked('tdcc')}>大股東連續增持</label>` +
    `<label><input id="signalMacd" type="checkbox"${checked('macd')}>日線 MACD 黃金交叉</label>` +
    `<label><input id="signalBreakout" type="checkbox"${checked('breakout')}>突破前 N 日高點</label>` +
    input('signalFast', 'MACD 快線', 2, 60, config.macd.fast) +
    input('signalSlow', 'MACD 慢線', 3, 120, config.macd.slow) +
    input('signalPeriod', 'MACD 訊號線', 2, 60, config.macd.signal) +
    input('signalLookback', '前高回看交易日', 2, 120, config.breakoutDays) +
    '</div></div>';
}

function updateSignalDraft() {
  try {
    const enabled = ['tdcc', 'macd', 'breakout'].filter(id =>
      document.getElementById('signal' + id[0].toUpperCase() + id.slice(1)).checked);
    const number = id => document.getElementById(id).valueAsNumber;
    const signals = validateSignalStrategy({
      version: 1, mode: $('#signalMode').value, enabled,
      macd: { fast: number('signalFast'), slow: number('signalSlow'), signal: number('signalPeriod') },
      breakoutDays: number('signalLookback')
    });
    draft = { ...draft, signals };
    saveConfig();
  } catch (error) {
    render();
    toast(error.message);
  }
}
