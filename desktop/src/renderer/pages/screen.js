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
