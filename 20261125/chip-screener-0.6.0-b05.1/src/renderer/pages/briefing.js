/**
 * 頁面：每日 10:00 自動財經晨報 (briefing)
 * 支援手動開啟／關閉每日 10:00 自動晨報、隨時一鍵馬上製作、歷史日期切換、Markdown 匯出與本機隔離 AI 金鑰設定。
 */

function enrichTrackedChipNote(item) {
  const code = item.code;
  if (!/^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(code)) {
    return item.chipNote || '美股報價';
  }
  const ctx = evaluation(applied);
  const sig = weeklySignal(code, ctx);
  if (Number.isFinite(sig.gain)) {
    const dir = sig.gain > 0 ? '大戶增持' : sig.gain < 0 ? '大戶調節' : '持平';
    return `${applied.band}張${dir} ${pp(sig.gain, 3)} pp（${sig.status}）`;
  }
  return sig.reason || item.chipNote || '—';
}

function renderBriefingQuoteRows(items, showNewsReason = false) {
  return (items || [])
    .map(t => {
      const hasVal = typeof t.price === 'number';
      const cls = !hasVal ? '' : t.change > 0 ? 'tw-up' : t.change < 0 ? 'tw-down' : '';
      const clickable = /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(t.code);
      const chipNote = enrichTrackedChipNote(t);
      const noteText = showNewsReason && t.mentionedIn
        ? (chipNote && chipNote !== t.mentionedIn && !chipNote.includes('可於個股頁核對') ? `${t.mentionedIn} · ${chipNote}` : t.mentionedIn)
        : chipNote;
      return (
        `<tr${clickable ? ` class="clickable" data-stock="${esc(t.code)}"` : ''}>` +
        `<td><b>${esc(t.code)}</b> <span class="cell-muted">${esc(t.name)}</span></td>` +
        `<td>${esc(t.market)}</td>` +
        `<td>${hasVal ? fmt(t.price, t.price < 150 ? 2 : 1) : '—'}</td>` +
        `<td class="${cls}">${hasVal ? `${pp(t.change, 2)} (${pp(t.changePct, 2)}%)` : '—'}</td>` +
        `<td>${esc(noteText)}</td>` +
        '</tr>'
      );
    })
    .join('');
}

