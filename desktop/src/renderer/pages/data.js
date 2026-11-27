/**
 * 頁面 07：資料來源、匯入與驗收 (data)
 */

function dataPage() {
  const ds = dates();
  const count = Object.keys(D.stocks).length;
  const records = Object.values(D.quality).reduce((a, b) => a + b.valid, 0);

  return (
    title(
      '資料來源、匯入與驗收',
      '資料檔與訊號的時點可追溯，未知時間絕不冒充已公布。',
      badge('固定研究版本 ' + D.run)
    ) +
    '<div class="metricgrid">' +
    metric('已存集保快照', ds.length, '含本機快照') +
    metric('級距驗證成功的股期', fmt(records), '按四碼上市櫃候選母體') +
    metric('母體股票', fmt(count), '2026-11-13 當期行情備份') +
    metric('核對日 K', fmt(D.daily2404.length), '只有漢唐 2404 的完整日序列') +
    '</div>' +
    '<div class="notice">CSV 第 16 級是差異調整。固定資料逐檔核對第 1–15 級股數和減第 16 級等於第 17 級，戶數只加第 1–15 級。11/13 有 29 檔非零調整，已納入母體。資料不足列保留原因。</div>' +
    '<div class="card">' +
    cardhead('每期資料可用性', '日期、來源版本與最早已知公開證據相互獨立') +
    '<div class="tblwrap"><table><thead><tr><th>統計日</th><th>可驗證股票數</th><th>資料品質剔除</th><th>最晚已知公開時間（台北）</th><th>時點性</th></tr></thead><tbody>' +
    ds
      .map(
        day =>
          `<tr><td><b>${day}</b></td>` +
          `<td>${fmt(D.quality[day]?.valid || 0)}</td>` +
          `<td>${fmt(D.quality[day]?.invalid || 0)}</td>` +
          `<td>${esc(D.observed[day] || '未取得')}</td>` +
          `<td>${D.observed[day] ? badge(officialWeeks[day] ? '官方已取得' : '備份可得', 'good') : badge('待證', 'warn')}</td></tr>`
      )
      .join('') +
    '</tbody></table></div>' +
    `<p class="footnote">資料版本：${D.run}。備份取得時間不是交易當下公布時間；原集保官方上架的精確時刻仍待證。</p>` +
    '</div>' +
    '<div class="card"><h2>個股下載快取</h2><p id="cacheInfo">查詢快取占用與位置後可清除可重抓的日 K。</p>' +
    '<button class="btn sm" id="inspectCache">查看快取範圍</button> ' +
    '<button class="btn sm" id="clearHistory" hidden>清除個股下載快取</button></div>' +
    '<div class="section"><h2>匯入更多集保歷史資料</h2></div>' +
    '<div class="grid2">' +
    '<div class="card">' +
    cardhead('匯入官方 1-5 集保 CSV', '驗證 1–17 級股數、戶數與分母，通過後自動持久化於本機') +
    '<div class="filezone">' +
    '<b>選擇集保原始 CSV 檔案</b>' +
    '<p class="mini" style="margin:4px 0 8px">需含：資料日期、證券代號、持股分級、人數、股數</p>' +
    '<input type="file" id="importTDCC" accept=".csv,text/csv" multiple>' +
    '</div>' +
    '<p class="footnote">新匯入期的發布時間無法由 CSV 單獨證明，因此顯示「公布時點待證」，不能用於嚴格回測。原本已驗證的資料禁止覆蓋。</p>' +
    `<div id="importStatus" class="mini" style="margin-top:8px">${esc(storageSummary())}</div>` +
    '</div>' +
    '<div class="card">' +
    cardhead('來源及資料品管', '目前各資料維度之驗收狀態') +
    `<div class="feature"><span>TDCC 集保股權分散</span>${badge('已核對分級', 'good')}</div>` +
    `<div class="feature"><span>市場行情與公司股數</span>${badge('分層樣本驗收', 'good')}</div>` +
    `<div class="feature"><span>公司行動、個股退市</span>${badge('部分樣本', 'warn')}</div>` +
    `<div class="feature"><span>全市場日 K 的當時可知版本</span>${badge('尚未取得', 'warn')}</div>` +
    `<div class="feature"><span>正式 5/10/20/40 日報酬</span>${badge('不可宣稱', 'warn')}</div>` +
    '<p class="footnote">公開資料來源可能有取用與再傳輸限制；本版僅供個人離線研究，不包含商業再授權。</p>' +
    '</div>' +
    '</div>' +
    '<div class="section"><h2>查看原始驗收證據</h2></div>' +
    '<div class="card">' +
    '<div class="toolbar">' +
    '<button class="btn sm" id="exportQuality">↓ 匯出目前資料清單</button>' +
    '<button class="btn sm" id="export2404">↓ 匯出 2404 日線 CSV</button>' +
    '<button class="btn sm" id="exportWeekly">↓ 匯出 2404 集保 CSV</button>' +
    '</div>' +
    `<div class="notice" style="margin-bottom:12px"><b>完整原始資料仍留在壓縮包：</b><code>evidence/raw/</code>、<code>evidence/runs/</code>、<code>reports/${D.run}/</code>。本介面僅讀取經驗收的數值，不會改動原始證據。</div>` +
    '<p class="help">官方原始資料：<a href="https://www.tdcc.com.tw/portal/zh/smWeb/qryStock" target="_blank" rel="noopener">集保查詢</a>、<a href="https://www.twse.com.tw/" target="_blank" rel="noopener">證交所</a>、<a href="https://www.tpex.org.tw/" target="_blank" rel="noopener">櫃買中心</a>。集保與交易日曆會在開啟後背景更新，離線時保留已驗證資料。</p>' +
    '</div>'
  );
}
