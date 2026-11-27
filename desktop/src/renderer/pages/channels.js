/**
 * 次分頁：訂閱財經頻道、最新影片時間戳摘要與策略卡 (briefing -> channels)
 * 併入「每日晨報」頂部次分頁，採 2 欄主從檢視與可執行策略卡設計。
 */

function chFormatTime(raw) {
  if (!raw) return '—';
  const s = String(raw).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T\s](\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function chFormatSec(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = n => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function chBuildTimestampUrl(videoUrl, sec) {
  const base = String(videoUrl || '').trim();
  if (!base) return '';
  const t = Math.max(0, Math.floor(Number(sec) || 0));
  if (!t) return base;
  if (/[?&]t=/.test(base)) return base;
  return base + (base.includes('?') ? '&' : '?') + `t=${t}`;
}

function chFormatDuration(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return '';
  const total = Math.floor(n);
  if (total >= 3600) {
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    return `片長 ${h} 小時 ${String(m).padStart(2, '0')} 分`;
  }
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `片長 ${m}:${String(s).padStart(2, '0')}`;
}

function chStatusMeta(ch) {
  const raw = String(ch?.status || '').toLowerCase();
  if (raw === 'waiting_subtitles' || raw === 'waiting') {
    return { label: '等待字幕', tone: 'warn' };
  }
  if (raw === 'skipped_non_finance') {
    return { label: '非財經略過', tone: '' };
  }
  if (raw === 'skipped_too_long') {
    return { label: '超長略過', tone: 'warn' };
  }
  if (raw === 'error' || raw === 'failed') {
    return { label: '檢查失敗', tone: 'bad' };
  }
  if (raw === 'ready' || raw === 'ok' || raw === 'analyzed' || raw === 'done' || (ch?.strategies || []).length > 0) {
    return { label: '已生成', tone: 'good' };
  }
  return { label: '尚未檢查', tone: '' };
}

function chStanceMeta(stance) {
  const s = String(stance || '').trim();
  const low = s.toLowerCase();
  if (low === 'bullish' || s.includes('偏多') || s.includes('看多')) {
    return { label: '偏多', tone: 'good' };
  }
  if (low === 'bearish' || s.includes('偏空') || s.includes('看空')) {
    return { label: '偏空', tone: 'bad' };
  }
  if (low === 'neutral' || s.includes('中性') || s.includes('觀望')) {
    return { label: '中性觀望', tone: 'warn' };
  }
  return { label: s || '中性觀望', tone: 'warn' };
}

function chSourceModeMeta(mode) {
  const m = String(mode || '').trim();
  const low = m.toLowerCase();
  if (low === 'cc_ai' || low === 'cc_gemini' || low === 'subtitle_ai' || m === '字幕+AI') {
    return { label: '字幕+AI', tone: 'good' };
  }
  if (low === 'multimodal_gemini' || low === 'gemini_multimodal' || low === 'video_ai' || low === 'gemini_video' || m === '影片多模態AI') {
    return { label: '影片多模態AI', tone: 'good' };
  }
  if (low === 'cc_rule' || low === 'subtitle_rule' || low === 'rule' || m === '字幕規則') {
    return { label: '字幕規則', tone: '' };
  }
  return { label: m || '字幕規則', tone: '' };
}

function getSelectedChannel() {
  const list = state.channelsList || [];
  if (!list.length) return null;
  const found = list.find(c => c.id === state.channelsSelectedId);
  return found || list[0];
}

function renderChannelTickerItem(t) {
  const code = String(t.code || '').trim().toUpperCase();
  if (!code) return '';
  const market = String(t.market || '').toUpperCase() || (/^(?:\d{4}|00\d{2,4}[A-Z]?)$/.test(code) ? 'TW' : 'US');
  const isUs = market === 'US' || (typeof isUsSymbol === 'function' && isUsSymbol(code, market));
  const live = state.liveQuotesByCode?.[code];
  const price = typeof live?.price === 'number' ? live.price : typeof t.price === 'number' ? t.price : null;
  const change = typeof live?.change === 'number' ? live.change : typeof t.change === 'number' ? t.change : null;
  const changePct = typeof live?.changePct === 'number' ? live.changePct : typeof t.changePct === 'number' ? t.changePct : null;
  const hasPrice = typeof price === 'number' && isFinite(price);
  const dp = isUs ? 2 : hasPrice && price < 150 ? 2 : 1;
  const dirCls = !hasPrice || change === null ? '' : change > 0 ? 'tw-up' : change < 0 ? 'tw-down' : 'wl-pnl-flat';
  const arrow = !hasPrice || change === null ? '' : change > 0 ? '▲' : change < 0 ? '▼' : '';
  const inFav = typeof isStockInAnyFolder === 'function' && isStockInAnyFolder(code);
  const displayName = t.name || D.stocks?.[code]?.[0] || '';

  return (
    '<div class="ch-ticker-row">' +
    `<button type="button" class="ch-ticker-link" data-ch-open-ticker="${esc(code)}" data-ch-ticker-market="${esc(isUs ? 'US' : 'TW')}" title="前往個股詳情">` +
    `<span class="ch-ticker-code">${esc(code)}</span>` +
    (displayName ? `<span class="ch-ticker-name">${esc(displayName)}</span>` : '') +
    `<span class="tag ch-mkt-tag">${isUs ? 'US' : 'TW'}</span>` +
    '</button>' +
    '<div class="ch-ticker-quote">' +
    `<span class="ch-ticker-price" data-live-tbl-price="${esc(code)}"${isUs ? ' data-live-currency="USD"' : ''}>${
      hasPrice ? (isUs ? `<b>$${fmt(price, 2)}</b>` : fmt(price, dp)) : '—'
    }</span>` +
    `<span class="ch-ticker-chg ${dirCls}" data-live-tbl-chg="${esc(code)}" data-live-pct-only="1">${
      hasPrice && changePct !== null ? `${arrow} ${pp(changePct, 2)}%` : '—'
    }</span>` +
    '</div>' +
    (t.note ? `<div class="ch-ticker-note" title="${esc(t.note)}">${esc(t.note)}</div>` : '') +
    `<button type="button" class="btn sm ch-fav-btn ${inFav ? 'is-fav' : ''}" data-ch-fav="${esc(code)}" title="${inFav ? '已收藏於自選清單' : '加入第一個自選收藏夾'}">${inFav ? '★ 已收藏' : '+收藏'}</button>` +
    '</div>'
  );
}

function renderStrategyCard(ch, s) {
  const stance = chStanceMeta(s.stance);
  const srcMode = chSourceModeMeta(s.sourceMode);
  const delKey = `${ch.id}::${s.id}`;
  const isConfirmDel = state.channelsConfirmDeleteStrategy === delKey;

  const bullets = Array.isArray(s.summaryBullets) ? s.summaryBullets : [];
  const bulletsHtml = bullets.length
    ? '<div class="ch-block">' +
      '<div class="ch-block-label">時間戳重點摘要</div>' +
      '<ul class="ch-bullets">' +
      bullets
        .map(b => {
          const timeLabel = b.timeLabel || chFormatSec(b.timeSec);
          const url = b.url || chBuildTimestampUrl(s.videoUrl, b.timeSec);
          const tsTag = url
            ? `<a class="ch-ts-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">[${esc(timeLabel)}]</a>`
            : `<span class="ch-ts-link">[${esc(timeLabel)}]</span>`;
          return `<li class="ch-bullet-item">${tsTag}<span class="ch-bullet-text">${esc(b.text || '')}</span></li>`;
        })
        .join('') +
      '</ul>' +
      '</div>'
    : '';

  const tickers = Array.isArray(s.tickers) ? s.tickers : [];
  const tickersHtml = tickers.length
    ? '<div class="ch-block">' +
      '<div class="ch-block-label">提及標的（點擊看個股詳情，可一鍵加入收藏夾）</div>' +
      `<div class="ch-tickers-list">${tickers.map(renderChannelTickerItem).join('')}</div>` +
      '</div>'
    : '';

  const entries = Array.isArray(s.entryConditions) ? s.entryConditions.filter(Boolean) : [];
  const risks = Array.isArray(s.riskControls) ? s.riskControls.filter(Boolean) : [];
  const condHtml =
    entries.length || risks.length
      ? '<div class="ch-cond-grid">' +
        '<div class="ch-cond-box">' +
        '<div class="ch-block-label">進場／觀察條件</div>' +
        (entries.length
          ? `<ul class="ch-cond-list">${entries.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
          : '<div class="mini">影片未明確提及進場條件</div>') +
        '</div>' +
        '<div class="ch-cond-box">' +
        '<div class="ch-block-label">風險控管／失效條件</div>' +
        (risks.length
          ? `<ul class="ch-cond-list">${risks.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`
          : '<div class="mini">影片未明確提及停損或風控條件</div>') +
        '</div>' +
        '</div>'
      : '';

  const preset = s.screenerPreset;
  const presetHtml = preset
    ? '<div class="ch-preset-bar">' +
      '<div class="ch-preset-info">' +
      `<span class="ch-preset-title">建議籌碼篩選方案：<b>${esc(preset.name || '頻道策略方案')}</b></span>` +
      `<span class="mini">${esc(String(preset.band || '400'))} 張以上 · 連 ${esc(String(preset.weeks || 2))} 週 · 累計 +${fmt(Number(preset.minPp ?? 0.2), 2)} pp · 單週 ≥ ${fmt(Number(preset.weeklyMin ?? 0), 2)} pp${preset.needShares ? ' · 股數同增' : ''}</span>` +
      '</div>' +
      `<button type="button" class="btn main sm" data-ch-apply-preset="1" data-ch-id="${esc(ch.id)}" data-strat-id="${esc(s.id)}">一鍵存為篩選預設並套用</button>` +
      '</div>'
    : '';

  const deleteControl = isConfirmDel
    ? '<div class="ch-confirm-inline">' +
      '<span class="mini">確認刪除？</span>' +
      `<button type="button" class="btn danger sm" data-ch-del-strat-confirm="1" data-ch-id="${esc(ch.id)}" data-strat-id="${esc(s.id)}">確認</button>` +
      '<button type="button" class="btn ghost sm" data-ch-del-strat-cancel="1">取消</button>' +
      '</div>'
    : `<button type="button" class="btn ghost sm ch-del-btn" data-ch-del-strat-ask="${esc(delKey)}" title="刪除此筆策略卡">刪除</button>`;

  return (
    '<article class="card ch-strat-card">' +
    '<div class="ch-strat-head">' +
    '<div class="ch-strat-title-wrap">' +
    (s.videoUrl
      ? `<a class="ch-strat-title" href="${esc(s.videoUrl)}" target="_blank" rel="noopener noreferrer">${esc(s.videoTitle || '最新影片策略')} ↗</a>`
      : `<div class="ch-strat-title">${esc(s.videoTitle || '最新影片策略')}</div>`) +
    `<div class="mini">發布 ${esc(chFormatTime(s.publishedAt))} · 分析 ${esc(chFormatTime(s.analyzedAt))}</div>` +
    '</div>' +
    '<div class="ch-strat-badges">' +
    badge(stance.label, stance.tone) +
    badge(srcMode.label, srcMode.tone) +
    deleteControl +
    '</div>' +
    '</div>' +
    (s.coreThesis ? `<div class="ch-thesis"><b>核心觀點：</b>${esc(s.coreThesis)}</div>` : '') +
    bulletsHtml +
    tickersHtml +
    condHtml +
    presetHtml +
    '</article>'
  );
}

function channelsSubPage() {
  if (!hasHttpFeed) {
    return (
      title(
        '訂閱財經頻道',
        '追蹤自訂 YouTube 財經頻道最新一集影片，萃取時間戳重點與可執行策略卡。',
        badge('需本機服務', 'warn')
      ) +
      '<div class="card"><div class="empty"><b>目前為純離線檔案模式</b>訂閱頻道與影片解析需要透過本機服務執行，請使用 <b>ChipScreener.exe</b> 或執行 <code>launcher.py</code> 開啟。</div></div>'
    );
  }

  const cfg = state.channelsConfig || {};
  const list = state.channelsList || [];
  const selected = getSelectedChannel();
  const autoDaily = Boolean(cfg.autoDailyEnabled);
  const hasGemini = Boolean(
    cfg.hasGeminiKey || state.softwareState?.config?.hasGeminiKey || state.briefingConfig?.hasGeminiKey
  );
  const geminiHint =
    cfg.geminiKeyHint || state.softwareState?.config?.geminiKeyHint || state.briefingConfig?.geminiKeyHint || '';
  const cooldownMin = Number(cfg.cooldownMinutes || 15);
  const maxMin = Number(cfg.maxVideoMinutes || 60);
  const maxMinChoices = [30, 60, 90, 120];
  if (Number.isFinite(maxMin) && maxMin > 0 && !maxMinChoices.includes(maxMin)) {
    maxMinChoices.push(maxMin);
    maxMinChoices.sort((a, b) => a - b);
  }
  const maxMinSelectHtml =
    '<label class="ch-max-min-field" title="超過此長度的影片將自動略過解析以節省時間與額度">' +
    '<span class="mini">影片長度上限</span>' +
    '<select id="chMaxMinutesSelect" class="select ch-max-min-select">' +
    maxMinChoices
      .map(
        m =>
          `<option value="${m}" ${m === maxMin ? 'selected' : ''}>${m} 分鐘${m === 60 ? '（預設）' : ''}</option>`
      )
      .join('') +
    '</select>' +
    '</label>';

  const headerControls =
    '<div class="brief-controls">' +
    '<label class="switch-wrap" title="勾選後將於每日 10:00 晨報排程同步檢查訂閱頻道最新影片">' +
    `<input type="checkbox" id="chAutoDailyToggle" ${autoDaily ? 'checked' : ''}>` +
    '<span class="switch-track"><span class="switch-thumb"></span></span>' +
    '<span class="switch-label">併入每日 10:00 自動檢查</span>' +
    '</label>' +
    `<button type="button" class="btn main" id="chCheckAllBtn"${state.channelsChecking ? ' disabled' : ''}>${state.channelsChecking && !state.channelsCheckingId ? '檢查中...' : '↻ 檢查新片'}</button>` +
    '</div>';

  const aiModeHtml = hasGemini
    ? `<div class="ch-ai-bar"><div class="ch-ai-left">${badge('Gemini AI 已啟用' + (geminiHint ? ' · ' + geminiHint : ''), 'good')}<span class="mini">支援字幕 AI 萃取與無字幕影片音軌／硬字幕多模態解析 · 自動檢查冷卻 ${cooldownMin} 分鐘</span><button type="button" class="btn ghost sm" data-go-software-ai="1">管理金鑰</button></div>${maxMinSelectHtml}</div>`
    : '<div class="ch-ai-bar">' +
      '<div class="ch-ai-left">' +
      badge('規則模式', '') +
      '<span class="mini">規則模式（可於軟體設定填寫 Gemini Key 啟用音軌／硬字幕解析）</span>' +
      '<button type="button" class="btn ghost sm" data-go-software-ai="1">前往軟體設定管理 Key →</button>' +
      '</div>' +
      maxMinSelectHtml +
      '</div>';

  const toolbarCard =
    '<div class="card ch-toolbar-card">' +
    '<div class="ch-add-row">' +
    `<input id="chAddUrlInput" class="ch-add-input" value="${esc(state.channelsAddInput || '')}" placeholder="貼上 YouTube 頻道網址、@handle 或影片連結" autocomplete="off"${state.channelsAdding ? ' disabled' : ''}>` +
    `<button type="button" class="btn main" id="chAddBtn"${state.channelsAdding ? ' disabled' : ''}>${state.channelsAdding ? '訂閱解析中...' : '+ 新增訂閱'}</button>` +
    '</div>' +
    aiModeHtml +
    '</div>';

  const errNotice = state.channelsError
    ? `<div class="notice warn" style="margin-bottom:16px">${esc(state.channelsError)}</div>`
    : '';

  const sidebarItems = list.length
    ? list
        .map(ch => {
          const isSelected = selected && selected.id === ch.id;
          const st = chStatusMeta(ch);
          const stratCount = (ch.strategies || []).length;
          const isConfirmRemove = state.channelsConfirmRemoveId === ch.id;
          const dateLabel = ch.lastVideoPublishedAt
            ? chFormatTime(ch.lastVideoPublishedAt).slice(0, 10)
            : ch.lastCheckedAt
              ? chFormatTime(ch.lastCheckedAt).slice(0, 10)
              : '尚未檢查';

          return (
            `<div class="ch-item ${isSelected ? 'active' : ''}" data-ch-select="${esc(ch.id)}" role="button" tabindex="0">` +
            '<div class="ch-item-top">' +
            '<div class="ch-item-title-wrap">' +
            `<div class="ch-item-name">${esc(ch.name || ch.handle || ch.id)}</div>` +
            (ch.handle ? `<div class="ch-item-handle">${esc(ch.handle)}</div>` : '') +
            '</div>' +
            `<button type="button" class="ch-remove-btn" data-ch-remove-ask="${esc(ch.id)}" title="移除此頻道訂閱" aria-label="移除頻道">✕</button>` +
            '</div>' +
            '<div class="ch-item-meta">' +
            badge(st.label, st.tone) +
            `<span class="ch-item-count">${stratCount}/3</span>` +
            `<span class="ch-item-date">${esc(dateLabel)}</span>` +
            '</div>' +
            (isConfirmRemove
              ? '<div class="ch-confirm-row">' +
                '<span class="mini">移除此頻道與策略？</span>' +
                '<div class="ch-confirm-btns">' +
                `<button type="button" class="btn danger sm" data-ch-remove-confirm="${esc(ch.id)}">確認</button>` +
                '<button type="button" class="btn ghost sm" data-ch-remove-cancel="1">取消</button>' +
                '</div></div>'
              : '') +
            '</div>'
          );
        })
        .join('')
    : '<div class="empty ch-sidebar-empty"><b>尚未訂閱任何頻道</b>在上方貼上 YouTube 頻道網址、<code>@handle</code> 或任一影片連結即可新增。</div>';

  const sidebarHtml =
    '<aside class="card ch-sidebar">' +
    `<div class="ch-sidebar-head"><h3>已訂閱頻道</h3><span class="tag">${list.length}</span></div>` +
    `<div class="ch-list">${sidebarItems}</div>` +
    '</aside>';

  let detailHtml = '';
  if (!selected) {
    detailHtml =
      '<section class="ch-detail">' +
      '<div class="card"><div class="empty">' +
      '<b>開始追蹤財經 YouTube 頻道</b>' +
      '新增頻道後只會分析最新 1 集影片（不回溯舊片），每頻道最多保存最新 3 筆結構化策略卡，支援時間戳跳轉、提及台美股即時報價與一鍵套用篩選方案。' +
      '</div></div>' +
      '</section>';
  } else {
    const chStatus = chStatusMeta(selected);
    const strategies = Array.isArray(selected.strategies) ? selected.strategies : [];
    const checkingThis = state.channelsChecking && state.channelsCheckingId === selected.id;

    let latestNotice = '';
    if (selected.status === 'waiting_subtitles') {
      latestNotice =
        '<div class="notice warn" style="margin:12px 0 0">' +
        `<b>等待字幕中：</b>${esc(selected.statusMessage || '此最新影片尚未取得可用 CC 字幕；系統不以純標題捏造策略，將於下次檢查時自動重試。')}` +
        (!hasGemini ? ' 若影片含口說或硬字幕，可至「軟體設定」填寫 Gemini API Key 啟用多模態解析。' : '') +
        '</div>';
    } else if (selected.status === 'skipped_non_finance') {
      latestNotice =
        '<div class="notice" style="margin:12px 0 0">' +
        `<b>非財經主題已略過：</b>${esc(selected.statusMessage || '此最新影片非財經／股市投資主題，已自動略過解析且不計入策略卡。')}` +
        '</div>';
    } else if (selected.status === 'skipped_too_long') {
      latestNotice =
        '<div class="notice warn" style="margin:12px 0 0">' +
        `<b>超過片長上限已略過：</b>${esc(selected.statusMessage || `此最新影片超過長度上限 ${maxMin} 分鐘，已自動略過解析；若需解析可調高「影片長度上限」後點擊「↻ 檢查此頻道」。`)}` +
        '</div>';
    } else if (selected.status === 'error') {
      latestNotice =
        '<div class="notice warn" style="margin:12px 0 0">' +
        `<b>最新檢查異常：</b>${esc(selected.statusMessage || '暫時無法讀取頻道或解析影片，請稍後重試。')}` +
        '</div>';
    }

    const durationText = chFormatDuration(selected.lastVideoDurationSec);
    const latestVideoCard =
      '<div class="card ch-latest-card">' +
      '<div class="splithead">' +
      '<div>' +
      '<h3>最新影片狀態</h3>' +
      `<div class="mini">最後檢查：${esc(chFormatTime(selected.lastCheckedAt))}</div>` +
      '</div>' +
      badge(chStatus.label, chStatus.tone) +
      '</div>' +
      (selected.lastVideoTitle || selected.lastVideoUrl
        ? '<div class="ch-latest-body">' +
          (selected.lastVideoUrl
            ? `<a class="ch-latest-title" href="${esc(selected.lastVideoUrl)}" target="_blank" rel="noopener noreferrer">${esc(selected.lastVideoTitle || selected.lastVideoId || '最新影片')} ↗</a>`
            : `<div class="ch-latest-title">${esc(selected.lastVideoTitle || selected.lastVideoId)}</div>`) +
          '<div class="ch-latest-meta">' +
          `<span class="mini">影片發布：${esc(chFormatTime(selected.lastVideoPublishedAt))}</span>` +
          (durationText ? `<span class="mini ch-duration-pill">${esc(durationText)}</span>` : '') +
          '</div>' +
          '</div>'
        : '<div class="mini" style="margin-top:10px">尚未取得最新影片紀錄，請點擊右上方「↻ 檢查此頻道」。</div>') +
      latestNotice +
      '</div>';

    const stratListHtml = strategies.length
      ? `<div class="ch-strat-list">${strategies.map(s => renderStrategyCard(selected, s)).join('')}</div>`
      : '<div class="card"><div class="empty"><b>尚無已生成的策略卡</b>若最新影片仍在等待字幕，待字幕就緒後點擊「↻ 檢查此頻道」即可生成。</div></div>';

    detailHtml =
      '<section class="ch-detail">' +
      '<div class="card ch-detail-head">' +
      '<div class="ch-detail-title-group">' +
      `<h2>${esc(selected.name || selected.handle || selected.id)}</h2>` +
      '<div class="ch-detail-sub">' +
      (selected.handle ? `<span class="mini">${esc(selected.handle)}</span>` : '') +
      (selected.url
        ? `<a class="ch-ext-link" href="${esc(selected.url)}" target="_blank" rel="noopener noreferrer">前往 YouTube 頻道 ↗</a>`
        : '') +
      `<span class="mini">訂閱於 ${esc(chFormatTime(selected.addedAt))}</span>` +
      '</div>' +
      '</div>' +
      `<button type="button" class="btn sm" data-ch-check-one="${esc(selected.id)}"${state.channelsChecking ? ' disabled' : ''}>${checkingThis ? '檢查中...' : '↻ 檢查此頻道'}</button>` +
      '</div>' +
      latestVideoCard +
      '<div class="section ch-strat-sec">' +
      `<h2>影片策略卡</h2>` +
      `<div class="section-actions"><span class="mini">最多保存最新 3 筆策略</span>${badge(`${strategies.length} / 3`, strategies.length ? 'good' : '')}</div>` +
      '</div>' +
      stratListHtml +
      '</section>';
  }

  return (
    title(
      '訂閱財經頻道',
      '僅分析最新 1 集影片（不回溯舊片），萃取時間戳重點、台美股提及標的與可套用籌碼篩選方案。',
      headerControls
    ) +
    toolbarCard +
    errNotice +
    `<div class="ch-layout">${sidebarHtml}${detailHtml}</div>`
  );
}