function briefingPage() {
  const cfg = state.briefingConfig || {};
  const enabled = cfg.enabled !== false;
  const report = state.briefingReport;
  const datesList = state.briefingDates || [];

  const headerActions =
    '<div class="brief-controls">' +
    `<label class="switch-wrap" title="手動開啟或關閉每日台灣時間 10:00 自動產出晨報">` +
    `<input type="checkbox" id="toggleAutoBriefing" ${enabled ? 'checked' : ''}>` +
    '<span class="switch-track"><span class="switch-thumb"></span></span>' +
    `<span class="switch-label">${enabled ? '10:00 自動晨報：開啟' : '10:00 自動晨報：已關閉'}</span>` +
    '</label>' +
    `<button type="button" class="btn main" id="generateBriefingBtn"${state.briefingBusy ? ' disabled' : ''}>${state.briefingBusy ? '彙總製作中...' : '⚡ 馬上製作'}</button>` +
    `<button type="button" class="btn sm" id="toggleBriefingSettings" title="設定關注代號與選填 Gemini API Key">⚙ 設定</button>` +
    '</div>';

  const selectedTopics = Array.isArray(cfg.topics) ? cfg.topics : [];
  const availableTopics = Array.isArray(cfg.availableTopics) ? cfg.availableTopics : [];
  const topicCheckboxes = availableTopics
    .map(t => {
      const checked = !selectedTopics.length || selectedTopics.includes(t.id);
      return `<label class="topic-chip"><input type="checkbox" data-briefing-topic="${esc(t.id)}"${checked ? ' checked' : ''}><span>${esc(t.label)}</span></label>`;
    })
    .join('');

  const settingsPanel = state.briefingSettingsOpen
    ? '<div class="card" style="margin-bottom:18px">' +
      cardhead('晨報追蹤清單、題材篩選與選填 AI 設定', '敏感金鑰隔離保存於 Windows 本機資料夾（%LOCALAPPDATA%\\ChipScreener），絕不寫入專案或 Git') +
      '<div class="formgrid">' +
      '<div class="field">' +
      '<label>自訂追蹤標的代號（空白或逗號分隔，支援台美股）</label>' +
      `<input id="briefingWatchlistInput" value="${esc((cfg.watchlist || []).join(', '))}" placeholder="例如：2330, 0050, TSM, NVDA">` +
      '<small>僅查詢您自訂的清單；系統另會依今日晨報新聞自動找出重點股票顯示於下方速覽</small>' +
      '</div>' +
      '<div class="field">' +
      `<label>選填 Gemini API Key ${cfg.hasGeminiKey ? badge('已設定 ' + cfg.geminiKeyHint, 'good') : badge('未設定（使用免 Key 規則彙整）', '')}</label>` +
      '<input id="briefingGeminiKeyInput" type="password" placeholder="留空維持現狀；貼上新 Key 以啟用 AI 濃縮">' +
      '<small>未設定時完全免費使用規則式重點彙整；設定後將以真實新聞濃縮摘要並附來源</small>' +
      '</div>' +
      '</div>' +
      '<div class="field" style="margin-top:14px">' +
      '<label>晨報查詢題材（可複選，未變動或全選時採均衡預設）</label>' +
      `<div class="topic-grid" id="briefingTopicsGroup">${topicCheckboxes}</div>` +
      '<small>選擇特定題材後，系統將優先抓選並彙總符合所選題材的財經焦點；可隨時調整並重新製作</small>' +
      '</div>' +
      '<div class="toolbar" style="margin-top:14px;margin-bottom:0">' +
      '<button type="button" class="btn main sm" id="saveBriefingSettingsBtn">儲存晨報設定</button>' +
      (cfg.hasGeminiKey ? '<button type="button" class="btn danger sm" id="clearGeminiKeyBtn">清除已存 API Key</button>' : '') +
      `<span class="mini">系統排程狀態：${esc(cfg.windowsTaskStatus || '—')}</span>` +
      '</div>' +
      '</div>'
    : '';

  const toolbarRow =
    '<div class="card" style="padding:12px 16px;margin-bottom:18px">' +
    '<div class="feed-bar">' +
    '<div class="feed-meta">' +
    `<label>歷史晨報 <select id="briefingDateSelect" class="select" style="padding:5px 10px">${
      datesList.length
        ? datesList
            .map(d => `<option value="${esc(d)}" ${d === (report?.date || state.briefingSelectedDate) ? 'selected' : ''}>${esc(d)}</option>`)
            .join('')
        : '<option value="">尚無歷史紀錄</option>'
    }</select></label>` +
    (report
      ? `<span class="mini">產出時間 ${esc(report.generatedAt)} · ${esc(report.summaryMode)} · ${esc(report.trigger)}</span>`
      : `<span class="mini">${esc(cfg.windowsTaskStatus || '')}</span>`) +
    '</div>' +
    (report ? '<button type="button" class="btn sm" id="exportBriefingMd">↓ 匯出 Markdown 報告</button>' : '') +
    '</div>' +
    '</div>';

  let bodyHtml = '';
  if (state.briefingBusy && !report) {
    bodyHtml = '<div class="card"><div class="empty"><b>正在彙總台美股最新指數、重點新聞與追蹤標的...</b>通常約需 5～10 秒，請稍候</div></div>';
  } else if (state.briefingError && !report) {
    bodyHtml = `<div class="card"><div class="empty"><b>無法讀取或製作晨報</b>${esc(state.briefingError)}</div></div>`;
  } else if (!report) {
    bodyHtml =
      '<div class="card"><div class="empty"><b>尚無已儲存的晨報</b>' +
      '點擊右上角「<b>⚡ 馬上製作</b>」即可立即抓取最新台美股盤勢與權威財經新聞並產出報告。</div></div>';
  } else {
    const indicesCards = (report.indices || [])
      .map(idx => {
        const hasVal = typeof idx.price === 'number';
        const cls = !hasVal ? '' : idx.change > 0 ? 'tw-up' : idx.change < 0 ? 'tw-down' : '';
        const arrow = !hasVal ? '' : idx.change > 0 ? '▲' : idx.change < 0 ? '▼' : '';
        return (
          '<div class="index-card">' +
          `<div class="idx-head"><span>${esc(idx.name)}</span><span class="mini">${esc(idx.market)}</span></div>` +
          `<div class="idx-price ${cls}">${hasVal ? fmt(idx.price, 2) : '—'}</div>` +
          `<div class="idx-chg ${cls}">${hasVal ? `${arrow} ${pp(idx.change, 2)} (${pp(idx.changePct, 2)}%)` : '暫無報價'}</div>` +
          '</div>'
        );
      })
      .join('');

    const summaryItems = (report.summary || [])
      .map(line => `<li>${esc(line)}</li>`)
      .join('');

    const trackedRows = renderBriefingQuoteRows(report.tracked || [], false);
    const newsStockRows = renderBriefingQuoteRows(report.newsStocks || [], true);

    const newsList = report.news || [];
    const newsItems = newsList
      .map(n => {
        const catType = n.category === '台股' ? 'good' : n.category === '總經' ? 'warn' : '';
        const topicTags = (n.topics || []).map(t => badge(t, '')).join('');
        return (
          '<div class="news-item">' +
          '<div class="news-main">' +
          `<div class="news-meta">${badge(n.category, catType)}${topicTags}<span class="news-source">${esc(n.source)}</span>${n.published ? `<span class="mini">${esc(n.published)}</span>` : ''}</div>` +
          `<a class="news-title" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">${esc(n.title)} ↗</a>` +
          (n.snippet ? `<p class="news-snippet">${esc(n.snippet)}</p>` : '') +
          '</div>' +
          '</div>'
        );
      })
      .join('');

    const topicInfo = Array.isArray(report.topicLabels) && report.topicLabels.length ? `題材：${report.topicLabels.join('、')}` : '';

    bodyHtml =
      // 1. 一分鐘重點總結
      '<div class="card" style="margin-bottom:18px">' +
      cardhead('一分鐘重點總結', `${esc(report.date)} 精簡摘要${topicInfo ? ' · ' + esc(topicInfo) : ''}`, badge(report.summaryMode, report.summaryMode.includes('AI') ? 'good' : '')) +
      `<ul class="brief-list">${summaryItems}</ul>` +
      '</div>' +
      // 2. 台美股盤勢快照
      '<div class="section" style="margin-top:0"><h2>台美股盤勢快照</h2><span class="mini">台股紅漲綠跌 · 來源：Yahoo Finance</span></div>' +
      `<div class="index-grid" style="margin-bottom:22px">${indicesCards}</div>` +
      // 3. 重點新聞精選（可收起，附消息來源）
      '<div class="section">' +
      `<h2>重點財經新聞精選（附消息來源）</h2>` +
      '<div class="section-actions">' +
      '<span class="mini">Yahoo 奇摩股市 · 中央社財經 · CNBC 財經（自動過濾非財經雜訊並去重）</span>' +
      `<button type="button" class="btn sm" id="toggleBriefingNews">${state.briefingNewsOpen ? `▲ 收起新聞 (${newsList.length})` : `▼ 展開新聞 (${newsList.length})`}</button>` +
      '</div>' +
      '</div>' +
      (state.briefingNewsOpen
        ? '<div class="card" id="briefingNewsCard" style="margin-bottom:22px">' +
          (newsItems || '<div class="empty">本次未抓取到符合條件的新聞項目</div>') +
          '</div>'
        : `<div class="card" id="briefingNewsCard" style="margin-bottom:22px;padding:12px 16px"><span class="mini">已收起 ${newsList.length} 則重點財經新聞，點擊右上「展開新聞」即可瀏覽標題與來源連結。</span></div>`) +
      // 4. 自訂追蹤標的異動速覽
      '<div class="section"><h2>自訂追蹤標的異動速覽</h2><span class="mini">僅依「設定」中之自訂清單查詢 · 點擊台股列可前往個股研究／詳情</span></div>' +
      '<div class="card" style="margin-bottom:22px">' +
      (trackedRows
        ? '<div class="tblwrap"><table><thead><tr><th>代號／名稱</th><th>市場</th><th>最新價</th><th>漲跌幅</th><th>籌碼／備註</th></tr></thead><tbody>' +
          trackedRows +
          '</tbody></table></div>'
        : '<div class="empty">尚未設定自訂追蹤標的，可於右上方「⚙ 設定」加入台美股代號</div>') +
      '</div>' +
      // 5. 晨報重點股票異動速覽（依今日新聞自動彙整）
      '<div class="section"><h2>晨報重點股票異動速覽</h2><span class="mini">自動自本次晨報新聞中萃取出之重點台美股（不含上方自訂清單）</span></div>' +
      '<div class="card">' +
      (newsStockRows
        ? '<div class="tblwrap"><table><thead><tr><th>代號／名稱</th><th>市場</th><th>最新價</th><th>漲跌幅</th><th>新聞提及／備註</th></tr></thead><tbody>' +
          newsStockRows +
          '</tbody></table></div>'
        : '<div class="empty">本次晨報新聞未額外提及可對應報價之重點個股</div>') +
      '</div>';
  }

  return (
    title(
      '每日 10:00 財經晨報',
      '每日台灣時間早上 10:00 自動彙總台美股盤勢與重點新聞（附原始消息來源），可隨時手動關閉或一鍵馬上製作。',
      headerActions
    ) +
    settingsPanel +
    toolbarRow +
    bodyHtml
  );
}
