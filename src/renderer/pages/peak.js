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
      `<input id="peakStockCode" placeholder="輸入代號（如 2404、2330、0050）" value="${esc(code)}" aria-label="更改股票代號">` +
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
