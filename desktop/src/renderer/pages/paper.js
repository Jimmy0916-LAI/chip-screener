/**
 * 頁面：模擬操盤 ＆ AI 操盤手 (paper)
 * - 遵循極簡克制 Obsidian UI 規範：頂部精簡控制列 + 4 張核心 KPI 卡 + 單一聚焦分頁工作區
 * - 支援多存檔隔離（TW / US / MIXED）、手動即時／條件掛單、AI 操盤手（半自動提案／全自動）與多存檔績效比較彈窗
 */

const PT_DEFAULT_FEES = {
  twBuyFeeRate: 0.001425,
  twSellFeeRate: 0.001425,
  twFeeDiscount: 1.0,
  twMinFee: 20.0,
  twStockTaxRate: 0.003,
  twEtfTaxRate: 0.001,
  usFeeRate: 0.0,
  usMinFee: 0.0
};

const PT_DEFAULT_AI_CONFIG = {
  autonomy: 'semi',
  style: 'balanced',
  customPrompt: '',
  scheduleMode: 'manual',
  cooldownMinutes: 60,
  tools: {
    tdccScreener: true,
    twDetail: true,
    usScreener: true,
    briefing: true,
    watchlist: true,
    channels: true,
    liveQuotes: true,
    portfolio: true
  },
  guardrails: {
    maxSingleStockPct: 25.0,
    maxPositions: 8,
    minCashFloorPct: 15.0,
    defaultStopLossPct: 8.0,
    defaultTakeProfitPct: 18.0
  }
};

const PT_AI_TOOLS_META = [
  ['tdccScreener', '台股集保大戶籌碼篩選', '查詢近兩週 400 張大戶持股占比連升標的'],
  ['twDetail', '台股個股六維與技術指標', '讀取均線乖離、法人買賣超與融資變化'],
  ['usScreener', '美股 S&P 500 篩選與詳情', '讀取美股強勢／拉回候選股與個股趨勢'],
  ['briefing', '每日晨報摘要與焦點', '讀取最新盤前晨報、指數與焦點個股'],
  ['watchlist', '自選收藏夾與自動分析', '讀取收藏夾清單與六大維度評分'],
  ['channels', '訂閱財經頻道策略卡', '讀取已追蹤財經頻道最新影片觀點與標的'],
  ['liveQuotes', '盤中／最新即時報價', '查詢候選與持倉標的即時價格'],
  ['portfolio', '模擬帳戶持倉與績效', '讀取現金水位、持股權重與現有條件單']
];

const PT_TOOL_NAME_MAP = {
  get_portfolio_state: '模擬帳戶狀態',
  screen_tw_tdcc_chips: '台股大戶籌碼',
  get_tw_stock_detail: '台股個股詳情',
  screen_us_sp500: '美股 S&P 500 篩選',
  get_us_stock_detail: '美股個股詳情',
  get_daily_briefing: '每日晨報',
  get_watchlist_summary: '自選收藏夾',
  get_channel_strategies: '頻道策略卡',
  get_live_quotes: '即時報價'
};

function ptIsTwCode(code) {
  return /^(?:\d{4}|00\d{2,4}[A-Z]?)$/i.test(String(code || '').trim());
}

function ptMarketLabel(market) {
  const m = String(market || 'TW').toUpperCase();
  if (m === 'US') return '美股 USD';
  if (m === 'MIXED') return '台美混合 TWD';
  return '台股 TWD';
}

function ptMarketShort(market) {
  const m = String(market || 'TW').toUpperCase();
  if (m === 'US') return 'US';
  if (m === 'MIXED') return 'MIXED';
  return 'TW';
}

function ptModeLabel(slot) {
  if (!slot || slot.mode !== 'ai') return '手動操盤';
  const auto = slot.aiConfig?.autonomy === 'full' ? '全自動' : '半自動';
  return `AI 代操 · ${auto}`;
}

function ptStyleLabel(style) {
  if (style === 'conservative') return '保守型';
  if (style === 'aggressive') return '積極型';
  return '穩健型';
}

function ptOrderTypeLabel(orderType) {
  const t = String(orderType || 'MARKET').toUpperCase();
  if (t === 'LIMIT') return '限價單';
  if (t === 'STOP_LOSS') return '停損單';
  if (t === 'TAKE_PROFIT') return '停利單';
  return '市價單';
}

function ptSourceMeta(source) {
  const s = String(source || 'manual').toLowerCase();
  if (s === 'ai') return { label: 'AI 操盤', tone: 'good' };
  if (s === 'order_trigger') return { label: '條件單觸發', tone: 'warn' };
  if (s === 'auto_guardrail') return { label: '護欄自動', tone: '' };
  return { label: '手動', tone: '' };
}

function ptEngineLabel(engineMode) {
  const m = String(engineMode || '').toLowerCase();
  if (m === 'gemini_fc' || m.includes('gemini')) return { label: 'Gemini 多輪推理', tone: 'good' };
  return { label: '量化規則降級', tone: '' };
}

function ptGuardrailStatusMeta(status) {
  const s = String(status || '').toUpperCase();
  if (s === 'PASSED') return { label: '通過', tone: 'good' };
  if (s === 'ADJUSTED') return { label: '護欄調整', tone: 'warn' };
  if (s === 'REJECTED') return { label: '已駁回', tone: 'bad' };
  return { label: s || '—', tone: '' };
}

function ptFmtMoney(val, currency = 'TWD', showSign = false) {
  if (typeof val !== 'number' || !isFinite(val)) return '—';
  const cur = String(currency || 'TWD').toUpperCase();
  const signStr = val < 0 ? '-' : showSign && val > 0 ? '+' : '';
  const absVal = Math.abs(val);
  if (cur === 'USD') {
    return `${signStr}$${fmt(absVal, 2)}`;
  }
  return `${signStr}NT$${fmt(absVal, 0)}`;
}

function ptFmtPrice(val, currency = 'TWD') {
  if (typeof val !== 'number' || !isFinite(val)) return '—';
  const cur = String(currency || 'TWD').toUpperCase();
  if (cur === 'USD') return `$${fmt(val, 2)}`;
  const dp = val < 150 ? 2 : 1;
  return fmt(val, dp);
}

function ptFmtShares(shares, market = 'TW') {
  const n = Number(shares);
  if (!isFinite(n)) return '—';
  if (String(market || '').toUpperCase() === 'US') {
    return `${n.toLocaleString('en-US', { maximumFractionDigits: 4 })} 股`;
  }
  return `${fmt(Math.round(n), 0)} 股`;
}

function ptFmtTime(raw) {
  if (!raw) return '—';
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  return s.slice(0, 16);
}

function ptPnlCls(val) {
  if (typeof val !== 'number' || !isFinite(val) || val === 0) return 'wl-pnl-flat';
  return val > 0 ? 'tw-up' : 'tw-down';
}

function ptHasGeminiKey() {
  return Boolean(
    state.paperHasGeminiKey ||
      state.softwareState?.config?.hasGeminiKey ||
      state.channelsConfig?.hasGeminiKey ||
      state.briefingConfig?.hasGeminiKey
  );
}

function ptBuildDefaultSlotDraft(slot = null) {
  if (!slot) {
    return {
      modeType: 'create',
      slotId: '',
      name: '',
      market: 'TW',
      initialCapital: 1000000,
      mode: 'manual',
      fees: { ...PT_DEFAULT_FEES },
      aiConfig: {
        ...PT_DEFAULT_AI_CONFIG,
        tools: { ...PT_DEFAULT_AI_CONFIG.tools },
        guardrails: { ...PT_DEFAULT_AI_CONFIG.guardrails }
      }
    };
  }
  const f = slot.fees || {};
  const ai = slot.aiConfig || {};
  return {
    modeType: 'settings',
    slotId: slot.id,
    name: slot.name || '',
    market: slot.market || 'TW',
    initialCapital: Number(slot.initialCapital || 1000000),
    mode: slot.mode || 'manual',
    fees: { ...PT_DEFAULT_FEES, ...f },
    aiConfig: {
      ...PT_DEFAULT_AI_CONFIG,
      ...ai,
      tools: { ...PT_DEFAULT_AI_CONFIG.tools, ...(ai.tools || {}) },
      guardrails: { ...PT_DEFAULT_AI_CONFIG.guardrails, ...(ai.guardrails || {}) }
    }
  };
}

