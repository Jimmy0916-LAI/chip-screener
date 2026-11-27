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
    ? `<p><a id="swCandidateDownload" href="${esc(candidateUrl)}" target="_blank" rel="noopener">開啟 ${esc(appVer)} 封測 ZIP 下載與校驗頁</a>。請用有私庫權限的 GitHub 帳號登入，頁內附 Windows x64 ZIP 與 SHA-256。</p>`
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

  const aiKeyCardHtml = renderAiSettings(sw.ai);

  return (
    title('軟體設定', '管理版本更新、盤中即時股價頻率、AI 供應商與本機加密金鑰。') +
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

const AI_FEATURE_LABELS = { briefing: '每日晨報', channels: '影片策略卡', trader: 'AI 模擬操盤' };

function renderAiSettings(cfg) {
  if (!cfg) return '<div class="card sw-ai-card">正在讀取 AI 設定…</div>';
  return '<form id="swAiSettings" class="card sw-ai-card">' +
    cardhead('AI 供應商與金鑰', '模型及金鑰分開儲存，三個模組使用所選供應商', badge(esc(cfg.storage), '')) +
    `<label>使用供應商 <select id="swAiProvider">${Object.entries(cfg.labels).map(([id, label]) =>
      `<option value="${esc(id)}"${cfg.provider === id ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select></label>` +
    ` <label><input id="swAiEnabled" type="checkbox"${cfg.enabled ? ' checked' : ''}>AI 總開關</label>` +
    '<div class="toolbar">' + Object.entries(AI_FEATURE_LABELS).map(([id, label]) =>
      `<label><input type="checkbox" data-ai-feature="${id}"${cfg.features[id] ? ' checked' : ''}>${label}</label>`).join(' ') +
    '</div><div class="formgrid">' +
    Object.entries(cfg.labels).map(([id, label]) =>
      '<div class="field">' +
      `<label>${esc(label)} 模型 <input data-ai-model="${id}" value="${esc(cfg.models[id])}" required maxlength="100"></label>` +
      `<label>${esc(label)} 金鑰 <input type="password" data-ai-key="${id}" autocomplete="off" maxlength="512" placeholder="${cfg.keys[id] ? '已加密儲存' : '尚未設定'}"></label>` +
      (cfg.keys[id] ? `<label><input type="checkbox" data-ai-clear="${id}">移除此金鑰</label>` : '') +
      '</div>').join('') +
    '</div>' +
    `<p class="mini" id="swAiVideo">${cfg.supportsVideo ? '目前模型支援影片直接解析。' : '目前模型僅處理字幕或文字。沒有字幕時等待來源補上。'}</p>` +
    '<button type="submit" class="btn main" id="swSaveAiSettings">儲存 AI 設定</button>' +
    '</form>';
}

function renderAiStatus(meta) {
  if (!meta) return '';
  return `<span class="mini ai-status" data-ai-status="${esc(meta.status || '')}">${esc(meta.label || '')} ${esc(meta.model || '')} · ${esc(meta.message || '')}</span>`;
}

function renderAiAnalysis(data, labels) {
  if (!data) return '';
  return Object.entries(labels).map(([key, label]) =>
    Array.isArray(data[key]) && data[key].length
      ? `<div class="ch-block"><b>${label}</b><ul class="brief-list">${data[key].map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`
      : ''
  ).join('');
}

document.addEventListener('submit', async event => {
  if (event.target.id !== 'swAiSettings') return;
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const fields = (selector, prop, value) =>
    Object.fromEntries(Array.from(form.querySelectorAll(selector), field => [field.dataset[prop], value(field)]));
  const keys = fields('[data-ai-key]', 'aiKey', field => field.value.trim());
  for (const id of Object.keys(keys)) {
    if (!keys[id]) delete keys[id];
  }
  for (const field of form.querySelectorAll('[data-ai-clear]:checked')) keys[field.dataset.aiClear] = null;
  button.disabled = true;
  try {
    const response = await fetch('/api/software/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: form.querySelector('#swAiProvider').value,
        enabled: form.querySelector('#swAiEnabled').checked,
        models: fields('[data-ai-model]', 'aiModel', field => field.value.trim()),
        features: fields('[data-ai-feature]', 'aiFeature', field => field.checked),
        keys
      })
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error || '無法儲存 AI 設定');
    state.softwareState.ai = result;
    if (state.page === 'software') render();
    toast('AI 設定已儲存');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
