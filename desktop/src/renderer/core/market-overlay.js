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
    if (!response.ok || result.code !== code || !result.bars?.length) throw Error(result.error||'來源未提供此股日行情');
    D.dailyByCode[code] = result.bars;
    if (!result.stale) downloadedHistory.add(code);
    if (state.stock === code && state.page === 'stock') render();
  } catch(e) {
    if (state.stock === code) toast('日行情補抓失敗，保留已存 K 棒。'+e.message);
  } finally { pendingHistory.delete(code); }
}
