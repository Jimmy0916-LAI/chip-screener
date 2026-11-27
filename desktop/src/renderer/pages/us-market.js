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
          `<td data-live-tbl-price="${esc(r.code)}" data-live-currency="USD" style="font-variant-numeric:tabular-nums"><b>$${fmt(r.price, 2)}</b></td>` +
          `<td data-live-tbl-chg="${esc(r.code)}" data-live-pct-only="1" class="${cls}" style="font-variant-numeric:tabular-nums;font-weight:700">${arrow} ${pp(r.changePct, 2)}%</td>` +
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
    `<button type="button" class="btn sm" id="refreshUsOverviewBtn"${state.usOverviewLoading ? ' disabled' : ''}>${state.usOverviewLoading ? '更新中...' : '↻ 更新股價'}</button>` +
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
    return head + '<div class="card"><div class="empty">點擊右上角「↻ 更新股價」載入美股最新市場快照</div></div>';
  }

  const idxCards = (ov.indices || [])
    .map(idx => {
      const hasVal = typeof idx.price === 'number';
      const cls = !hasVal ? '' : idx.change > 0 ? 'tw-up' : idx.change < 0 ? 'tw-down' : 'wl-pnl-flat';
      const arrow = !hasVal ? '' : idx.change > 0 ? '▲' : idx.change < 0 ? '▼' : '';
      return (
        `<div class="index-card" data-live-idx="${esc(idx.symbol || idx.code || idx.name)}">` +
        `<div class="idx-head"><span>${esc(idx.name)}</span><span class="mini">${esc(idx.tag)}</span></div>` +
        `<div class="idx-price ${cls}" data-live-idx-price="${esc(idx.symbol || idx.code || '')}">${hasVal ? fmt(idx.price, 2) : '—'}</div>` +
        `<div class="idx-chg ${cls}" data-live-idx-chg="${esc(idx.symbol || idx.code || '')}">${hasVal ? `${arrow} ${pp(idx.change, 2)} (${pp(idx.changePct, 2)}%)` : '暫無報價'}</div>` +
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
          `<td data-live-tbl-price="${esc(r.code)}" data-live-currency="USD" style="font-variant-numeric:tabular-nums"><b>$${fmt(r.price, 2)}</b></td>` +
          `<td data-live-tbl-chg="${esc(r.code)}" data-live-pct-only="1" class="${cls}" style="font-variant-numeric:tabular-nums;font-weight:700">${arrow} ${pp(r.changePct, 2)}%</td>` +
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
      `<div><span class="mini">現價市值 (USD)</span><strong data-live-detail="holdingMarketVal" data-live-code="${esc(code)}">${marketVal !== null ? `$${fmt(marketVal, 2)}` : '—'}</strong></div>` +
      `<div><span class="mini">購入總成本 (USD)</span><strong>${costTotal !== null ? `$${fmt(costTotal, 2)}` : '—'}</strong></div>` +
      `<div><span class="mini">未實現損益 (USD)</span><strong data-live-detail="holdingPnl" data-live-code="${esc(code)}" class="${pnlCls}">${pnlTotal !== null ? `${signStr}$${fmt(Math.abs(pnlTotal), 2)} ` : ''}(${pct > 0 ? '+' : ''}${fmt(pct, 2)}%)</strong></div>` +
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
    `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">${badge(detail.exchange || 'US', '')}${detail.sector ? badge(detail.sector, '') : ''}${modeBadges}<span class="mini" data-live-detail="statusText" data-live-code="${esc(code)}">資料日 ${esc(last[0])} 收盤 · USD</span></div>` +
    '<div class="quote-price-row">' +
    `<span class="quote-price ${dirClass}" data-live-detail="price" data-live-code="${esc(code)}">$${fmt(last[4], 2)}</span>` +
    `<span class="quote-chg-badge ${chg > 0 ? 'tw-up-bg' : chg < 0 ? 'tw-down-bg' : ''}" data-live-detail="chgBadge" data-live-code="${esc(code)}">${arrow} $${fmt(Math.abs(chg), 2)} (${pp(chgPct, 2)}%)</span>` +
    '</div>' +
    '</div>' +
    '<div class="quote-grid">' +
    `<div class="quote-cell"><div class="label">開盤</div><div class="val" data-live-detail="open" data-live-code="${esc(code)}">$${fmt(last[1], 2)}</div></div>` +
    `<div class="quote-cell"><div class="label">最高</div><div class="val tw-up" data-live-detail="high" data-live-code="${esc(code)}">$${fmt(last[2], 2)}</div></div>` +
    `<div class="quote-cell"><div class="label">最低</div><div class="val tw-down" data-live-detail="low" data-live-code="${esc(code)}">$${fmt(last[3], 2)}</div></div>` +
    `<div class="quote-cell"><div class="label">昨收</div><div class="val" data-live-detail="prevClose" data-live-code="${esc(code)}">$${fmt(prev[4], 2)}</div></div>` +
    `<div class="quote-cell"><div class="label">成交量</div><div class="val" data-live-detail="vol" data-live-code="${esc(code)}">${fmtUsShares(last[5])}</div></div>` +
    `<div class="quote-cell"><div class="label">當日振幅</div><div class="val" data-live-detail="amp" data-live-code="${esc(code)}">${fmt(ampPct, 2)}%</div></div>` +
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
