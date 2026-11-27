const exchangeMarket = {};
const pendingHistory = new Map();

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
  if (!hasHttpFeed || pendingHistory.has(code)) return;
  pendingHistory.set(code,true);
  try {
    const response = await fetch('/api/daily?code='+encodeURIComponent(code));
    const result = await response.json();
    if (!response.ok || !result.bars?.length) throw Error(result.error||'來源未提供日行情');
    D.dailyByCode[code] = result.bars;
    if (state.stock === code && state.page === 'stock') render();
  } catch(e) {
    if (state.stock === code) toast('日行情補抓失敗，保留已存 K 棒。'+e.message);
  } finally { pendingHistory.delete(code); }
}

function exportLight() {
  const days = archiveDays();
  const snapshot = {
    format:'chip-radar-light', version:1, created:new Date().toISOString(), end:state.win,
    sessions:D.sessions, dates:days, sources:days.map(d=>[d,D.quality[d]?.raw_source||'來源待核']),
    market:Object.fromEntries(Object.entries(exchangeMarket).map(([k,v])=>[k,[v.day,v.source]])),
    fields:['集保級距股數','篩選命中','可用日 OHLC'], strategy:applied,
    stocks:scan().map(({code,name,market,pass,insufficient,gain})=>({
      code,name,market,pass:!!pass,unknown:!!insufficient,gain:gain??null,
      weeks:days.map(d=>[d,D.series[d]?.[code]||null]),bars:stockBars(code)
    }))
  };
  download('股票雷達輕量快照-'+(days.at(-1)||'空資料')+'.json',JSON.stringify(snapshot),'application/json');
}
