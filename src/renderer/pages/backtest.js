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
