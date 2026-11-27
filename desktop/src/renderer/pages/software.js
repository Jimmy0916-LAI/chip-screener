/**
 * 頁面：軟體設定（極簡版：更新通道／檢查更新 ＋ 盤中即時報價開關與頻率）
 * 所有選項變更後即時自動儲存，本機機密與熱更檔案仍於背景隔離管理。
 */

function softwarePage() {
  const sw = state.softwareState || {};
  const cfg = sw.config || {};
  const ver = sw.version || D.versionInfo || {};
  const rt = sw.runtime || {};
  const chk = state.updateCheckResult || sw.lastCheck || null;
  const mkt = state.liveQuoteStatus || sw.marketStatus || {};
  const twMkt = mkt.TW || {};
  const usMkt = mkt.US || {};

  const appVer = ver.appVersion || '0.6.0-b05.1';
  const isBeta = cfg.channel === 'beta';
  const candidateUrl = ver.candidateDownload || D.versionInfo?.candidateDownload;
  const manualDownload = candidateUrl
    ? `<p><a id="swCandidateDownload" href="${esc(candidateUrl)}" target="_blank" rel="noopener">開啟 ${esc(appVer)} 封測 ZIP 下載與校驗頁</a>。請用有私庫權限的 GitHub 帳號登入，頁內列出內層 ZIP 的 SHA-256 與下載到期時間。</p>`
    : '<p><a href="https://github.com/Jimmy0916-LAI/chip-screener/releases" target="_blank" rel="noopener">開啟 GitHub 下載頁</a></p>';
  const liveEnabled = cfg.liveQuoteEnabled !== false;
  const liveInterval = Number(cfg.liveQuoteIntervalSec || 30);

  const rollbackNotice = rt.rolledBackFrom
    ? '<div class="notice warn">偵測到新版啟動異常，已自動還原至上一可用版本。</div>'
    : '';

  let updateStatusHtml = '';
  if (state.updateBusy) {
    updateStatusHtml = '<div class="mini" style="margin-top:14px">正在檢查最新版本，請稍候...</div>';
  } else if (state.updateError) {
    updateStatusHtml = `<div class="notice warn" style="margin-top:14px;margin-bottom:0">${esc(state.updateError)}</div>`;
  } else if (chk && chk.hasUpdate) {
    const logs = (chk.changelog || []).slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('');
    const actionBtn = chk.requiresShellUpgrade
      ? `<a class="btn warn sm" href="${esc(chk.releaseUrl || 'https://github.com/' + (chk.repo || '') + '/releases')}" target="_blank" rel="noopener noreferrer">↗ 前往下載正式版</a>`
      : `<button type="button" class="btn main sm" id="swApplyUpdateBtn">立即更新並重啟</button>`;
    updateStatusHtml =
      '<div class="sw-check-card" style="margin-top:14px">' +
      `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>發現新版本 ${esc(chk.remoteAppVersion)}</b>${badge(chk.channel === 'beta' ? '測試版' : '正式版', chk.channel === 'beta' ? 'warn' : 'good')}</div>` +
      (logs ? `<ul class="brief-list" style="margin:8px 0 10px">${logs}</ul>` : '') +
      `<div style="margin-top:10px">${actionBtn}</div>` +
      '</div>';
  } else if (chk) {
    updateStatusHtml = `<div style="margin-top:14px">${badge(`目前已是最新版本（${chk.currentAppVersion}）`, 'good')}</div>`;
  }

  const noticeLogs =
    rt.recentReleaseNotice && rt.recentReleaseNotice.version === appVer && Array.isArray(rt.recentReleaseNotice.changelog)
      ? rt.recentReleaseNotice.changelog
      : Array.isArray(ver.changelog)
        ? ver.changelog
        : [];
  const currentNotesHtml =
    !(chk && chk.hasUpdate) && noticeLogs.length
      ? '<div class="sw-check-card" style="margin-top:12px">' +
        `<div class="mini" style="margin-bottom:6px">目前版本更新項目（${esc(appVer)}）</div>` +
        `<ul class="brief-list" style="margin:0">${noticeLogs.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` +
        '</div>'
      : '';

  const twBadge = twMkt.isOpen ? badge('台股盤中', 'good') : badge(twMkt.reason || '台股非盤中', '');
  const usBadge = usMkt.isOpen ? badge('美股盤中', 'good') : badge(usMkt.reason || '美股非盤中', '');

  const hasGeminiKey = Boolean(cfg.hasGeminiKey);
  const geminiHint = cfg.geminiKeyHint || '';
  const storageMode = cfg.secretStorageMode || '本機加密隔離';
  const aiBadgesHtml = hasGeminiKey
    ? `<div class="sw-ai-badges">${badge('已設定 ' + geminiHint, 'good')}${badge(storageMode, '')}</div>`
    : badge('未設定（免 Key 規則模式）', '');

  const clearKeyControlHtml = !hasGeminiKey
    ? ''
    : state.swConfirmClearKey
      ? '<div class="ch-confirm-inline">' +
        '<span class="mini">確認清除已存金鑰？</span>' +
        `<button type="button" class="btn danger sm" id="swConfirmClearGeminiKeyBtn"${state.swKeyBusy ? ' disabled' : ''}>確認清除</button>` +
        '<button type="button" class="btn ghost sm" id="swCancelClearGeminiKeyBtn">取消</button>' +
        '</div>'
      : `<button type="button" class="btn danger sm" id="swClearGeminiKeyBtn"${state.swKeyBusy ? ' disabled' : ''}>清除金鑰</button>`;

  const aiKeyCardHtml =
    '<div class="card sw-ai-card" style="margin-top:18px">' +
    cardhead(
      'AI 模型金鑰（選填）',
      '選填 Gemini API Key；未設定仍可免費使用全站規則模式',
      aiBadgesHtml
    ) +
    '<div class="sw-ai-row">' +
    `<input id="swGeminiKeyInput" class="sw-ai-input" type="password" autocomplete="off" spellcheck="false" placeholder="貼上 Gemini API Key（不儲存明文，未設定仍可免費使用規則模式）"${state.swKeyBusy ? ' disabled' : ''}>` +
    `<button type="button" class="btn main sm" id="swSaveGeminiKeyBtn"${state.swKeyBusy ? ' disabled' : ''}>${state.swKeyBusy ? '儲存中...' : '儲存金鑰'}</button>` +
    clearKeyControlHtml +
    '</div>' +
    '<p class="sw-ai-note">共用於「每日晨報」、「訂閱頻道（含無 CC 字幕音軌／硬字幕多模態解析）」與「模擬操盤 AI」；採用 Windows 使用者本機加密（DPAPI）隔離儲存於 <code>%LOCALAPPDATA%\\ChipScreener\\user-v1\\</code>，絕不寫入專案、不進 Git、亦不回傳明文至前端。</p>' +
    '</div>';

  return (
    title('軟體設定', '管理版本更新、盤中即時股價頻率與本機加密 AI 金鑰；設定變更會自動儲存。') +
    rollbackNotice +
    '<div class="grid2 equal">' +
    '<div class="card">' +
    cardhead('版本與更新', `目前版本 ${appVer}`, badge(isBeta ? '測試版' : '正式版', isBeta ? 'warn' : 'good')) +
    '<div class="field">' +
    '<label for="swChannelSelect">更新通道</label>' +
    '<select id="swChannelSelect" class="select">' +
    `<option value="stable" ${!isBeta ? 'selected' : ''}>正式版（預設，穩定優先）</option>` +
    `<option value="beta" ${isBeta ? 'selected' : ''}>測試版（搶先體驗新功能）</option>` +
    '</select>' +
    '</div>' +
    '<div class="toolbar" style="margin-top:16px;margin-bottom:0">' +
    `<button type="button" class="btn main sm" id="swCheckUpdateBtn"${state.updateBusy ? ' disabled' : ''}>${state.updateBusy ? '檢查中...' : '檢查程式更新'}</button>` +
    '</div>' +
    manualDownload +
    (hasHttpFeed
      ? '<p><button type="button" class="btn ghost sm" id="swStopLocalService">停止本機服務</button> 換版或回退時先停止服務，再雙擊要使用的版本。請保留舊版資料夾。</p>'
      : '') +
    updateStatusHtml +
    currentNotesHtml +
    '</div>' +
    '<div class="card">' +
    cardhead(
      '盤中即時股價',
      '僅更新目前畫面可見標的，休市與切換視窗時自動暫停',
      badge(liveEnabled ? `每 ${liveInterval} 秒` : '已關閉', liveEnabled ? 'good' : '')
    ) +
    '<div class="checkfield" style="margin-bottom:14px">' +
    `<input id="swLiveQuoteToggle" type="checkbox" ${liveEnabled ? 'checked' : ''}>` +
    '<label for="swLiveQuoteToggle">開啟盤中即時股價更新</label>' +
    '</div>' +
    '<div class="field">' +
    '<label for="swLiveQuoteInterval">更新頻率</label>' +
    `<select id="swLiveQuoteInterval" class="select"${liveEnabled ? '' : ' disabled'}>` +
    [
      [15, '每 15 秒'],
      [30, '每 30 秒（預設）'],
      [60, '每 60 秒']
    ]
      .map(([sec, lbl]) => `<option value="${sec}" ${liveInterval === sec ? 'selected' : ''}>${lbl}</option>`)
      .join('') +
    '</select>' +
    '</div>' +
    '<div class="sw-mkt-box" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
    twBadge +
    usBadge +
    '</div>' +
    '</div>' +
    '</div>' +
    aiKeyCardHtml
  );
}
