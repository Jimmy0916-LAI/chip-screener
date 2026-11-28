/**
 * 官方集保週更新面板與狀態同步
 * 嚴格分離「內建凍結」、「官方下載」與「手動匯入」三種來源證據。
 * 支援 Electron (window.officialFeed) 與本機 Python 伺服器 (/api/official/*) 兩種執行環境。
 */

const frozenLast = Object.keys(frozenWeeks).sort().at(-1);

const officialWeeks = {};
const officialMonths = {};
let feedBusy = false;
let feedStatus = '需要連線取得最新市場資料';
let feedMessage = '';
let checkedAt = '';

const hasHttpFeed =
  typeof location !== 'undefined' &&
  /^https?:$/.test(location.protocol) &&
  ['127.0.0.1', 'localhost'].includes(location.hostname);

const hasOfficialFeedBackend =
  (typeof window !== 'undefined' && !!window.officialFeed) || hasHttpFeed;

function receiveOfficial(packet) {
  Object.assign(exchangeMarket, packet.market || {});
  for (const venue of ['TWSE','TPEx']) {
    for (const [code,name] of Object.entries(exchangeMarket[venue+'-list']?.rows || {}))
      D.stocks[code] = [name,venue];
  }
  for (const [day, week] of Object.entries(packet.weeks || {})) {
    officialWeeks[day] = week;
    applyWeek(day, week);
    D.issues[day] = week.issues;
    D.adjustments[day] = week.adjustments;
  }
  Object.assign(officialMonths, packet.months);
  if (Object.keys(packet.months || {}).length) {
    D.sessions = [...new Set([...D.sessions, ...Object.values(officialMonths).flatMap(m => m.days)])].sort();
    rebuildWeeks();
  }
}

function latestVerifiedDay() {
  return dates().filter(d => !Object.hasOwn(savedWeeks,d) || Object.hasOwn(officialWeeks,d) || Object.hasOwn(frozenWeeks,d))
    .sort()
    .at(-1);
}

function feedPanel() {
  const day = latestVerifiedDay();
  const last = officialWeeks[day]?.quality || frozenWeeks[day];
  const gaps = weekEnds.filter(d => d > frozenLast && d < day && !D.observed[d]);
  const quoteDates = ['TWSE','TPEx'].map(v => v+' '+(exchangeMarket[v+'-day']?.day || '尚未下載')).join('／');
  const text = (feedBusy ? '檢查中' : feedStatus) + (feedMessage ? '｜' + feedMessage : '');

  let details = '';
  if (state.page === 'data') {
    const records = Object.entries(officialWeeks).sort((a, b) => b[0].localeCompare(a[0]));
    const items = [];
    for (const [d, w] of records) {
      items.push(
        `<p>${esc(`${d}｜TDCC 1-5｜${w.quality.valid} 檔有效，${w.quality.invalid} 檔待核｜${w.quality.validation}`)}<br>` +
        `${esc(`來源 ${w.quality.raw_source}｜SHA-256 ${w.quality.sha256}`)}<br>` +
        `${esc(`取得／已證實可用 ${w.observed}｜官方首次公布時間待證`)}</p>`
      );
    }
    for (const [d, w] of Object.entries(savedWeeks).sort()) {
      items.push(`<p>${esc(`${d}｜${w.quality.raw_source}｜手動快照，公布時點待證`)}</p>`);
    }
    for (const [d, w] of Object.entries(D.tdccChartHistory || {}).sort().reverse()) {
      items.push(`<p>${esc(`${d}｜TDCC 1-5 歷史封存｜${Object.keys(w.rows).length} 檔｜公布時點待證，僅供個股圖表`)}<br><a href="${esc(w.source)}" target="_blank" rel="noopener">原始 CSV 封存</a> · <a href="${esc(w.license)}" target="_blank" rel="noopener">政府資料開放授權條款第 1 版</a><br>${esc(`取得 ${w.retrieved}｜SHA-256 ${w.sha256}`)}</p>`);
    }
    for (const [d, q] of Object.entries(frozenWeeks).sort().reverse()) {
      items.push(`<p>${esc(d)}｜隨包可追溯集保｜${esc(q.valid)} 檔通過｜最早已知可用 ${esc(D.observed[d])}<br>${esc(q.sha256 || q.raw_source)}${q.evidence ? ` · <a href="${esc(q.evidence)}" target="_blank" rel="noopener">官方取得及日曆驗收紀錄</a>` : ''}</p>`);
    }
    for (const [key, data] of Object.entries(exchangeMarket)) {
      items.push(`<p>${esc(key)}｜資料日 ${esc(data.day)}｜${Object.keys(data.rows || {}).length} 筆｜取得 ${esc(data.fetched)}｜${esc(data.source)}</p>`);
    }
    items.push(`<p>交易日曆截至 ${esc(D.sessions.at(-1))}（證交所實際成交日期）。</p>`);
    if (gaps.length) {
      items.push(
        `<p>官方整批檔未取得的統計週：${esc(gaps.join('、'))}。個股歷史可由集保查詢，待證期保留缺口。</p>`
      );
    }
    details = `<div class="feed-details">${items.join('')}</div>`;
  }

  return (
    '<div class="card" id="feedPanel">' +
    '<div class="feed-bar">' +
    '<div class="feed-meta">' +
    '<span class="feed-title">集保週資料</span>' +
    `<span id="feedStatus">${esc(text)}</span>` +
    '<span class="feed-sep">|</span>' +
    `<span>最新已驗證統計日 <b id="feedDay">${esc(day || '—')}</b></span>` +
    `<span>目前篩選週 <b>${esc(state.win || '無可評估窗口')}</b></span>` +
    `<span class="mini">行情交易日 ${esc(quoteDates)} · 上次集保成功 ${esc(last?.fetched || '尚未下載')} · 最近檢查 ${esc(checkedAt || '—')}</span>` +
    '</div>' +
    `<button id="refreshTDCC" class="btn sm"${feedBusy ? ' disabled' : ''}>更新市場資料</button>` +
    '</div>' +
    details +
    '</div>'
  );
}

