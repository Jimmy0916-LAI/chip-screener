/**
 * 格式化、安全轉義與基礎日期／級距工具函式
 */

const $ = sel => document.querySelector(sel);

const esc = x =>
  String(x ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const fmt = (v, dp = 0) =>
  typeof v === 'number' && isFinite(v)
    ? v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })
    : '—';

const pp = (v, n = 3) =>
  typeof v === 'number' && isFinite(v) ? `${v >= 0 ? '+' : ''}${fmt(v, n)}` : '—';

const sign = v => (v > 0 ? 'green' : v < 0 ? 'red' : 'muted');

const dt = ds => new Date(ds + 'T12:00:00+08:00');

const monday = ds => {
  const d = dt(ds);
  const w = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - w);
  return Math.floor(d.getTime() / 86400000);
};

function sumLevels(row, lo, hi, col) {
  let total = 0;
  for (let k = lo; k <= hi; k++) total += row[k]?.[col] || 0;
  return total;
}
