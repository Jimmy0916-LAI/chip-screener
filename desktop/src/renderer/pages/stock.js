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
      `<div><span class="mini">現價市值（算法1）</span><strong data-live-detail="holdingMarketVal" data-live-code="${esc(code)}">${marketVal !== null ? `${fmt(marketVal, 0)} 元` : '—'}</strong></div>` +
      `<div><span class="mini">購入總成本（算法2）</span><strong>${costTotal !== null ? `${fmt(costTotal, 0)} 元` : '—'}</strong></div>` +
      `<div><span class="mini">未實現損益</span><strong data-live-detail="holdingPnl" data-live-code="${esc(code)}" class="${pnlCls}">${pnlTotal !== null ? `${pnlTotal > 0 ? '+' : ''}${fmt(pnlTotal, 0)} 元 ` : ''}(${pct > 0 ? '+' : ''}${fmt(pct, 2)}%)</strong></div>` +
      '</div></div>';
  }

  return (
    // 1. Yahoo 風格報價看板
    '<div class="card" style="margin-bottom:18px">' +
    '<div class="quote-top">' +
    '<div>' +
    `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">${badge(info[1] || 'TWSE', '')}<span class="mini" data-live-detail="statusText" data-live-code="${esc(code)}">資料日 ${esc(last[0])} 收盤 · 台股紅漲綠跌</span></div>` +
    '<div class="quote-price-row">' +
    `<span class="quote-price ${dirClass}" data-live-detail="price" data-live-code="${esc(code)}">${fmt(last[4], dp)}</span>` +
    `<span class="quote-chg-badge ${chg > 0 ? 'tw-up-bg' : chg < 0 ? 'tw-down-bg' : ''}" data-live-detail="chgBadge" data-live-code="${esc(code)}">${arrow} ${fmt(Math.abs(chg), dp)} (${pp(chgPct, 2)}%)</span>` +
    '</div>' +
    '</div>' +
    '<div class="quote-grid">' +
    `<div class="quote-cell"><div class="label">開盤</div><div class="val" data-live-detail="open" data-live-code="${esc(code)}">${fmt(last[1], dp)}</div></div>` +
    `<div class="quote-cell"><div class="label">最高</div><div class="val tw-up" data-live-detail="high" data-live-code="${esc(code)}">${fmt(last[2], dp)}</div></div>` +
    `<div class="quote-cell"><div class="label">最低</div><div class="val tw-down" data-live-detail="low" data-live-code="${esc(code)}">${fmt(last[3], dp)}</div></div>` +
    `<div class="quote-cell"><div class="label">昨收</div><div class="val" data-live-detail="prevClose" data-live-code="${esc(code)}">${fmt(prev[4], dp)}</div></div>` +
    `<div class="quote-cell"><div class="label">成交量(張)</div><div class="val" data-live-detail="vol" data-live-code="${esc(code)}">${fmt(last[5])}</div></div>` +
    `<div class="quote-cell"><div class="label">當日振幅</div><div class="val" data-live-detail="amp" data-live-code="${esc(code)}">${fmt(ampPct, 2)}%</div></div>` +
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
    `<label><input type="checkbox" id="overlayK" ${state.overlayK?'checked':''}>疊加日 K</label>` +
    '</div>' +
    holdingChart((state.chartRange === 'recent' ? archiveDays().slice(-3) : archiveDays()).map(d=>[d,D.series[d]?.[code] || null]), stockBars(code), chartBand, D.sessions, !!state.overlayK) +
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
