/**
 * 頁面：股票收藏夾 ＆ 自動分析 (watchlist)
 * - 支援多個自訂收藏夾（建立／重新命名／刪除）與獨立「自動分析」分頁
 * - 列表維持極簡：代號名稱、最新股價與漲跌幅（紅漲綠跌）、價值估算（開關式）、右側「...」選單
 * - 價值估算公式：
 *   算法 1：現價 × 持有股數（市值）
 *   算法 2：購入價格 × 持有股數（僅於填寫購入價格時計算未實現盈虧，紅賺／綠虧／白平）
 */

function isStockInAnyFolder(code) {
  const folders = state.watchlistConfig?.folders || [];
  return folders.some(f => (f.items || []).some(it => it.code === code));
}

function getBestHoldingCostInfo(code) {
  const folders = state.watchlistConfig?.folders || [];
  const activeFolder = folders.find(f => f.id === state.watchlistActiveTab);
  const ordered = activeFolder ? [activeFolder, ...folders.filter(f => f.id !== activeFolder.id)] : folders;
  for (const f of ordered) {
    const it = (f.items || []).find(x => x.code === code && x.costPrice > 0);
    if (it) {
      return {
        folderId: f.id,
        folderName: f.name,
        shares: Number(it.shares) || 0,
        costPrice: Number(it.costPrice),
        showValuation: Boolean(it.showValuation)
      };
    }
  }
  return null;
}

