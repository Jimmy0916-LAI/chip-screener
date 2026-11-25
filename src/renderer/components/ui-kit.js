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
    '<th>倒數第二週</th><th>最新一週</th><th>股數變化（股）</th><th>判定</th>' +
    '</tr></thead><tbody>' +
    rows
      .map(
        x =>
          `<tr class="clickable" data-stock="${esc(x.code)}">` +
          `<td><b>${ticker(x.code)}</b></td>` +
          `<td>${esc(x.market)}</td>` +
          `<td>${applied.band} 張</td>` +
          `<td class="${sign(x.gain)}">${pp(x.gain, 3)} pp</td>` +
          `<td>${pp(x.delta?.at(-2), 3)}</td>` +
          `<td>${pp(x.delta?.at(-1), 3)}</td>` +
          `<td>${x.deltaShares ? x.deltaShares.map(v => (v >= 0 ? '+' : '') + fmt(v)).join(' / ') : '—'}</td>` +
          `<td>${badge(x.status, x.pass ? 'good' : x.insufficient ? 'warn' : '')}<small>${esc(x.reason)}</small></td>` +
          '</tr>'
      )
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
