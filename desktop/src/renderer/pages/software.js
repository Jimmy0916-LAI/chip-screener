/**
 * 頁面：軟體設定（極簡版：更新通道／檢查更新 ＋ 盤中即時報價開關與頻率）
 * 所有選項變更後即時自動儲存，本機機密與熱更檔案仍於背景隔離管理。
 */

function updateCheckDescription(check) {
  if (!check) return '尚未檢查指定版本';
  const channel = check.channel === 'beta' ? 'Beta' : 'Stable';
  const version = check.remoteAppVersion || '';
  switch (check.status) {
    case 'unconfigured':
      return '已連線 GitHub。官方首頁尚未設定自動更新通道，請使用官方發行頁手動下載。';
    case 'unavailable':
      return `${channel} 尚未發布指定版本。可繼續使用目前版本。`;
    case 'manual':
      return `${channel} 指定 ${version}，請由官方發行頁手動下載。`;
    case 'incompatible':
      return `${channel} 指定 ${version}，目前安裝或資料格式不支援自動切換。`;
    case 'downgrade':
      return `${channel} 指定較早版本 ${version}，需確認後才能降版。`;
    case 'update':
      return `${channel} 指定可安裝版本 ${version}。`;
    default:
      return `目前已是 ${channel} 指定版本 ${version}。`;
  }
}

function softwarePage() {
  const sw = state.softwareState || {};
  const cfg = sw.config || {};
  const ver = sw.version || D.versionInfo || {};
  const installer = sw.appUpdate || {};
  const chk = state.updateCheckResult || sw.lastCheck || null;
  const mkt = state.liveQuoteStatus || sw.marketStatus || {};
  const twMkt = mkt.TW || {};
  const usMkt = mkt.US || {};

  const appVer = ver.appVersion || '0.6.0-b05.1';
  const isBeta = cfg.channel === 'beta';
  const candidateUrl = ver.candidateDownload || D.versionInfo?.candidateDownload;
  const manualDownload = candidateUrl
    ? `<p><a id="swCandidateDownload" href="${esc(candidateUrl)}" target="_blank" rel="noopener">開啟 ${esc(appVer)} 封測 ZIP 下載與校驗頁</a>。頁內附 Windows x64 ZIP 與 SHA-256。</p>`
    : '<p><a href="https://github.com/Jimmy0916-LAI/chip-screener/releases" target="_blank" rel="noopener">開啟 GitHub 下載頁</a></p>';
  const liveEnabled = cfg.liveQuoteEnabled !== false;
  const liveInterval = Number(cfg.liveQuoteIntervalSec || 30);

  const result = installer.lastResult;
  const updateResult = result
    ? `<div class="notice ${result.success ? '' : 'warn'}">${esc(result.message || '')}${result.rolledBack ? '，已回到上一可用版本。' : ''}</div>`
    : '';
  const installStatus = installer.installed
    ? `<p class="mini">固定啟動入口已安裝。<br>${esc(installer.entry || '')}</p>`
    : installer.canInstall
      ? '<p>安裝一次固定入口，之後透過桌面捷徑啟動及更新。</p><button class="btn sm" type="button" id="swInstallEntryBtn">安裝固定入口</button>'
      : '';
  const rollback = installer.previousVersion
    ? `<button class="btn warn sm" type="button" id="swRollbackUpdateBtn">回到 ${esc(installer.previousVersion)}</button>`
    : '';
  const changeLogs = (chk?.changelog || []).slice(0, 4)
    .map(line => `<li>${esc(line)}</li>`).join('');
  const updateStatusHtml = state.updateBusy
    ? '<p class="mini">正在核對官方通道指定的版本…</p>'
    : state.updateError
      ? `<p class="notice warn">${esc(state.updateError)}</p>`
      : `<p>${esc(updateCheckDescription(chk))}</p>` +
        (chk?.checkedAt ? `<p class="mini">最後檢查 ${esc(new Date(chk.checkedAt).toLocaleString())}${chk.size ? ` · ${fmt(chk.size / 1048576, 1)} MiB` : ''}</p>` : '') +
        (changeLogs ? `<ul class="brief-list">${changeLogs}</ul>` : '') +
        (chk?.releaseUrl ? `<a class="btn ghost sm" href="${esc(chk.releaseUrl)}" target="_blank" rel="noopener noreferrer">開啟官方發行頁</a>` : '') +
        (chk?.hasUpdate && installer.installed
          ? `<button class="btn main sm" type="button" id="swApplyUpdateBtn">${chk.isDowngrade ? '確認降版' : '安裝指定版本'}</button>` : '');
  const noticeLogs = Array.isArray(ver.changelog) ? ver.changelog : [];
  const currentNotesHtml = noticeLogs.length
    ? '<div class="sw-check-card"><div class="mini">目前版本更新項目</div><ul class="brief-list">' +
      noticeLogs.slice(0, 6).map(line => `<li>${esc(line)}</li>`).join('') + '</ul></div>'
    : '';

  const twBadge = twMkt.isOpen ? badge('台股盤中', 'good') : badge(twMkt.reason || '台股非盤中', '');
  const usBadge = usMkt.isOpen ? badge('美股盤中', 'good') : badge(usMkt.reason || '美股非盤中', '');

  const aiKeyCardHtml = renderAiSettings(sw.ai);

  return (
    title('軟體設定', '管理版本更新、盤中即時股價頻率、AI 供應商與本機加密金鑰。') +
    updateResult +
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
    installStatus +
    rollback +
    manualDownload +
    (hasHttpFeed
      ? '<p><button type="button" class="btn ghost sm" id="swStopLocalService">停止本機服務</button> 手動換版前請先停止服務。</p>'
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