function ptBuildDefaultOrderDraft(overrides = {}) {
  return {
    side: 'BUY',
    code: '',
    orderType: 'MARKET',
    shares: '',
    unit: 'shares',
    triggerPrice: '',
    stopLossPct: '',
    takeProfitPct: '',
    note: '',
    ...overrides
  };
}

function renderPaperPendingProposals(slot) {
  const proposals = (slot.aiProposals || []).filter(p => String(p.status || '').toUpperCase() === 'PENDING');
  if (!proposals.length) return '';

  return proposals
    .map(p => {
      const eng = ptEngineLabel(p.engineMode);
      const actions = Array.isArray(p.actions) ? p.actions : [];
      const actionRows = actions.length
        ? actions
            .map(a => {
              const isBuy = String(a.side || '').toUpperCase() === 'BUY';
              const cur = a.market === 'US' ? 'USD' : 'TWD';
              const sltp =
                isBuy && (a.stopLossPct > 0 || a.takeProfitPct > 0)
                  ? `<span class="mini">停損 ${a.stopLossPct ? fmt(a.stopLossPct, 1) + '%' : '—'} / 停利 ${a.takeProfitPct ? fmt(a.takeProfitPct, 1) + '%' : '—'}</span>`
                  : '';
              const adjTag = a.guardrailAdjusted
                ? badge(`護欄調整${a.guardrailNote ? '：' + a.guardrailNote : ''}`, 'warn')
                : '';
              return (
                '<div class="pt-prop-action">' +
                '<div class="pt-prop-action-main">' +
                badge(isBuy ? '買進' : '賣出', isBuy ? 'good' : 'bad') +
                `<b>${esc(a.code)}</b>` +
                (a.name ? `<span class="cell-muted">${esc(a.name)}</span>` : '') +
                `<span class="pt-mono">${esc(ptFmtShares(a.shares, a.market))}</span>` +
                (a.estPrice > 0 ? `<span class="mini">預估價 ${esc(ptFmtPrice(a.estPrice, cur))}</span>` : '') +
                sltp +
                adjTag +
                '</div>' +
                (a.reason ? `<div class="pt-prop-reason">${esc(a.reason)}</div>` : '') +
                '</div>'
              );
            })
            .join('')
        : '<div class="mini">本次 AI 提案建議維持觀望，無需執行下單動作。</div>';

      return (
        '<div class="card pt-proposal-banner">' +
        '<div class="pt-proposal-head">' +
        '<div class="pt-proposal-title-wrap">' +
        badge('待審核 AI 提案', 'warn') +
        badge(eng.label, eng.tone) +
        `<span class="mini">產生於 ${esc(ptFmtTime(p.createdAt))}</span>` +
        '</div>' +
        '<div class="pt-proposal-btns">' +
        `<button type="button" class="btn main sm" data-pt-proposal-approve="${esc(p.id)}"${state.paperBusy ? ' disabled' : ''}>核准並下單</button>` +
        `<button type="button" class="btn danger sm" data-pt-proposal-reject="${esc(p.id)}"${state.paperBusy ? ' disabled' : ''}>駁回</button>` +
        '</div>' +
        '</div>' +
        (p.summary ? `<div class="pt-proposal-summary">${esc(p.summary)}</div>` : '') +
        `<div class="pt-prop-actions">${actionRows}</div>` +
        '</div>'
      );
    })
    .join('');
}

