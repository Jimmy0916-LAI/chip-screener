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

function wndSelect(displayAsOf) {
  const instant = Date.parse(displayAsOf);
  const asOf = Number.isFinite(instant)
    ? new Date(instant + 8 * 60 * 60 * 1000).toISOString()
    : state.asOf || evidenceTime(state.win);
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
    (ctx.issue ? `<p class="notice warn" id="stockSignalAvailability">嚴格週訊號資料不足（需 ${applied.weeks + 1} 期連續快照）｜${esc(ctx.issue)}</p>` : '') +
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
