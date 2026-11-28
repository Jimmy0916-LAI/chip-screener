/**
 * 頁面 01：研究總覽 (home)
 */

function renderFeaturedCase(win) {
  if (historicalView()) return '';

  const code = state.featuredCode || '2404';
  const stockInfo = D.stocks[code] || ['未驗證名稱', '?'];
  const name = stockInfo[0] || code;
  const sig = weeklySignal(code, win);
  const firstPct = sig.values?.[0]?.pct;
  const lastPct = sig.values?.at(-1)?.pct;
  const hasRange = Number.isFinite(firstPct) && Number.isFinite(lastPct);
  const dateRangeText = win?.dates?.length ? win.dates.join(' → ') : '尚無完整連續交易週';
  const statusBadge = sig.pass
    ? badge('原始數值已驗證', 'good')
    : sig.insufficient
      ? badge(sig.status, 'warn')
      : badge(sig.status, '');

  const editor = state.editingFeatured
    ? '<div class="featured-editor">' +
      `<input id="featuredCodeInput" autocomplete="off" data-stock-suggest="TW" data-suggest-submit="saveFeaturedBtn" placeholder="輸入代號或股名（如 0050、2330）" value="${esc(code)}" aria-label="更改固定驗收案例代號">` +
      '<button type="button" class="btn main sm" id="saveFeaturedBtn">更改</button>' +
      '<button type="button" class="btn ghost sm" id="cancelFeaturedBtn">取消</button>' +
      '</div>'
    : '';

  const shareChangeText = sig.deltaShares
    ? sig.deltaShares.map(v => (v >= 0 ? '+' : '') + fmt(v)).join(' / ') + ' 股'
    : '—';

  const heading =
    `<span class="featured-title-wrap">${esc(name)} ${esc(code)}｜固定驗收案例` +
    '<button type="button" class="icon-btn" id="editFeaturedBtn" title="更改固定驗收案例" aria-label="更改固定驗收案例">⚙</button>' +
    '</span>';

  return (
    '<div class="card hot">' +
    cardhead(heading, esc(dateRangeText), statusBadge) +
    editor +
    `<div class="feature"><span class="muted">${esc(applied.band)} 張大戶持股比例</span><strong>${hasRange ? `${fmt(firstPct, 3)}% → ${fmt(lastPct, 3)}%` : '—'}</strong></div>` +
    '<div class="statbar">' +
    `<div><span class="mini">${applied.weeks} 週累計</span><strong class="${sign(sig.gain)}">${Number.isFinite(sig.gain) ? pp(sig.gain, 6) + ' pp' : '—'}</strong></div>` +
    `<div><span class="mini">持股變化</span><strong>${esc(shareChangeText)}</strong></div>` +
    '</div>' +
    `<div style="margin-top:16px">${weeklyPlot(code, [applied.band], 'all')}</div>` +
    `<p class="footnote">證據最晚可得：${esc(sig.knownDate || '未知')}；最早觀察開盤：${esc(sig.eligible || '待核')}。${sig.insufficient ? esc('狀態：' + sig.reason + '。') : ''}不是經績效驗證的進場建議。</p>` +
    `<button class="btn main sm" data-stock="${esc(code)}" style="margin-top:12px">打開${esc(name)}完整分析 →</button>` +
    '</div>'
  );
}

function home() {
  const win = evaluation(applied);
  const rows = scan();
  const t = tally(rows);
  const best = rows
    .filter(x => x.pass)
    .sort((a, b) => b.gain - a.gain)
    .slice(0, 8);

  return (
    title(
      '台股籌碼研究總覽',
      '以集保分級股數計算，先找到異動，再辨別證據是否足以支持交易。',
      '<button class="btn main" data-nav="screen">查看完整篩選結果 →</button>'
    ) +
    '<div class="notice warn"><b>研究範圍聲明：</b>篩選需要連續且已驗證的集保週資料。歷史視窗採固定研究母體，可能有存活偏差。除漢唐外，逐檔公司行動與正式回測未通過驗收。不是即時報價或買賣訊號。</div>' +
    '<div class="metricgrid">' +
    metric('目前候選股票池', fmt(t.all), '四碼非零開頭、上市櫃普通股') +
    metric('所選窗口通過數', fmt(t.pass), `級距 ${applied.band} 張 · 門檻 ${fmt(applied.minPp, 2)} pp`, 'green') +
    metric('資料／條件待證', fmt(t.unknown), '不列為正式有效進場') +
    metric('日 K 已核對', fmt(D.daily2404.length), '漢唐 2404 · 2024–2026') +
    '</div>' +
    '<div class="grid2">' +
    '<div class="card">' +
    cardhead('所選窗口增持候選', `同一最後週 ${esc(win?.end || '—')} · 依累計增幅排序`, settingsHint()) +
    (best.length
      ? '<div class="tblwrap"><table><thead><tr><th>個股</th><th>增幅</th><th>股數連增</th><th>訊號</th></tr></thead><tbody>' +
        best
          .map(
            x =>
              `<tr class="clickable" data-stock="${x.code}">` +
              `<td><b>${ticker(x.code)}</b></td>` +
              `<td class="green">${pp(x.gain)} pp</td>` +
              `<td>${x.deltaShares.map(v => '＋' + fmt(v)).join(' / ')}</td>` +
              `<td>${badge('週訊號候選', 'good')}</td>` +
              '</tr>'
          )
          .join('') +
        '</tbody></table></div>'
      : '<div class="empty">目前參數無通過候選</div>') +
    '<button class="btn ghost sm" data-nav="screen" style="margin-top:16px">展開所有股票 →</button>' +
    '</div>' +
    renderFeaturedCase(win) +
    '</div>' +
    '<div class="section"><h2>工作流程與交付能力</h2></div>' +
    '<div class="grid2 equal">' +
    '<div class="card">' +
    `<div class="feature"><strong>01. 篩選與比較</strong>${badge('可使用', 'good')}</div>` +
    `<div class="feature"><strong>02. 大戶級距切換與日期明細</strong>${badge('可使用', 'good')}</div>` +
    `<div class="feature"><strong>03. 本機策略方案與 A/B 訊號比較</strong>${badge('可使用', 'good')}</div>` +
    `<div class="feature"><strong>04. 全市場正式報酬回測</strong>${badge('待資料驗收', 'warn')}</div>` +
    '</div>' +
    '<div class="card">' +
    `<div class="feature"><strong>05. 漢唐日線與成交量</strong>${badge('可使用', 'good')}</div>` +
    `<div class="feature"><strong>06. 成本分布／底峰探索計算</strong>${badge('研究版', 'warn')}</div>` +
    `<div class="feature"><strong>07. 跨裝置雲端同步</strong>${badge('尚未部署', 'warn')}</div>` +
    `<div class="feature"><strong>08. 新資料匯入與 CSV 匯出</strong>${badge('可使用', 'good')}</div>` +
    '</div>' +
    '</div>'
  );
}