function renderPaperPositionsTab(slot) {
  const list = Array.isArray(slot.positionsList) ? slot.positionsList : [];
  const cur = slot.currency || 'TWD';

  if (!list.length) {
    return (
      '<div class="card">' +
      '<div class="empty">' +
      '<b>目前尚無任何持倉</b>' +
      '點擊右上方「手動下單」建立第一筆模擬部位' +
      (slot.mode === 'ai' ? '，或點擊「⚡ 執行 AI 決策」由 AI 操盤手產出配置建議。' : '。') +
      '</div></div>'
    );
  }

  const rows = list
    .map(p => {
      const isUs = String(p.market || '').toUpperCase() === 'US';
      const priceCur = p.costCurrency || (isUs ? 'USD' : 'TWD');
      const live = state.liveQuotesByCode?.[p.code];
      const curPrice = typeof live?.price === 'number' && isFinite(live.price) ? live.price : p.currentPrice;
      const pnlCls = ptPnlCls(p.unrealizedPnl);
      const pctStr = typeof p.unrealizedPnlPct === 'number' ? `${p.unrealizedPnlPct >= 0 ? '+' : ''}${fmt(p.unrealizedPnlPct, 2)}%` : '—';

      return (
        '<tr>' +
        `<td><button type="button" class="pt-ticker-btn" data-pt-open-stock="${esc(p.code)}" data-pt-stock-market="${esc(p.market || (isUs ? 'US' : 'TW'))}" title="檢視個股詳情"><b>${esc(p.code)}</b> <span class="cell-muted">${esc(p.name || '')}</span></button></td>` +
        `<td><span class="tag">${esc(p.market || (isUs ? 'US' : 'TW'))}</span></td>` +
        `<td>${esc(ptFmtShares(p.shares, p.market))}</td>` +
        `<td>${esc(ptFmtPrice(p.avgCost, priceCur))}</td>` +
        `<td data-live-tbl-price="${esc(p.code)}"${isUs ? ' data-live-currency="USD"' : ''}>${
          isUs ? `<b>${esc(ptFmtPrice(curPrice, 'USD'))}</b>` : esc(ptFmtPrice(curPrice, 'TWD'))
        }</td>` +
        `<td data-live-pt-mv="${esc(p.code)}">${esc(ptFmtMoney(p.marketValue, cur))}</td>` +
        `<td data-live-pt-pnl="${esc(p.code)}" class="${pnlCls}"><b>${esc(ptFmtMoney(p.unrealizedPnl, cur, true))}</b> <span class="pt-sub-pct">(${esc(pctStr)})</span></td>` +
        `<td>${fmt(p.weightPct, 1)}%</td>` +
        '<td class="pt-row-actions">' +
        `<button type="button" class="btn sm" data-pt-quick-sell="${esc(p.code)}">賣出</button>` +
        `<button type="button" class="btn ghost sm" data-pt-quick-sltp="${esc(p.code)}">設停損利</button>` +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  return (
    '<div class="card">' +
    '<div class="tblwrap"><table><thead><tr>' +
    '<th>代號／名稱</th><th>市場</th><th>股數</th><th>均價</th><th>現價</th>' +
    `<th>市值 (${esc(cur)})</th><th>未實現損益／報酬率</th><th>占比</th><th style="text-align:right">操作</th>` +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table></div>' +
    '</div>'
  );
}

function renderPaperOrdersTab(slot) {
  const allOrders = Array.isArray(slot.orders) ? slot.orders : [];
  const pending = allOrders.filter(o => String(o.status || '').toUpperCase() === 'PENDING');
  const history = allOrders.filter(o => String(o.status || '').toUpperCase() !== 'PENDING');

  const headBar =
    '<div class="splithead" style="margin-bottom:14px">' +
    `<div><h3>有效條件掛單（${pending.length}）</h3><div class="mini">限價、停損與停利單會隨盤中報價輪詢或手動檢查自動評估觸發</div></div>` +
    '<div class="toolbar" style="margin:0">' +
    `<button type="button" class="btn sm" id="ptEvalOrdersBtn"${state.paperBusy || !pending.length ? ' disabled' : ''}>↻ 檢查觸發</button>` +
    '<button type="button" class="btn main sm" id="ptNewCondOrderBtn">+ 新增條件單</button>' +
    '</div>' +
    '</div>';

  const renderOrderRows = (list, allowCancel) =>
    list
      .map(o => {
        const isUs = String(o.market || '').toUpperCase() === 'US';
        const priceCur = isUs ? 'USD' : 'TWD';
        const isBuy = String(o.side || '').toUpperCase() === 'BUY';
        const src = ptSourceMeta(o.source);
        const st = String(o.status || '').toUpperCase();
        const stBadge =
          st === 'PENDING'
            ? badge('掛單中', 'warn')
            : st === 'FILLED'
              ? badge('已成交', 'good')
              : badge('已撤單', '');
        const ruleHint =
          o.orderType === 'LIMIT'
            ? isBuy
              ? '≤ 觸發買進'
              : '≥ 觸發賣出'
            : o.orderType === 'STOP_LOSS'
              ? '≤ 停損賣出'
              : '≥ 停利賣出';

        return (
          '<tr>' +
          `<td><b>${esc(o.code)}</b> <span class="cell-muted">${esc(o.name || '')}</span></td>` +
          `<td>${badge(isBuy ? '買進' : '賣出', isBuy ? 'good' : 'bad')} <span class="tag">${esc(ptOrderTypeLabel(o.orderType))}</span></td>` +
          `<td>${esc(ptFmtShares(o.shares, o.market))}</td>` +
          `<td><b>${esc(ptFmtPrice(o.triggerPrice, priceCur))}</b><small>${esc(ruleHint)}</small></td>` +
          `<td>${badge(src.label, src.tone)}</td>` +
          `<td>${stBadge}</td>` +
          `<td>${esc(ptFmtTime(o.triggeredAt || o.createdAt))}${o.note ? `<small>${esc(o.note)}</small>` : ''}</td>` +
          `<td style="text-align:right">${
            allowCancel
              ? `<button type="button" class="btn danger sm" data-pt-cancel-order="${esc(o.id)}"${state.paperBusy ? ' disabled' : ''}>撤單</button>`
              : '<span class="mini">—</span>'
          }</td>` +
          '</tr>'
        );
      })
      .join('');

  const pendingHtml = pending.length
    ? '<div class="tblwrap"><table><thead><tr>' +
      '<th>標的</th><th>方向／類型</th><th>股數</th><th>觸發價</th><th>來源</th><th>狀態</th><th>建立時間／備註</th><th style="text-align:right">操作</th>' +
      '</tr></thead><tbody>' +
      renderOrderRows(pending, true) +
      '</tbody></table></div>'
    : '<div class="empty"><b>目前沒有待觸發的條件掛單</b>可點擊「新增條件單」設定限價買賣，或於持倉列一鍵設定停損／停利。</div>';

  const historyHtml = history.length
    ? '<details class="pt-details" style="margin-top:16px">' +
      `<summary>歷史已成交／已撤銷條件單（${history.length}）</summary>` +
      '<div class="tblwrap" style="margin-top:10px"><table><thead><tr>' +
      '<th>標的</th><th>方向／類型</th><th>股數</th><th>觸發價</th><th>來源</th><th>狀態</th><th>異動時間／備註</th><th style="text-align:right">—</th>' +
      '</tr></thead><tbody>' +
      renderOrderRows(history.slice(0, 30), false) +
      '</tbody></table></div>' +
      '</details>'
    : '';

  return `<div class="card">${headBar}${pendingHtml}${historyHtml}</div>`;
}

function renderPaperTradesTab(slot) {
  const trades = Array.isArray(slot.trades) ? slot.trades : [];
  const cur = slot.currency || 'TWD';

  if (!trades.length) {
    return (
      '<div class="card"><div class="empty"><b>尚無成交紀錄</b>完成任一筆買進或賣出後，系統將完整紀錄手續費、證交稅、匯率與已實現損益。</div></div>'
    );
  }

  const rows = trades
    .map(t => {
      const isBuy = String(t.side || '').toUpperCase() === 'BUY';
      const priceCur = t.priceCurrency || (t.market === 'US' ? 'USD' : 'TWD');
      const src = ptSourceMeta(t.source);
      const feeTaxStr = `費 ${ptFmtMoney(t.fee || 0, cur)}${t.tax > 0 ? ` · 稅 ${ptFmtMoney(t.tax, cur)}` : ''}`;
      const fxHint =
        slot.market === 'MIXED' && t.market === 'US' && t.fxRate
          ? ` · FX ${fmt(t.fxRate, 2)}`
          : '';
      const hasRealized = typeof t.realizedPnl === 'number' && isFinite(t.realizedPnl);

      return (
        '<tr>' +
        `<td>${esc(ptFmtTime(t.timestamp))}</td>` +
        `<td><b>${esc(t.code)}</b> <span class="cell-muted">${esc(t.name || '')}</span></td>` +
        `<td>${badge(isBuy ? '買進' : '賣出', isBuy ? 'good' : 'bad')} <span class="mini">${esc(ptOrderTypeLabel(t.orderType))}</span></td>` +
        `<td>${esc(ptFmtShares(t.shares, t.market))}</td>` +
        `<td>${esc(ptFmtPrice(t.price, priceCur))}</td>` +
        `<td><b>${esc(ptFmtMoney(t.netAmount, cur))}</b><small>${esc(feeTaxStr + fxHint)}</small></td>` +
        `<td class="${hasRealized ? ptPnlCls(t.realizedPnl) : 'mini'}">${
          hasRealized ? `<b>${esc(ptFmtMoney(t.realizedPnl, cur, true))}</b>` : '—'
        }</td>` +
        '<td>' +
        '<div class="pt-trade-tags">' +
        badge(src.label, src.tone) +
        (t.simulatedAfterHours ? badge('以最新收盤價模擬', 'warn') : '') +
        '</div>' +
        (t.note ? `<small>${esc(t.note)}</small>` : '') +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  return (
    '<div class="card">' +
    '<div class="tblwrap"><table><thead><tr>' +
    '<th>成交時間</th><th>標的</th><th>方向／類型</th><th>股數</th><th>成交價</th>' +
    `<th>淨收付 (${esc(cur)})</th><th>已實現損益</th><th>來源與撮合標記</th>` +
    '</tr></thead><tbody>' +
    rows +
    '</tbody></table></div>' +
    '</div>'
  );
}

function renderPaperAiLogsTab(slot) {
  const logs = Array.isArray(slot.aiLogs) ? slot.aiLogs : [];
  const hasKey = ptHasGeminiKey();

  const keyBar =
    '<div class="card pt-ai-status-bar">' +
    '<div class="pt-ai-status-left">' +
    (hasKey
      ? badge('Gemini 多輪推理已啟用', 'good') +
        '<span class="mini">AI 操盤手將透過 Function Calling 自主查詢站內工具並通過後端硬性風控護欄。</span>'
      : badge('量化規則降級模式', '') +
        '<span class="mini">未設定 Gemini Key；AI 操盤手將以多因子規則引擎運作，也可至軟體設定加密填寫 Key。</span>' +
        '<button type="button" class="btn ghost sm" data-go-software-ai="1">前往軟體設定管理 Key →</button>') +
    '</div>' +
    (slot.mode !== 'ai'
      ? '<span class="mini">目前存檔為手動模式，可於「⚙ 存檔設定」切換為 AI 代操</span>'
      : `<span class="mini">風格：${esc(ptStyleLabel(slot.aiConfig?.style))} · 冷卻 ${esc(String(slot.aiConfig?.cooldownMinutes ?? 60))} 分鐘</span>`) +
    '</div>';

  if (!logs.length) {
    return (
      keyBar +
      '<div class="card"><div class="empty"><b>尚無 AI 決策審計日誌</b>' +
      (slot.mode === 'ai'
        ? '點擊右上方「⚡ 執行 AI 決策」後，每次查詢的工具、推理過程與風控護欄檢核結果都會完整留存於此。'
        : '此存檔目前為手動操盤模式；若想啟用 AI 決策分析，請於「⚙ 存檔設定」切換為 AI 操盤手。') +
      '</div></div>'
    );
  }

  const cards = logs
    .map((log, idx) => {
      const eng = ptEngineLabel(log.engineMode);
      const tools = Array.isArray(log.toolsUsed) ? log.toolsUsed : [];
      const checks = Array.isArray(log.guardrailChecks) ? log.guardrailChecks : [];
      const execCount = (log.executedTrades || []).length;
      const outcomeBadge = log.error
        ? badge('執行異常', 'bad')
        : execCount > 0
          ? badge(`已自動成交 ${execCount} 筆`, 'good')
          : log.proposalId
            ? badge('已產生待審提案', 'warn')
            : badge('維持觀望', '');

      const toolsHtml = tools.length
        ? '<div class="pt-log-section">' +
          '<div class="pt-log-label">查詢工具紀錄</div>' +
          '<div class="pt-tool-pills">' +
          tools
            .map(t => {
              const label = PT_TOOL_NAME_MAP[t.tool] || t.tool;
              return `<span class="pt-tool-pill" title="${esc(t.summary || '')}"><b>${esc(label)}</b>${t.summary ? `<span>${esc(t.summary)}</span>` : ''}</span>`;
            })
            .join('') +
          '</div></div>'
        : '';

      const checksHtml = checks.length
        ? '<div class="pt-log-section">' +
          '<div class="pt-log-label">硬性風控護欄檢核（後端程式碼強制執行）</div>' +
          '<div class="tblwrap"><table><thead><tr>' +
          '<th>標的</th><th>方向</th><th>AI 原始股數</th><th>護欄核准股數</th><th>檢核結果</th><th>說明</th>' +
          '</tr></thead><tbody>' +
          checks
            .map(c => {
              const st = ptGuardrailStatusMeta(c.status);
              const isBuy = String(c.side || '').toUpperCase() === 'BUY';
              return (
                '<tr>' +
                `<td><b>${esc(c.code)}</b></td>` +
                `<td>${badge(isBuy ? '買進' : '賣出', isBuy ? 'good' : 'bad')}</td>` +
                `<td>${esc(String(c.requestedShares ?? '—'))}</td>` +
                `<td><b>${esc(String(c.finalShares ?? '—'))}</b></td>` +
                `<td>${badge(st.label, st.tone)}</td>` +
                `<td><span class="mini">${esc(c.note || '符合所有護欄條件')}</span></td>` +
                '</tr>'
              );
            })
            .join('') +
          '</tbody></table></div></div>'
        : '';

      return (
        `<details class="card pt-log-card"${idx === 0 ? ' open' : ''}>` +
        '<summary class="pt-log-summary">' +
        '<div class="pt-log-summary-left">' +
        `<b>${esc(ptFmtTime(log.timestamp))}</b>` +
        `<span class="mini">${esc(log.trigger || '手動觸發')}</span>` +
        badge(eng.label, eng.tone) +
        badge(log.autonomy === 'full' ? '全自動' : '半自動', '') +
        '</div>' +
        '<div class="pt-log-summary-right">' +
        `<span class="mini">工具 ${tools.length} 次</span>` +
        outcomeBadge +
        '</div>' +
        '</summary>' +
        '<div class="pt-log-body">' +
        (log.error ? `<div class="notice warn" style="margin:0 0 12px">${esc(log.error)}</div>` : '') +
        (log.reasoning
          ? `<div class="pt-log-reasoning"><b>推理摘要：</b>${esc(log.reasoning)}</div>`
          : '') +
        toolsHtml +
        checksHtml +
        '</div>' +
        '</details>'
      );
    })
    .join('');

  return `${keyBar}<div class="pt-log-list">${cards}</div>`;
}

function renderPaperSlotModal() {
  const d = state.paperSlotDraft || ptBuildDefaultSlotDraft(null);
  const isSettings = d.modeType === 'settings';
  const isAi = d.mode === 'ai';
  const fees = d.fees || PT_DEFAULT_FEES;
  const ai = d.aiConfig || PT_DEFAULT_AI_CONFIG;
  const gr = ai.guardrails || PT_DEFAULT_AI_CONFIG.guardrails;
  const tools = ai.tools || PT_DEFAULT_AI_CONFIG.tools;

  const aiSectionHtml = isAi
    ? '<div class="pt-modal-subcard">' +
      '<div class="pt-modal-subtitle">AI 操盤手與硬性風控護欄設定</div>' +
      '<div class="formgrid">' +
      '<div class="field">' +
      '<label for="ptAiAutonomy">自治等級</label>' +
      '<select id="ptAiAutonomy" class="select">' +
      `<option value="semi" ${ai.autonomy !== 'full' ? 'selected' : ''}>半自動提案（AI 提出清單，由您一鍵核准／駁回）</option>` +
      `<option value="full" ${ai.autonomy === 'full' ? 'selected' : ''}>全自動代操（通過硬性護欄後直接模擬下單）</option>` +
      '</select></div>' +
      '<div class="field">' +
      '<label for="ptAiStyle">操盤風格</label>' +
      '<select id="ptAiStyle" class="select">' +
      `<option value="conservative" ${ai.style === 'conservative' ? 'selected' : ''}>保守型（重視低波動與現金保護）</option>` +
      `<option value="balanced" ${ai.style === 'balanced' || !ai.style ? 'selected' : ''}>穩健型（籌碼與趨勢均衡配置）</option>` +
      `<option value="aggressive" ${ai.style === 'aggressive' ? 'selected' : ''}>積極型（優先動能與強勢突破）</option>` +
      '</select></div>' +
      '<div class="field">' +
      '<label for="ptAiSchedule">觸發排程</label>' +
      '<select id="ptAiSchedule" class="select">' +
      `<option value="manual" ${ai.scheduleMode !== 'daily' ? 'selected' : ''}>僅手動點擊觸發</option>` +
      `<option value="daily" ${ai.scheduleMode === 'daily' ? 'selected' : ''}>併入每日 10:00 自動排程執行</option>` +
      '</select></div>' +
      '<div class="field">' +
      '<label for="ptAiCooldown">自動觸發冷卻（分鐘）</label>' +
      `<input id="ptAiCooldown" type="number" min="0" max="1440" step="5" value="${esc(String(ai.cooldownMinutes ?? 60))}">` +
      '</div>' +
      '<div class="field fullrow">' +
      '<label for="ptAiCustomPrompt">自訂操盤偏好（選填，絕不可覆寫下方硬性風控護欄）</label>' +
      `<textarea id="ptAiCustomPrompt" class="pt-textarea" rows="2" placeholder="例：偏好半導體與高息 ETF，避免追高開盤大漲 5% 以上個股">${esc(ai.customPrompt || '')}</textarea>` +
      '</div>' +
      '</div>' +
      '<div class="pt-guardrail-head">程式碼強制硬性護欄（Python 後端把關）</div>' +
      '<div class="pt-guardrail-grid">' +
      '<div class="field"><label for="ptGrMaxSingle">單檔上限 (%)</label>' +
      `<input id="ptGrMaxSingle" type="number" min="5" max="100" step="1" value="${esc(String(gr.maxSingleStockPct ?? 25))}"></div>` +
      '<div class="field"><label for="ptGrMaxPos">最多持股 (檔)</label>' +
      `<input id="ptGrMaxPos" type="number" min="1" max="50" step="1" value="${esc(String(gr.maxPositions ?? 8))}"></div>` +
      '<div class="field"><label for="ptGrMinCash">最低現金 (%)</label>' +
      `<input id="ptGrMinCash" type="number" min="0" max="90" step="1" value="${esc(String(gr.minCashFloorPct ?? 15))}"></div>` +
      '<div class="field"><label for="ptGrDefSl">預設停損 (%)</label>' +
      `<input id="ptGrDefSl" type="number" min="0" max="50" step="0.5" value="${esc(String(gr.defaultStopLossPct ?? 8))}"></div>` +
      '<div class="field"><label for="ptGrDefTp">預設停利 (%)</label>' +
      `<input id="ptGrDefTp" type="number" min="0" max="200" step="0.5" value="${esc(String(gr.defaultTakeProfitPct ?? 18))}"></div>` +
      '</div>' +
      '<details class="pt-details" style="margin-top:12px">' +
      '<summary>AI 可呼叫之全站工具（預設全啟用）</summary>' +
      '<div class="pt-tools-grid">' +
      PT_AI_TOOLS_META.map(
        ([k, lbl, desc]) =>
          `<label class="pt-tool-check" title="${esc(desc)}">` +
          `<input type="checkbox" data-pt-ai-tool="${esc(k)}" ${tools[k] !== false ? 'checked' : ''}>` +
          `<span><b>${esc(lbl)}</b><small>${esc(desc)}</small></span>` +
          '</label>'
      ).join('') +
      '</div>' +
      '</details>' +
      '</div>'
    : '';

  const feeSectionHtml =
    '<details class="pt-details" style="margin-top:12px">' +
    '<summary>進階：台美股手續費與證交稅設定（預設符合台灣券商標準）</summary>' +
    '<div class="pt-guardrail-grid" style="margin-top:10px">' +
    '<div class="field"><label for="ptFeeTwBuy">台股買進手續費 (%)</label>' +
    `<input id="ptFeeTwBuy" type="number" min="0" max="2" step="0.0005" value="${esc(String(Number((fees.twBuyFeeRate * 100).toFixed(4))))}"></div>` +
    '<div class="field"><label for="ptFeeTwSell">台股賣出手續費 (%)</label>' +
    `<input id="ptFeeTwSell" type="number" min="0" max="2" step="0.0005" value="${esc(String(Number((fees.twSellFeeRate * 100).toFixed(4))))}"></div>` +
    '<div class="field"><label for="ptFeeTwDisc">券商折數 (1=無折)</label>' +
    `<input id="ptFeeTwDisc" type="number" min="0" max="1" step="0.05" value="${esc(String(fees.twFeeDiscount ?? 1))}"></div>` +
    '<div class="field"><label for="ptFeeTwMin">台股低消 (元)</label>' +
    `<input id="ptFeeTwMin" type="number" min="0" max="500" step="1" value="${esc(String(fees.twMinFee ?? 20))}"></div>` +
    '<div class="field"><label for="ptFeeTwTax">個股證交稅 (%)</label>' +
    `<input id="ptFeeTwTax" type="number" min="0" max="2" step="0.01" value="${esc(String(Number((fees.twStockTaxRate * 100).toFixed(3))))}"></div>` +
    '<div class="field"><label for="ptFeeTwEtfTax">ETF 證交稅 (%)</label>' +
    `<input id="ptFeeTwEtfTax" type="number" min="0" max="2" step="0.01" value="${esc(String(Number((fees.twEtfTaxRate * 100).toFixed(3))))}"></div>` +
    '<div class="field"><label for="ptFeeUsRate">美股手續費 (%)</label>' +
    `<input id="ptFeeUsRate" type="number" min="0" max="2" step="0.01" value="${esc(String(Number((fees.usFeeRate * 100).toFixed(3))))}"></div>` +
    '<div class="field"><label for="ptFeeUsMin">美股低消 (USD)</label>' +
    `<input id="ptFeeUsMin" type="number" min="0" max="100" step="0.5" value="${esc(String(fees.usMinFee ?? 0))}"></div>` +
    '</div>' +
    '</details>';

  const dangerZoneHtml = isSettings
    ? '<div class="pt-danger-zone">' +
      '<div class="pt-danger-row">' +
      '<div><b>重置存檔</b><div class="mini">清空所有持倉、掛單與交易紀錄，回復為初始現金</div></div>' +
      (state.paperConfirmReset
        ? '<div class="ch-confirm-inline">' +
          `<input id="ptResetCapitalInput" type="number" min="100" step="1000" value="${esc(String(d.initialCapital || 1000000))}" style="width:130px" title="重置後初始本金">` +
          `<button type="button" class="btn danger sm" id="ptConfirmResetBtn"${state.paperBusy ? ' disabled' : ''}>確認重置</button>` +
          '<button type="button" class="btn ghost sm" id="ptCancelDangerBtn">取消</button>' +
          '</div>'
        : '<button type="button" class="btn sm" id="ptAskResetBtn">重置存檔</button>') +
      '</div>' +
      '<div class="pt-danger-row">' +
      '<div><b>刪除存檔</b><div class="mini">永久移除此模擬帳戶 JSON 存檔，無法復原</div></div>' +
      (state.paperConfirmDelete
        ? '<div class="ch-confirm-inline">' +
          '<span class="mini">確定永久刪除？</span>' +
          `<button type="button" class="btn danger sm" id="ptConfirmDeleteBtn"${state.paperBusy ? ' disabled' : ''}>確認刪除</button>` +
          '<button type="button" class="btn ghost sm" id="ptCancelDangerBtn">取消</button>' +
          '</div>'
        : '<button type="button" class="btn danger sm" id="ptAskDeleteBtn">刪除存檔</button>') +
      '</div>' +
      '</div>'
    : '';

  return (
    '<div class="wl-modal-backdrop" id="ptModalBackdrop">' +
    '<div class="card pt-modal pt-modal-lg" role="dialog" aria-modal="true" aria-label="模擬存檔設定">' +
    cardhead(
      isSettings ? `存檔設定｜${esc(d.name)}` : '新建模擬操盤存檔',
      isSettings ? '修改模式、手續費與 AI 操盤手護欄；可隨時在手動與 AI 模式之間切換' : '各存檔完全隔離，可分別測試台股、美股或台美混合策略',
      '<button type="button" class="btn ghost sm" id="ptCloseModalBtn">關閉</button>'
    ) +
    '<div class="pt-modal-body">' +
    '<div class="formgrid">' +
    '<div class="field">' +
    '<label for="ptSlotName">存檔名稱</label>' +
    `<input id="ptSlotName" maxlength="40" placeholder="例：台股波段手動、AI 台美混合穩健" value="${esc(d.name || '')}">` +
    '</div>' +
    '<div class="field">' +
    '<label for="ptSlotMarket">交易市場與記帳幣別</label>' +
    `<select id="ptSlotMarket" class="select"${isSettings ? ' disabled' : ''}>` +
    `<option value="TW" ${d.market === 'TW' ? 'selected' : ''}>台股 TW（以 TWD 新台幣記帳）</option>` +
    `<option value="US" ${d.market === 'US' ? 'selected' : ''}>美股 US（以 USD 美元記帳）</option>` +
    `<option value="MIXED" ${d.market === 'MIXED' ? 'selected' : ''}>台美混合 MIXED（以 TWD 統一換算淨值）</option>` +
    '</select>' +
    '</div>' +
    (!isSettings
      ? '<div class="field">' +
        `<label for="ptSlotCapital">初始本金（${d.market === 'US' ? 'USD 美元' : 'TWD 新台幣'}）</label>` +
        `<input id="ptSlotCapital" type="number" min="100" step="1000" value="${esc(String(d.initialCapital || (d.market === 'US' ? 30000 : 1000000)))}">` +
        '</div>'
      : '') +
    '<div class="field">' +
    '<label for="ptSlotMode">操作模式</label>' +
    '<select id="ptSlotMode" class="select">' +
    `<option value="manual" ${!isAi ? 'selected' : ''}>手動操盤（自行下單與掛單）</option>` +
    `<option value="ai" ${isAi ? 'selected' : ''}>AI 操盤手（仍隨時支援手動介入買賣）</option>` +
    '</select>' +
    '</div>' +
    '</div>' +
    aiSectionHtml +
    feeSectionHtml +
    dangerZoneHtml +
    '</div>' +
    '<div class="wl-modal-foot">' +
    '<span class="mini">隔離保存於 %LOCALAPPDATA%\\ChipScreener\\paper-trading-v1\\</span>' +
    '<div class="toolbar" style="margin:0">' +
    '<button type="button" class="btn ghost sm" id="ptCloseModalBtn2">取消</button>' +
    `<button type="button" class="btn main sm" id="ptSaveSlotBtn"${state.paperBusy ? ' disabled' : ''}>${
      state.paperBusy ? '儲存中...' : isSettings ? '儲存設定' : '建立存檔'
    }</button>` +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderPaperOrderQuotePreviewHtml(slot, rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return '';

  const q = state.liveQuotesByCode?.[code];
  const hasPrice = typeof q?.price === 'number' && isFinite(q.price);
  const isCurrentLoading = Boolean(state.paperOrderQuoteLoading && state.paperOrderQuoteCode === code);
  const errMsg = state.paperOrderQuoteCode === code ? state.paperOrderQuoteError : '';

  if (hasPrice) {
    const isUs = q.market === 'US' || !ptIsTwCode(code);
    const dp = isUs ? 2 : q.price < 150 ? 2 : 1;
    const priceStr = isUs ? `$${fmt(q.price, 2)}` : fmt(q.price, dp);
    const chg = typeof q.change === 'number' && isFinite(q.change) ? q.change : null;
    const chgPct = typeof q.changePct === 'number' && isFinite(q.changePct) ? q.changePct : null;
    const dirCls = chg === null ? '' : chg > 0 ? 'tw-up' : chg < 0 ? 'tw-down' : 'wl-pnl-flat';
    const arrow = chg === null ? '' : chg > 0 ? '▲' : chg < 0 ? '▼' : '';
    const chgText =
      chg !== null && chgPct !== null
        ? `${arrow ? arrow + ' ' : ''}${pp(chg, 2)} (${pp(chgPct, 2)}%)`
        : '—';
    const pos = slot?.positions?.[code] || (slot?.positionsList || []).find(p => p.code === code);
    const stockName = q.name || pos?.name || D.stocks?.[code]?.[0] || '';
    const stateBadge =
      q.marketState === 'REGULAR' ? badge('盤中即時', 'good') : badge('最新收盤', '');
    const dateHint = q.tradeDate ? `<span class="mini">${esc(q.tradeDate)}</span>` : '';
    const busyHint = isCurrentLoading ? '<span class="mini">更新中...</span>' : '';

    return (
      '<div class="pt-order-quote">' +
      '<div class="pt-order-quote-left">' +
      `<b class="pt-order-quote-code">${esc(code)}</b>` +
      (stockName ? `<span class="pt-order-quote-name">${esc(stockName)}</span>` : '') +
      `<strong class="pt-order-quote-price ${dirCls}">${esc(priceStr)}</strong>` +
      `<span class="pt-order-quote-chg ${dirCls}">${esc(chgText)}</span>` +
      '</div>' +
      '<div class="pt-order-quote-right">' +
      stateBadge +
      dateHint +
      busyHint +
      '</div>' +
      '</div>'
    );
  }

  if (isCurrentLoading) {
    return (
      '<div class="pt-order-quote is-loading">' +
      `<span class="mini">查詢 ${esc(code)} 即時報價中...</span>` +
      '</div>'
    );
  }

  if (errMsg) {
    return (
      '<div class="pt-order-quote is-err">' +
      `<span class="mini">${esc(errMsg)}</span>` +
      '</div>'
    );
  }

  return '';
}

function renderPaperOrderModal(slot) {
  const d = state.paperOrderDraft || ptBuildDefaultOrderDraft();
  const isBuy = d.side !== 'SELL';
  const cur = slot.currency || 'TWD';
  const mkt = slot.market || 'TW';
  const suggestScope = mkt === 'TW' ? 'TW' : mkt === 'US' ? 'US' : 'ALL';
  const codeUpper = String(d.code || '').trim().toUpperCase();
  const isTwSym = mkt === 'TW' || (mkt === 'MIXED' && (!codeUpper || ptIsTwCode(codeUpper)));
  const pos = codeUpper ? (slot.positions || {})[codeUpper] || (slot.positionsList || []).find(p => p.code === codeUpper) : null;
  const isMarketOrder = d.orderType === 'MARKET';
  const previewCode =
    state.paperOrderQuoteCode && (!codeUpper || codeUpper === state.paperOrderQuoteCode)
      ? state.paperOrderQuoteCode
      : codeUpper;
  const quotePreviewHtml = renderPaperOrderQuotePreviewHtml(slot, previewCode);

  const contextHint = isBuy
    ? `可用現金：<b>${esc(ptFmtMoney(slot.cash, cur))}</b>${mkt === 'MIXED' && state.paperFxUsdTwd ? ` · USD/TWD ${fmt(state.paperFxUsdTwd, 2)}` : ''}`
    : pos
      ? `目前持有 ${esc(codeUpper)}：<b>${esc(ptFmtShares(pos.shares, pos.market))}</b>（均價 ${esc(ptFmtPrice(pos.avgCost, pos.costCurrency || (pos.market === 'US' ? 'USD' : 'TWD')))}）`
      : '請選擇或輸入目前已持有之標的代號進行賣出';

  const unitHelperHtml = isTwSym
    ? '<div class="pt-unit-bar">' +
      '<div class="seg">' +
      `<button type="button" class="${d.unit !== 'lots' ? 'on' : ''}" data-pt-order-unit="shares">股（零股）</button>` +
      `<button type="button" class="${d.unit === 'lots' ? 'on' : ''}" data-pt-order-unit="lots">張（1張=1000股）</button>` +
      '</div>' +
      '<div class="pt-quick-qty">' +
      (isBuy
        ? '<button type="button" class="btn ghost sm" data-pt-quick-qty="1000">1 張</button>' +
          '<button type="button" class="btn ghost sm" data-pt-quick-qty="2000">2 張</button>'
        : pos
          ? `<button type="button" class="btn ghost sm" data-pt-quick-qty="${esc(String(pos.shares))}">全部 (${fmt(pos.shares, 0)} 股)</button>`
          : '') +
      '</div>' +
      '</div>'
    : !isBuy && pos
      ? `<div class="pt-unit-bar"><button type="button" class="btn ghost sm" data-pt-quick-qty="${esc(String(pos.shares))}">賣出全部 (${esc(ptFmtShares(pos.shares, 'US'))})</button></div>`
      : '';

  return (
    '<div class="wl-modal-backdrop" id="ptModalBackdrop">' +
    '<div class="card pt-modal" role="dialog" aria-modal="true" aria-label="手動下單">' +
    cardhead(
      `手動下單｜${esc(slot.name)}`,
      `${esc(ptMarketLabel(mkt))} · 盤中即時價成交，休市則以最新收盤價模擬`,
      '<button type="button" class="btn ghost sm" id="ptCloseModalBtn">關閉</button>'
    ) +
    '<div class="pt-order-side-row">' +
    `<button type="button" class="pt-side-btn ${isBuy ? 'active-buy' : ''}" data-pt-order-side="BUY">買進 BUY</button>` +
    `<button type="button" class="pt-side-btn ${!isBuy ? 'active-sell' : ''}" data-pt-order-side="SELL">賣出 SELL</button>` +
    '</div>' +
    `<div class="pt-order-context">${contextHint}</div>` +
    '<div class="formgrid">' +
    '<div class="field">' +
    '<label for="ptOrderCode">標的代號／名稱</label>' +
    `<input id="ptOrderCode" autocomplete="off" data-stock-suggest="${esc(suggestScope)}" placeholder="${
      mkt === 'US' ? '輸入美股如 NVDA、AAPL' : mkt === 'TW' ? '輸入台股如 2330、台積電' : '輸入台股 2330 或美股 NVDA'
    }" value="${esc(d.code || '')}">` +
    '</div>' +
    '<div class="field">' +
    '<label for="ptOrderType">委託類型</label>' +
    '<select id="ptOrderType" class="select">' +
    `<option value="MARKET" ${d.orderType === 'MARKET' ? 'selected' : ''}>市價單（立即撮合成交）</option>` +
    `<option value="LIMIT" ${d.orderType === 'LIMIT' ? 'selected' : ''}>限價單（達目標價自動成交）</option>` +
    (!isBuy
      ? `<option value="STOP_LOSS" ${d.orderType === 'STOP_LOSS' ? 'selected' : ''}>停損單（跌破觸發價自動賣出）</option>` +
        `<option value="TAKE_PROFIT" ${d.orderType === 'TAKE_PROFIT' ? 'selected' : ''}>停利單（突破觸發價自動賣出）</option>`
      : '') +
    '</select>' +
    '</div>' +
    `<div class="fullrow pt-order-quote-slot" id="ptOrderQuotePreview">${quotePreviewHtml}</div>` +
    '<div class="field fullrow">' +
    `<label for="ptOrderShares">${isTwSym && d.unit === 'lots' ? '委託張數（1 張 = 1,000 股）' : '委託股數'}</label>` +
    `<input id="ptOrderShares" type="number" min="${isTwSym ? (d.unit === 'lots' ? '1' : '1') : '0.0001'}" step="${isTwSym ? '1' : '0.01'}" placeholder="${
      isTwSym ? (d.unit === 'lots' ? '例：1（代表 1,000 股）' : '例：1000 或零股 100') : '支援碎股，例：5 或 0.5'
    }" value="${esc(String(d.shares ?? ''))}">` +
    unitHelperHtml +
    '</div>' +
    (!isMarketOrder
      ? '<div class="field fullrow">' +
        `<label for="ptOrderTriggerPrice">觸發價格（${isTwSym ? 'TWD' : 'USD'}）</label>` +
        `<input id="ptOrderTriggerPrice" type="number" min="0.01" step="0.01" placeholder="輸入條件單觸發價" value="${esc(String(d.triggerPrice ?? ''))}">` +
        '</div>'
      : '') +
    (isBuy && isMarketOrder
      ? '<div class="field">' +
        '<label for="ptOrderSlPct">自動掛停損單 %（選填）</label>' +
        `<input id="ptOrderSlPct" type="number" min="0" max="50" step="0.5" placeholder="例：8（跌 8% 觸發）" value="${esc(String(d.stopLossPct ?? ''))}">` +
        '</div>' +
        '<div class="field">' +
        '<label for="ptOrderTpPct">自動掛停利單 %（選填）</label>' +
        `<input id="ptOrderTpPct" type="number" min="0" max="200" step="0.5" placeholder="例：18（漲 18% 觸發）" value="${esc(String(d.takeProfitPct ?? ''))}">` +
        '</div>'
      : '') +
    '<div class="field fullrow">' +
    '<label for="ptOrderNote">交易備註（選填）</label>' +
    `<input id="ptOrderNote" maxlength="120" placeholder="紀錄進出場理由，方便日後檢討" value="${esc(d.note || '')}">` +
    '</div>' +
    '</div>' +
    '<div class="wl-modal-foot">' +
    `<span class="mini">${isMarketOrder ? '送出後立即依最新報價模擬撮合' : '送出後列為有效條件掛單'}</span>` +
    '<div class="toolbar" style="margin:0">' +
    '<button type="button" class="btn ghost sm" id="ptCloseModalBtn2">取消</button>' +
    `<button type="button" class="btn main sm" id="ptSubmitOrderBtn"${state.paperBusy ? ' disabled' : ''}>${
      state.paperBusy ? '送單中...' : isBuy ? '確認買進' : '確認賣出'
    }</button>` +
    '</div>' +
    '</div>' +
    '</div>' +
    '</div>'
  );
}

function renderPaperCompareModal() {
  const slots = Array.isArray(state.paperSlots) ? state.paperSlots : [];
  const activeId = state.paperActiveSlotId || '';

  const rows = slots
    .map(s => {
      const cur = s.currency || (s.market === 'US' ? 'USD' : 'TWD');
      const retCls = ptPnlCls(s.totalReturnPct);
      const isCur = s.id === activeId;
      return (
        `<tr class="clickable${isCur ? ' pt-compare-active' : ''}" data-pt-switch-slot="${esc(s.id)}">` +
        `<td><b>${esc(s.name)}</b>${isCur ? ' <span class="tag good">目前</span>' : ''}</td>` +
        `<td><span class="tag">${esc(ptMarketShort(s.market))}</span></td>` +
        `<td>${badge(s.mode === 'ai' ? 'AI 代操' : '手動', s.mode === 'ai' ? 'good' : '')}</td>` +
        `<td>${esc(ptFmtMoney(s.initialCapital, cur))}</td>` +
        `<td><b>${esc(ptFmtMoney(s.totalEquity, cur))}</b></td>` +
        `<td class="${retCls}"><b>${s.totalReturnPct >= 0 ? '+' : ''}${fmt(s.totalReturnPct, 2)}%</b></td>` +
        `<td>${s.positionCount ?? 0} 檔</td>` +
        `<td>${fmt(s.winRatePct, 1)}%</td>` +
        `<td>${fmt(s.maxDrawdownPct, 2)}%</td>` +
        `<td style="text-align:right"><button type="button" class="btn sm" data-pt-switch-slot="${esc(s.id)}">${isCur ? '檢視' : '切換'}</button></td>` +
        '</tr>'
      );
    })
    .join('');

  return (
    '<div class="wl-modal-backdrop" id="ptModalBackdrop">' +
    '<div class="card pt-modal pt-modal-xl" role="dialog" aria-modal="true" aria-label="多存檔績效比較">' +
    cardhead(
      '多存檔績效比較',
      `共 ${slots.length} 組獨立模擬存檔；點擊任一列即可切換工作區`,
      '<button type="button" class="btn ghost sm" id="ptCloseModalBtn">關閉</button>'
    ) +
    (slots.length
      ? '<div class="tblwrap"><table><thead><tr>' +
        '<th>存檔名稱</th><th>市場</th><th>模式</th><th>初始本金</th><th>總資產</th>' +
        '<th>總報酬率</th><th>持股</th><th>勝率</th><th>最大回撤</th><th style="text-align:right">操作</th>' +
        '</tr></thead><tbody>' +
        rows +
        '</tbody></table></div>'
      : '<div class="empty">尚未建立任何模擬存檔</div>') +
    '</div>' +
    '</div>'
  );
}

function renderPaperModal(slot) {
  const modal = state.paperModal;
  if (!modal) return '';
  if (modal === 'create' || modal === 'settings') return renderPaperSlotModal();
  if (modal === 'order' && slot) return renderPaperOrderModal(slot);
  if (modal === 'compare') return renderPaperCompareModal();
  return '';
}

function paperPage() {
  if (!hasHttpFeed) {
    return (
      title(
        '模擬操盤 ＆ AI 操盤手',
        '多存檔台美股模擬交易、條件掛單與 AI 操盤手工作區；資料隔離保存於本機。',
        badge('需本機服務', 'warn')
      ) +
      '<div class="card"><div class="empty"><b>目前為純離線檔案模式</b>模擬操盤、即時報價撮合與 AI 操盤手需要透過本機服務執行，請使用 <b>ChipScreener.exe</b> 或執行 <code>launcher.py</code> 開啟。</div></div>'
    );
  }

  const slots = Array.isArray(state.paperSlots) ? state.paperSlots : [];
  const slot = state.paperSlot || null;
  const errNotice = state.paperError
    ? `<div class="notice warn" style="margin-bottom:14px">${esc(state.paperError)}</div>`
    : '';
  const modalHtml = renderPaperModal(slot);

  if (!slot && state.paperLoading && !state.paperLoaded) {
    return (
      title('模擬操盤 ＆ AI 操盤手', '正在載入本機模擬存檔與最新淨值...') +
      '<div class="card"><div class="empty"><b>載入模擬存檔中...</b></div></div>'
    );
  }

  if (!slot || !slots.length) {
    return (
      title(
        '模擬操盤 ＆ AI 操盤手',
        '建立獨立模擬帳戶測試台股、美股或台美混合策略，支援手動下單與 AI 操盤手。'
      ) +
      errNotice +
      '<div class="card pt-empty-card">' +
      '<div class="empty">' +
      '<b>尚未建立任何模擬操盤存檔</b>' +
      '可立即使用下方快速範本建立第一組帳戶，或自訂初始本金、市場幣別與 AI 風控護欄。' +
      '</div>' +
      '<div class="pt-preset-btns">' +
      `<button type="button" class="btn main" data-pt-preset="tw_manual"${state.paperBusy ? ' disabled' : ''}>建立「台股 100 萬手動存檔」</button>` +
      `<button type="button" class="btn" data-pt-preset="mixed_ai"${state.paperBusy ? ' disabled' : ''}>建立「台美混合 100 萬 AI 存檔」</button>` +
      `<button type="button" class="btn ghost" id="ptOpenCreateBtn"${state.paperBusy ? ' disabled' : ''}>+ 自訂存檔</button>` +
      '</div>' +
      '</div>' +
      modalHtml
    );
  }

  const m = slot.metrics || {};
  const cur = slot.currency || 'TWD';
  const fx = state.paperFxUsdTwd || 32.5;
  const positions = Array.isArray(slot.positionsList) ? slot.positionsList : [];
  const pendingOrders = (slot.orders || []).filter(o => String(o.status || '').toUpperCase() === 'PENDING');
  const trades = Array.isArray(slot.trades) ? slot.trades : [];
  const aiLogs = Array.isArray(slot.aiLogs) ? slot.aiLogs : [];
  const pendingProposals = (slot.aiProposals || []).filter(p => String(p.status || '').toUpperCase() === 'PENDING');

  const slotOptions = slots
    .map(
      s =>
        `<option value="${esc(s.id)}" ${s.id === slot.id ? 'selected' : ''}>${esc(s.name)} · ${esc(ptMarketShort(s.market))} · ${
          s.mode === 'ai' ? 'AI' : '手動'
        }</option>`
    )
    .join('');

  const controlBar =
    '<div class="card pt-topbar">' +
    '<div class="pt-topbar-left">' +
    `<select id="ptSlotSelect" class="select pt-slot-select" aria-label="切換模擬存檔">${slotOptions}</select>` +
    '<button type="button" class="btn sm" id="ptOpenCreateBtn">+ 新建存檔</button>' +
    '<button type="button" class="btn sm" id="ptOpenSettingsBtn">⚙ 存檔設定</button>' +
    `<button type="button" class="btn sm" id="ptOpenCompareBtn">比對績效${slots.length > 1 ? ` (${slots.length})` : ''}</button>` +
    `<button type="button" class="btn ghost sm" id="ptRefreshQuotesBtn"${state.paperBusy ? ' disabled' : ''}>${state.paperBusy ? '同步中...' : '↻ 更新報價'}</button>` +
    '</div>' +
    '<div class="pt-topbar-right">' +
    `<button type="button" class="btn ${slot.mode === 'ai' ? '' : 'main'} sm" id="ptOpenOrderBtn">手動下單</button>` +
    (slot.mode === 'ai'
      ? `<button type="button" class="btn main sm" id="ptRunAiBtn"${state.paperAiBusy ? ' disabled' : ''}>` +
        `${state.paperAiBusy ? 'AI 推理分析中...' : '⚡ 執行 AI 決策'}` +
        (pendingProposals.length ? `<span class="pt-badge-cnt">${pendingProposals.length}</span>` : '') +
        '</button>'
      : '') +
    '</div>' +
    '</div>';

  const retVal = typeof m.totalReturnPct === 'number' ? m.totalReturnPct : 0;
  const retCls = ptPnlCls(retVal);
  const pnlVal = typeof m.totalPnl === 'number' ? m.totalPnl : 0;
  const pnlCls = ptPnlCls(pnlVal);
  const winStr = m.closedTradeCount > 0 ? `${fmt(m.winRatePct, 1)}%` : '—';

  const kpiGrid =
    '<div class="metricgrid grid4 pt-kpi-grid">' +
    metric(
      '總資產與報酬率',
      `<span class="pt-kpi-main">${esc(ptFmtMoney(m.totalEquity ?? slot.cash, cur))}</span>` +
        `<span class="pt-kpi-delta ${retCls}">${retVal >= 0 ? '+' : ''}${fmt(retVal, 2)}%</span>`,
      `初始本金 ${esc(ptFmtMoney(slot.initialCapital, cur))}${slot.market === 'MIXED' ? ` · USD/TWD ${fmt(fx, 2)}` : ''}`
    ) +
    metric(
      '總損益',
      esc(ptFmtMoney(pnlVal, cur, true)),
      `未實現 ${esc(ptFmtMoney(m.unrealizedPnl ?? 0, cur, true))} · 已實現 ${esc(ptFmtMoney(m.realizedPnl ?? 0, cur, true))}`,
      pnlCls
    ) +
    metric(
      '可用現金與持股比',
      esc(ptFmtMoney(m.cash ?? slot.cash, cur)),
      `現金 ${fmt(m.cashPct ?? 100, 1)}% · 持股 ${fmt(m.investedPct ?? 0, 1)}%（${positions.length} 檔）`
    ) +
    metric(
      '勝率與最大回撤',
      `<span class="pt-kpi-main">${esc(winStr)}</span>` +
        badge(ptModeLabel(slot), slot.mode === 'ai' ? 'good' : ''),
      `已平倉 ${m.closedTradeCount ?? 0} 筆 · 最大回撤 ${fmt(m.maxDrawdownPct ?? 0, 2)}%`
    ) +
    '</div>';

  const activeTab = state.paperActiveTab || 'positions';
  const tabsDef = [
    ['positions', '持倉清單', positions.length],
    ['orders', '條件掛單', pendingOrders.length],
    ['trades', '成交紀錄', trades.length],
    ['ai_logs', 'AI 決策日誌', aiLogs.length]
  ];
  const tabsBar =
    '<div class="wl-tabs-row pt-tabs-row">' +
    tabsDef
      .map(
        ([k, lbl, cnt]) =>
          `<button type="button" class="wl-tab ${activeTab === k ? 'active' : ''}" data-pt-tab="${k}">` +
          `<span>${esc(lbl)}</span><span class="wl-tab-cnt">${cnt}</span></button>`
      )
      .join('') +
    '</div>';

  let tabContent = '';
  if (activeTab === 'orders') tabContent = renderPaperOrdersTab(slot);
  else if (activeTab === 'trades') tabContent = renderPaperTradesTab(slot);
  else if (activeTab === 'ai_logs') tabContent = renderPaperAiLogsTab(slot);
  else tabContent = renderPaperPositionsTab(slot);

  return (
    title(
      '模擬操盤 ＆ AI 操盤手',
      `${esc(ptMarketLabel(slot.market))} · ${esc(ptModeLabel(slot))}；台美股即時報價模擬撮合與硬性風控護欄。`
    ) +
    errNotice +
    controlBar +
    kpiGrid +
    renderPaperPendingProposals(slot) +
    tabsBar +
    tabContent +
    modalHtml
  );
}
