const exchangeMarket = {};
const pendingHistory = new Map();
const downloadedHistory = new Set();

function stockBars(code) {
  const rows = new Map();
  for (const bar of D.dailyByCode?.[code] || []) rows.set(bar[0],bar.slice(0,5));
  for (const bar of state.stockDetailByCode?.[code]?.bars || []) rows.set(bar[0],bar.slice(0,5));
  for (const key of ['TWSE-day','TPEx-day']) {
    const bar = exchangeMarket[key]?.rows[code];
    if (bar) rows.set(bar[0],bar);
  }
  return [...rows.values()].sort((a,b)=>a[0].localeCompare(b[0]));
}

async function loadOverlayHistory(code) {
  if (!hasHttpFeed || pendingHistory.has(code) || downloadedHistory.has(code)) return;
  pendingHistory.set(code,true);
  try {
    const response = await fetch('/api/daily?code='+encodeURIComponent(code));
    const result = await response.json();
    if (!response.ok || !result.bars?.length) throw Error(result.error||'來源未提供日行情');
    D.dailyByCode[code] = result.bars;
    if (!result.stale) downloadedHistory.add(code);
    if (state.stock === code && state.page === 'stock') render();
  } catch(e) {
    if (state.stock === code) toast('日行情補抓失敗，保留已存 K 棒。'+e.message);
  } finally { pendingHistory.delete(code); }
}

function exportLight() {
  const days = state.manualWeek ? archiveDays() : dates();
  const snapshot = {
    format:'chip-radar-light', version:1, created:new Date().toISOString(), end:state.win,
    sessions:D.sessions, dates:days, sources:days.map(d=>[d,D.quality[d]?.raw_source||'來源待核']),
    market:Object.fromEntries(Object.entries(exchangeMarket).map(([k,v])=>[k,[v.day,v.source]])),
    coverage:{universe:D.universe.length, start:days[0]||null, end:days.at(-1)||null},
    fields:['集保級距股數','篩選命中','可用日 OHLC'], strategy:applied,
    stocks:scan().map(({code,name,market,pass,insufficient,gain})=>({
      code,name,market,pass:!!pass,unknown:!!insufficient,gain:gain??null,
      weeks:days.map(d=>[d,D.series[d]?.[code]||null]),bars:stockBars(code)
    }))
  };
  download('股票雷達輕量快照-'+(days.at(-1)||'空資料')+'.json',JSON.stringify(snapshot),'application/json');
}


async function inspectHistoryCache(clear = false) {
  try {
    const response = await fetch('/api/cache', { cache:'no-store' });
    if (!response.ok) throw Error('無法讀取快取');
    const { history } = await response.json();
    const size = (history.bytes / 1024).toFixed(1) + ' KiB';
    const target = document.getElementById('cacheInfo');
    if (!target) return;
    target.textContent = `個股日 K · ${history.path} · ${history.count} 檔 · ${size} · 最新寫入 ${history.last || '—'}`;
    document.getElementById('clearHistory').hidden = history.count === 0;
    if (!clear || !history.count || !confirm(`清除 ${history.count} 個個股日 K 快取（${size}）？可按需重新下載。集保歷史、自選股、策略與手動匯入保留。`)) return;
    const result = await fetch('/api/cache/history/clear', {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({confirm:true})
    });
    if (!result.ok) throw Error((await result.json()).error);
    const cleared = await result.json();
    D.dailyByCode = {'2404':D.daily2404};
    downloadedHistory.clear();
    await inspectHistoryCache();
    toast(`已清除 ${cleared.count} 檔（${(cleared.bytes / 1024).toFixed(1)} KiB）`);
  } catch(error) {
    toast('快取操作失敗。'+error.message);
  }
}