function paintFeed() {
  const panel = document.querySelector('#feedPanel');
  if (panel && ['home', 'data'].includes(state.page)) {
    panel.outerHTML = feedPanel();
  }
}

async function requestOfficialUpdate() {
  if (typeof window !== 'undefined' && window.officialFeed) {
    return window.officialFeed.update();
  }
  if (hasHttpFeed) {
    const resp = await fetch('/api/official/update', { method: 'POST', cache: 'no-store' });
    if (!resp.ok) throw Error('本機更新服務回應 HTTP ' + resp.status);
    return resp.json();
  }
  throw Error('純離線檔案無法直接連線官方來源，請使用桌面版、啟動 py scripts/serve_local.py，或至「資料與驗收」手動匯入 CSV');
}

async function refreshTDCC() {
  if (feedBusy) return;
  feedBusy = true;
  paintFeed();
  let changed = false;
  try {
    const packet = await requestOfficialUpdate();
    receiveOfficial(packet);
    changed = Object.keys(packet.weeks || {}).length + Object.keys(packet.months || {}).length + Object.keys(packet.market || {}).length > 0;
    if (changed && !state.manualWeek) useDefaultWeek();
    feedStatus = packet.status;
    feedMessage = packet.message;
    checkedAt = packet.checked;
  } catch (e) {
    feedStatus = '無法更新';
    feedMessage = e.message;
    toast(e.message);
  } finally {
    feedBusy = false;
    if (changed && ['home', 'data', 'stock', 'backtest', 'screen'].includes(state.page)) {
      render();
    } else {
      paintFeed();
    }
  }
}

if (typeof window !== 'undefined' && window.officialFeed) {
  const cached = window.officialFeed.read();
  receiveOfficial(cached);
  feedMessage = cached.notes.join('；');
} else if (hasHttpFeed) {
  fetch('/api/official/read', { cache: 'no-store' })
    .then(r => (r.ok ? r.json() : null))
    .then(cached => {
      if (!cached) return;
      const hadUpdates = Object.keys(cached.weeks || {}).length + Object.keys(cached.months || {}).length > 0;
      receiveOfficial(cached);
      if (cached.notes?.length) feedMessage = cached.notes.join('；');
      if (hadUpdates && !state.manualWeek) useDefaultWeek();
      if (Object.keys(cached.weeks || {}).length) feedStatus = '已載入本工作階段驗證資料';
      setTimeout(refreshTDCC,1500);
      if (hadUpdates) render();
      else paintFeed();
    })
    .catch(() => {});
}