function renderQuickFavModal() {
  const code = state.quickFavCode;
  if (!code) return '';
  const cfg = state.watchlistConfig || {};
  const folders = cfg.folders || [];
  const autoStocks = cfg.autoStocks || [];
  const inAuto = autoStocks.includes(code);
  const info = D.stocks[code] || [code, /^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(code) ? 'TWSE' : 'US'];

  const folderButtons = folders
    .map(f => {
      const has = (f.items || []).some(it => it.code === code);
      return (
        `<button type="button" class="wl-pick-row ${has ? 'active' : ''}" data-qfav-folder="${esc(f.id)}" data-qfav-code="${esc(code)}">` +
        `<span><b>${has ? '✓' : '+'}</b> ${esc(f.name)}</span>` +
        `<span class="mini">${(f.items || []).length} 檔</span>` +
        '</button>'
      );
    })
    .join('');

  return (
    '<div class="wl-modal-backdrop" id="quickFavBackdrop">' +
    '<div class="wl-modal card" role="dialog" aria-label="加入股票收藏夾">' +
    cardhead(
      `收藏設定｜${esc(code)} ${esc(info[0])}`,
      '選擇要加入或移出的自訂收藏夾，也可同步加入自動分析',
      '<button type="button" class="btn sm" id="closeQuickFavBtn">關閉</button>'
    ) +
    `<div class="wl-pick-list">${folderButtons}</div>` +
    '<div class="wl-quick-new-row">' +
    `<input id="quickFavNewFolderInput" placeholder="或直接輸入新收藏夾名稱建立並加入" style="flex:1">` +
    `<button type="button" class="btn sm" id="quickFavCreateBtn" data-qfav-code="${esc(code)}">+ 建立並加入</button>` +
    '</div>' +
    '<div class="wl-modal-foot">' +
    `<button type="button" class="btn ${inAuto ? 'main' : ''} sm" id="quickFavAutoBtn" data-qfav-code="${esc(code)}">${inAuto ? '✦ 已在自動分析（點擊移出）' : '✦ 同時加入自動分析'}</button>` +
    `<button type="button" class="btn sm" data-nav="watchlist">前往收藏夾頁 →</button>` +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderCustomValuationCell(item, quote) {
  if (!item.showValuation) {
    return '<span class="mini">未開啟（點 … 設定）</span>';
  }
  const shares = Number(item.shares) || 0;
  if (shares <= 0) {
    return '<span class="mini">請於 … 輸入持有股數</span>';
  }
  const price = typeof quote?.price === 'number' ? quote.price : null;
  if (price === null) {
    return `<span class="mini">${fmt(shares)} 股（點擊一鍵更新股價）</span>`;
  }

  // 算法 1：現價 × 持有股數
  const marketVal = price * shares;
  let pnlHtml = '';
  // 算法 2：僅於有輸入購入價格時計算未實現盈虧（紅賺／綠虧／白平）
  if (typeof item.costPrice === 'number' && item.costPrice > 0) {
    const costTotal = item.costPrice * shares;
    const pnl = marketVal - costTotal;
    const pnlPct = costTotal > 0 ? (pnl / costTotal) * 100 : 0;
    const pnlCls = pnl > 0 ? 'tw-up' : pnl < 0 ? 'tw-down' : 'wl-pnl-flat';
    const signStr = pnl > 0 ? '+' : '';
    const pctStr = pnlPct > 0 ? '+' : '';
    pnlHtml = `<span class="wl-pnl ${pnlCls}">${signStr}${fmt(pnl, 0)} (${pctStr}${fmt(pnlPct, 2)}%)</span>`;
  }

  return (
    '<div class="wl-val-wrap">' +
    `<strong class="wl-val-main">${fmt(marketVal, 0)} 元</strong>` +
    pnlHtml +
    `<span class="mini" style="width:100%;display:block;margin-top:2px">${fmt(shares)} 股${item.costPrice > 0 ? ` · 均價 ${fmt(item.costPrice, item.costPrice < 150 ? 2 : 1)}` : ''}</span>` +
    '</div>'
  );
}

function renderRowMenuDrawer(folder, item) {
  const checked = item.showValuation ? 'checked' : '';
  const inAuto = Boolean(item.inAuto);
  const sharesVal = item.shares > 0 ? String(item.shares) : '';
  const costVal = item.costPrice > 0 ? String(item.costPrice) : '';

  return (
    `<tr class="wl-drawer-row"><td colspan="4">` +
    '<div class="wl-drawer">' +
    '<div class="wl-drawer-section">' +
    '<div class="wl-drawer-title">價值估算（可開關）</div>' +
    '<div class="wl-drawer-fields">' +
    `<label class="wl-check-inline"><input type="checkbox" id="wlMenuValuationToggle" ${checked}><span>開啟價值估算</span></label>` +
    `<label class="wl-inline-field">持有股數 <input id="wlMenuSharesInput" type="number" min="0" step="1" placeholder="如 1000" value="${esc(sharesVal)}"></label>` +
    `<label class="wl-inline-field">購入價格（非必填） <input id="wlMenuCostInput" type="number" min="0" step="0.01" placeholder="留空僅算市值" value="${esc(costVal)}"></label>` +
    `<button type="button" class="btn main sm" id="wlMenuSaveBtn" data-wl-save="${esc(folder.id)}:${esc(item.code)}">儲存估值</button>` +
    '</div>' +
    '</div>' +
    '<div class="wl-drawer-actions">' +
    `<button type="button" class="btn sm ${inAuto ? 'good-outline' : ''}" data-wl-toggle-auto="${esc(item.code)}">${inAuto ? '✦ 移出自動分析' : '✦ 加入自動分析'}</button>` +
    `<button type="button" class="btn danger sm" data-wl-remove-item="${esc(folder.id)}:${esc(item.code)}">從此收藏夾刪除</button>` +
    `<button type="button" class="btn sm" id="wlMenuCloseBtn">收起</button>` +
    '</div>' +
    '</div>' +
    '</td></tr>'
  );
}

function renderCustomWatchlistTab(folder) {
  const quotes = state.watchlistQuotes || {};
  const items = folder?.items || [];

  const renameBox =
    state.watchlistRenamingFolderId === folder.id
      ? '<div class="toolbar" style="margin-bottom:12px">' +
        `<input id="wlRenameInput" value="${esc(folder.name)}" maxlength="30" placeholder="輸入新收藏夾名稱">` +
        `<button type="button" class="btn main sm" id="wlRenameSaveBtn" data-folder-id="${esc(folder.id)}">確認更名</button>` +
        '<button type="button" class="btn sm" id="wlRenameCancelBtn">取消</button>' +
        '</div>'
      : '';

  const folderTools =
    '<div class="feed-bar" style="margin-bottom:14px">' +
    '<div class="toolbar" style="margin:0">' +
    `<input id="addWatchlistCodeInput" placeholder="輸入代號加入（如 2330、0050、NVDA）" style="width:280px">` +
    `<button type="button" class="btn main sm" id="addWatchlistStockBtn" data-folder-id="${esc(folder.id)}">+ 加入股票</button>` +
    '</div>' +
    '<div class="toolbar" style="margin:0">' +
    `<span class="mini">${state.watchlistQuotesUpdatedAt ? `報價更新：${esc(state.watchlistQuotesUpdatedAt)}` : '點擊右上方「一鍵更新股價」抓取即時價'}</span>` +
    `<button type="button" class="btn sm" id="wlStartRenameBtn" data-folder-id="${esc(folder.id)}">✎ 更名收藏夾</button>` +
    `<button type="button" class="btn danger sm" id="wlDeleteFolderBtn" data-folder-id="${esc(folder.id)}">刪除收藏夾</button>` +
    '</div>' +
    '</div>' +
    renameBox;

  if (!items.length) {
    return (
      '<div class="card">' +
      folderTools +
      `<div class="empty"><b>「${esc(folder.name)}」目前尚無股票</b>輸入上方台美股代號（或從全市場篩選、個股頁按 ★ 加入），即會顯示於極簡清單。</div>` +
      '</div>'
    );
  }

  const rowsHtml = items
    .map(item => {
      const q = quotes[item.code];
      const hasVal = typeof q?.price === 'number';
      const dp = hasVal && q.price < 150 ? 2 : 1;
      const dirCls = !hasVal ? '' : q.change > 0 ? 'tw-up' : q.change < 0 ? 'tw-down' : 'wl-pnl-flat';
      const arrow = !hasVal ? '' : q.change > 0 ? '▲' : q.change < 0 ? '▼' : '';
      const menuKey = `${folder.id}:${item.code}`;
      const isMenuOpen = state.watchlistMenuKey === menuKey;

      return (
        `<tr class="clickable" data-wl-open-stock="${esc(item.code)}">` +
        `<td><b>${esc(item.code)}</b> <span class="cell-muted">${esc(item.name)}</span>${item.inAuto ? ' <span class="tag good" style="margin-left:6px">自動分析中</span>' : ''}</td>` +
        `<td>${
          hasVal
            ? `<div class="wl-price-cell"><strong class="${dirCls}">${fmt(q.price, dp)}</strong> <span class="wl-chg ${dirCls}">${arrow} ${pp(q.change, 2)} (${pp(q.changePct, 2)}%)</span></div>`
            : '<span class="mini">尚未更新報價</span>'
        }</td>` +
        `<td>${renderCustomValuationCell(item, q)}</td>` +
        `<td style="text-align:right"><button type="button" class="btn sm wl-more-btn ${isMenuOpen ? 'main' : ''}" data-wl-menu-toggle="${esc(menuKey)}" title="更多功能（價值估算／自動分析／刪除）">...</button></td>` +
        '</tr>' +
        (isMenuOpen ? renderRowMenuDrawer(folder, item) : '')
      );
    })
    .join('');

  return (
    '<div class="card">' +
    folderTools +
    '<div class="tblwrap"><table><thead><tr>' +
    '<th>股票代號／名稱</th><th>最新股價與漲跌幅</th><th>價值估算</th><th style="width:76px;text-align:right">功能</th>' +
    '</tr></thead><tbody>' +
    rowsHtml +
    '</tbody></table></div>' +
    '</div>'
  );
}

function renderDimToneTag(label, tone) {
  const cls = tone === 'up' ? 'tw-up-bg' : tone === 'down' ? 'tw-down-bg' : '';
  return `<div class="wl-dim-box ${cls}"><div class="wl-dim-label">${esc(label)}</div>`;
}

function renderAutoAnalysisTab() {
  const cfg = state.watchlistConfig || {};
  const autoMeta = cfg.autoStockMeta || [];
  const analysis = state.watchlistAnalysis;
  const counts = analysis?.counts || {};
  const analyzedItems = analysis?.items || [];
  const byCode = new Map(analyzedItems.map(x => [x.code, x]));

  const pills = [
    ['all', '全部', autoMeta.length],
    ['belowMa5', '低於 5 日線', counts.belowMa5 || 0],
    ['belowMa10', '低於 10 日線', counts.belowMa10 || 0],
    ['tdccBuy', '大戶買超', counts.tdccBuy || 0],
    ['tdccSell', '大戶賣超', counts.tdccSell || 0],
    ['instBuy', '法人買超', counts.instBuy || 0],
    ['instSell', '法人賣超', counts.instSell || 0],
    ['divergence', '籌碼背離提醒', counts.divergence || 0]
  ];

  const filterBar =
    '<div class="wl-filter-bar">' +
    pills
      .map(
        ([key, lbl, cnt]) =>
          `<button type="button" class="topic-chip ${state.watchlistFilter === key ? 'active' : ''}" data-wl-filter="${key}">${esc(lbl)} <b>${cnt}</b></button>`
      )
      .join('') +
    '</div>';

  const statusHead =
    '<div class="card" style="padding:14px 18px;margin-bottom:16px">' +
    '<div class="feed-bar">' +
    '<div class="feed-meta">' +
    `<span>獨立自動分析清單：<b>${autoMeta.length}</b> 檔</span>` +
    (analysis
      ? `<span>最近分析：<b>${esc(analysis.generatedAt)}</b> · ${esc(analysis.trigger)}</span>`
      : '<span>尚未產出自動分析報告，點擊右側「立即更新分析」即可生成</span>') +
    '</div>' +
    `<button type="button" class="btn main sm" id="runAutoAnalysisBtn"${state.watchlistAnalysisBusy ? ' disabled' : ''}>${state.watchlistAnalysisBusy ? '分析計算中...' : '⚡ 立即更新分析'}</button>` +
    '</div>' +
    (autoMeta.length ? filterBar : '') +
    '</div>';

  if (!autoMeta.length) {
    return (
      statusHead +
      '<div class="card"><div class="empty"><b>自動分析收藏夾目前為空</b>請於任意自訂收藏夾的「...」選單中點選「加入自動分析」（或於篩選／個股頁 ★ 收藏面板加入），系統將於每日 10:00 與手動更新時自動檢核 6 大技術與籌碼維度。</div></div>'
    );
  }

  const filter = state.watchlistFilter || 'all';
  const cards = autoMeta
    .map(meta => {
      const it = byCode.get(meta.code);
      if (!it) {
        if (filter !== 'all') return '';
        return (
          '<div class="card wl-ana-card" style="margin-bottom:14px">' +
          '<div class="splithead">' +
          `<div><h3 class="clickable" data-wl-open-stock="${esc(meta.code)}">${esc(meta.code)} ${esc(meta.name)}</h3><div class="mini">已加入自動分析，尚未執行本次掃描</div></div>` +
          `<div class="toolbar" style="margin:0"><button type="button" class="btn sm" data-wl-open-stock="${esc(meta.code)}">查看個股 →</button><button type="button" class="btn danger sm" data-wl-toggle-auto="${esc(meta.code)}">移出自動分析</button></div>` +
          '</div></div>'
        );
      }
      if (filter !== 'all' && !(it.filterFlags || []).includes(filter)) {
        return '';
      }
      if (it.error) {
        return (
          '<div class="card wl-ana-card" style="margin-bottom:14px">' +
          '<div class="splithead">' +
          `<div><h3 class="clickable" data-wl-open-stock="${esc(it.code)}">${esc(it.code)} ${esc(it.name)}</h3><div class="mini">${esc(it.error)}</div></div>` +
          `<button type="button" class="btn danger sm" data-wl-toggle-auto="${esc(it.code)}">移出自動分析</button>` +
          '</div></div>'
        );
      }

      const dp = it.price < 150 ? 2 : 1;
      const cls = it.change > 0 ? 'tw-up' : it.change < 0 ? 'tw-down' : 'wl-pnl-flat';
      const arrow = it.change > 0 ? '▲' : it.change < 0 ? '▼' : '';
      const ov = it.overall || {};
      const ovType = ov.tone === 'up' ? 'good' : ov.tone === 'down' ? 'bad' : 'warn';

      const sMa = it.shortMa || {};
      const mMa = it.midMa || {};
      const td = it.tdcc || {};
      const inst = it.inst || {};
      const vol = it.volume || {};
      const mg = it.margin || {};

      return (
        '<div class="card wl-ana-card" style="margin-bottom:14px">' +
        '<div class="splithead">' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">' +
        `<h3 class="clickable" data-wl-open-stock="${esc(it.code)}" style="margin:0;cursor:pointer">${esc(it.code)} ${esc(it.name)}</h3>` +
        `<span class="${cls}" style="font-weight:700;font-variant-numeric:tabular-nums">${fmt(it.price, dp)} (${arrow} ${pp(it.changePct, 2)}%)</span>` +
        `<span class="mini">${esc(it.tradeDate || '')}</span>` +
        badge(ov.label || '檢核完成', ovType) +
        (ov.divergenceAlert ? badge(ov.divergenceAlert, 'warn') : '') +
        '</div>' +
        '<div class="toolbar" style="margin:0">' +
        `<button type="button" class="btn sm" data-wl-open-stock="${esc(it.code)}">整合個股檢視 →</button>` +
        `<button type="button" class="btn danger sm" data-wl-toggle-auto="${esc(it.code)}">移出自動分析</button>` +
        '</div>' +
        '</div>' +
        '<div class="wl-dim-grid">' +
        renderDimToneTag('1. 短均位階 (MA5 / MA10)', sMa.tone) +
        `<div class="wl-dim-val">${esc(sMa.status)}</div>` +
        `<div class="wl-dim-sub">MA5 ${sMa.ma5 != null ? `${fmt(sMa.ma5, dp)} (${pp(sMa.bias5Pct, 2)}%)` : '—'} · MA10 ${sMa.ma10 != null ? `${fmt(sMa.ma10, dp)} (${pp(sMa.bias10Pct, 2)}%)` : '—'}</div></div>` +
        renderDimToneTag('2. 中期趨勢 (MA20 / MA60)', mMa.tone) +
        `<div class="wl-dim-val">${esc(mMa.status)}</div>` +
        `<div class="wl-dim-sub">月線 ${mMa.ma20 != null ? fmt(mMa.ma20, dp) : '—'} · 季線 ${mMa.ma60 != null ? fmt(mMa.ma60, dp) : '—'}</div></div>` +
        renderDimToneTag('3. TDCC 大戶 (400張週變化)', td.tone) +
        `<div class="wl-dim-val">${esc(td.status)} ${td.deltaPp400 != null ? pp(td.deltaPp400, 3) + ' pp' : ''}</div>` +
        `<div class="wl-dim-sub">${td.weekDay ? `${esc(td.weekDay)} 占比 ${fmt(td.pct400, 2)}% · 千張 ${pp(td.deltaPp1000, 3)} pp` : '尚無近期集保週比較'}</div></div>` +
        renderDimToneTag('4. 三大法人買賣超 (近5日)', inst.tone) +
        `<div class="wl-dim-val">${esc(inst.status)}${inst.inst5Total != null ? ` ${pp(inst.inst5Total, 0)} 張` : ''}</div>` +
        `<div class="wl-dim-sub">${inst.inst5Total != null ? `外資 ${pp(inst.foreign5, 0)} · 投信 ${pp(inst.trust5, 0)} · 最新日 ${pp(inst.lastTotal, 0)}` : esc(inst.status)}</div></div>` +
        renderDimToneTag('5. 量價配合 (vs MV5)', vol.tone) +
        `<div class="wl-dim-val">${esc(vol.status)}</div>` +
        `<div class="wl-dim-sub">${vol.mv5 != null ? `今日 ${fmt(vol.vol)} 張 / 5日均量 ${fmt(vol.mv5)} 張` : '—'}</div></div>` +
        renderDimToneTag('6. 融資融券變化 (近5日)', mg.tone) +
        `<div class="wl-dim-val">${esc(mg.status)}</div>` +
        `<div class="wl-dim-sub">${mg.marginBal != null ? `融資餘 ${fmt(mg.marginBal)} 張 · 券資比 ${fmt(mg.shortMarginRatio, 2)}%` : esc(mg.status)}</div></div>` +
        '</div>' +
        `<div class="verdict-box" style="margin-top:10px"><b>綜合判斷：</b>${esc(ov.summary || '')}</div>` +
        '</div>'
      );
    })
    .filter(Boolean)
    .join('');

  return (
    statusHead +
    (cards || '<div class="card"><div class="empty">目前快篩條件下無符合股票，請點選「全部」切換。</div></div>')
  );
}

function watchlistPage() {
  const cfg = state.watchlistConfig || {};
  const folders = cfg.folders || [];
  const autoCount = (cfg.autoStocks || []).length;
  const activeTab = state.watchlistActiveTab === 'auto'
    ? 'auto'
    : folders.some(f => f.id === state.watchlistActiveTab)
      ? state.watchlistActiveTab
      : folders[0]?.id || 'auto';

  const enabled = cfg.autoEnabled !== false;
  const headerActions =
    '<div class="brief-controls">' +
    `<label class="switch-wrap" title="獨立開關每日台灣時間 10:00 自動分析收藏清單">` +
    `<input type="checkbox" id="toggleAutoWatchlist" ${enabled ? 'checked' : ''}>` +
    '<span class="switch-track"><span class="switch-thumb"></span></span>' +
    `<span class="switch-label">${enabled ? '10:00 自動分析：開啟' : '10:00 自動分析：已關閉'}</span>` +
    '</label>' +
    `<button type="button" class="btn main" id="refreshWatchlistPricesBtn"${state.watchlistPriceBusy ? ' disabled' : ''}>${state.watchlistPriceBusy ? '更新報價中...' : '↻ 一鍵更新股價'}</button>` +
    `<button type="button" class="btn" id="createFolderBtn">+ 新增收藏夾</button>` +
    '</div>';

  const createFolderPanel = state.watchlistCreatingFolder
    ? '<div class="card" style="padding:14px 16px;margin-bottom:16px">' +
      '<div class="toolbar" style="margin:0">' +
      '<input id="newFolderNameInput" placeholder="輸入新收藏夾名稱（如：半導體波段、高股息存股）" maxlength="30" style="width:320px">' +
      '<button type="button" class="btn main sm" id="saveNewFolderBtn">建立收藏夾</button>' +
      '<button type="button" class="btn sm" id="cancelNewFolderBtn">取消</button>' +
      '</div></div>'
    : '';

  const tabsBar =
    '<div class="wl-tabs-row">' +
    folders
      .map(
        f =>
          `<button type="button" class="wl-tab ${activeTab === f.id ? 'active' : ''}" data-wl-tab="${esc(f.id)}">` +
          `<span>${esc(f.name)}</span><span class="wl-tab-cnt">${(f.items || []).length}</span></button>`
      )
      .join('') +
    `<button type="button" class="wl-tab wl-tab-auto ${activeTab === 'auto' ? 'active' : ''}" data-wl-tab="auto">` +
    `<span>✦ 自動分析</span><span class="wl-tab-cnt">${autoCount}</span></button>` +
    '</div>';

  const errNotice = state.watchlistError
    ? `<div class="notice warn" style="margin-bottom:14px">${esc(state.watchlistError)}</div>`
    : '';

  const activeFolder = folders.find(f => f.id === activeTab);
  const contentHtml =
    activeTab === 'auto'
      ? renderAutoAnalysisTab()
      : activeFolder
        ? renderCustomWatchlistTab(activeFolder)
        : '<div class="card"><div class="empty">請先建立一個收藏夾</div></div>';

  return (
    title(
      '股票收藏夾 ＆ 自動分析',
      '市值／損益估算；隔離保存於 %LOCALAPPDATA%\\ChipScreener\\user-v1\\watchlists.json。',
      headerActions
    ) +
    createFolderPanel +
    tabsBar +
    errNotice +
    contentHtml
  );
}
