/**
 * SVG 視覺化圖表模組
 * 包含：大戶持股比例折線圖 (weeklyPlot)、漢唐日 K 與成交量 (dailyPlot)、換手成本分布圖 (distPlot)
 */

function weeklyPlot(code, bands, range) {
  let ds = archiveDays();
  if (range === 'recent') ds = ds.slice(-3);

  const allValues = ds.flatMap(day =>
    bands.map(b => vector(code, day, b)?.pct).filter(x => Number.isFinite(x))
  );
  if (!allValues.length) return '<div class="empty">沒有可繪製的集保數據</div>';

  let mn = Math.min(...allValues);
  let mx = Math.max(...allValues);
  const pad = Math.max(0.4, (mx - mn) * 0.3);
  mn -= pad;
  mx += pad;

  const w = 770;
  const h = 236;
  const left = 52;
  const right = 24;
  const top = 18;
  const bottom = 36;
  const plotW = w - left - right;
  const plotH = h - top - bottom;

  const X = i => left + (ds.length <= 1 ? 0.5 : i / (ds.length - 1)) * plotW;
  const Y = v => top + ((mx - v) / (mx - mn)) * plotH;

  const yGrid = [0, 0.25, 0.5, 0.75, 1]
    .map(fr => {
      const val = mn + (mx - mn) * fr;
      return (
        `<line class="gridline" x1="${left}" x2="${w - right}" y1="${Y(val)}" y2="${Y(val)}"/>` +
        `<text class="axis" x="${left - 8}" y="${Y(val) + 3.5}" text-anchor="end">${fmt(val, 1)}%</text>`
      );
    })
    .join('');

  const axes = ds
    .map((day, i) => `<text class="axis" x="${X(i)}" y="${h - 10}" text-anchor="middle">${day.slice(5)}</text>`)
    .join('');

  const lines = bands
    .map(b => {
      const chunks = [];
      let chunk = [];
      ds.forEach((day, i) => {
        const v = vector(code, day, b);
        if (chunk.length && i > 0 && (monday(day) - monday(ds[i - 1]) !== 7 || !v)) {
          chunks.push(chunk);
          chunk = [];
        }
        if (v) chunk.push([X(i), Y(v.pct)]);
        else if (chunk.length) {
          chunks.push(chunk);
          chunk = [];
        }
      });
      if (chunk.length) chunks.push(chunk);

      const path = chunks
        .map(
          pts =>
            `<polyline points="${pts.map(p => p.join(',')).join(' ')}" fill="none" stroke="${COLORS[b]}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`
        )
        .join('');

      const circles = ds
        .map((day, i) => {
          const v = vector(code, day, b);
          if (!v) return '';
          return (
            `<circle cx="${X(i)}" cy="${Y(v.pct)}" r="${b === bands[0] ? '4.5' : '3.5'}" fill="${COLORS[b]}" stroke="#0b0e14" stroke-width="1.8">` +
            `<title>${code} ${day} ${b} 張：${fmt(v.pct, 6)}%／${fmt(v.shares)} 股／${fmt(v.owner)} 戶</title></circle>`
          );
        })
        .join('');

      return path + circles;
    })
    .join('');

  return (
    `<svg role="img" aria-label="${code} 集保大戶持股比例圖，缺週折線中斷" viewBox="0 0 ${w} ${h}" class="plot">` +
    `<rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" rx="8" class="plot-bg"/>` +
    `${yGrid}${lines}${axes}</svg>`
  );
}

function dailyPlot() {
  const bars = D.daily2404.slice(-state.dailyRange);
  const width = 775;
  const height = 280;
  const marginLeft = 54;
  const marginR = 14;
  const top = 12;
  const priceH = 194;
  const volTop = 216;
  const volH = 36;
  const plotW = width - marginLeft - marginR;

  const lowest = Math.min(...bars.map(b => b[3]));
  const highest = Math.max(...bars.map(b => b[2]));
  const pad = (highest - lowest) * 0.1 || 10;

  const Y = p => top + ((highest + pad - p) / (highest - lowest + 2 * pad)) * priceH;
  const X = i => marginLeft + (i * plotW) / bars.length + plotW / (2 * bars.length);
  const barW = Math.max(1.2, Math.min(7, (plotW / bars.length) * 0.62));
  const vmax = Math.max(...bars.map(b => b[5]));

  const marks = bars
    .map((b, i) => {
      const x = X(i);
      const up = b[4] >= b[1];
      const color = up ? '#34d399' : '#f87171';
      return (
        `<line x1="${x}" x2="${x}" y1="${Y(b[2])}" y2="${Y(b[3])}" stroke="${color}" stroke-width="1.1"/>` +
        `<rect x="${x - barW / 2}" y="${Math.min(Y(b[1]), Y(b[4]))}" width="${barW}" height="${Math.max(1, Math.abs(Y(b[1]) - Y(b[4])))}" fill="${color}" rx="0.6"/>` +
        `<rect x="${x - barW / 2}" y="${volTop + volH * (1 - b[5] / vmax)}" width="${barW}" height="${(volH * b[5]) / vmax}" fill="${color}" opacity=".45">` +
        `<title>${b[0]} 開 ${b[1]} 高 ${b[2]} 低 ${b[3]} 收 ${b[4]} 量 ${fmt(b[5])} 股</title></rect>`
      );
    })
    .join('');

  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map(a => {
      const val = lowest - pad + (highest - lowest + 2 * pad) * a;
      return (
        `<line class="gridline" x1="${marginLeft}" x2="${width - marginR}" y1="${Y(val)}" y2="${Y(val)}"/>` +
        `<text class="axis" x="${marginLeft - 8}" y="${Y(val) + 3.5}" text-anchor="end">${fmt(val, 0)}</text>`
      );
    })
    .join('');

  return (
    `<svg class="plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="漢唐日線開高低收與成交量">` +
    `<rect class="plot-bg" x="${marginLeft}" y="${top}" width="${plotW}" height="${priceH + volH + 10}" rx="8"/>` +
    `${grid}${marks}` +
    `<text class="axis" x="${marginLeft}" y="${height - 6}">${bars[0]?.[0]}</text>` +
    `<text class="axis" text-anchor="end" x="${width - marginR}" y="${height - 6}">${bars.at(-1)?.[0]}</text>` +
    '</svg>' +
    '<div class="statbar">' +
    `<div><span class="mini">最新收盤（資料日）</span><strong>${fmt(bars.at(-1)?.[4], 2)}</strong></div>` +
    `<div><span class="mini">最後交易日</span><strong style="font-size:14px">${bars.at(-1)?.[0]}</strong></div>` +
    `<div><span class="mini">最後成交量</span><strong>${fmt(bars.at(-1)?.[5])}</strong></div>` +
    '</div>'
  );
}

function distPlot(res) {
  const { baseline, current, minKey, maxKey, step, c } = res;
  const list = [];
  for (let k = minKey; k <= maxKey; k++) {
    if ((baseline.get(k) || 0) + (current.get(k) || 0) > 0.00007) list.push(k);
  }
  if (!list.length) return '';

  const xMin = Math.min(...list);
  const xMax = Math.max(...list);
  const stride = Math.max(1, Math.ceil((xMax - xMin) / 140));
  const arr = [];

  for (let a = xMin; a <= xMax; a += stride) {
    let b = 0;
    let n = 0;
    for (let k = a; k < Math.min(a + stride, xMax + 1); k++) {
      b += baseline.get(k) || 0;
      n += current.get(k) || 0;
    }
    arr.push([a, b, n]);
  }

  const max = Math.max(...arr.flatMap(x => [x[1], x[2]]), 0.00001);
  const w = 730;
  const h = 236;
  const l = 48;
  const r = 16;
  const top = 12;
  const plotH = 178;
  const pw = w - l - r;

  const Y = x => top + ((max - x) / max) * plotH;
  const X = i => l + (i / Math.max(1, arr.length - 1)) * pw;
  const path = j => arr.map((p, i) => (i ? 'L' : 'M') + X(i).toFixed(2) + ' ' + Y(p[j]).toFixed(2)).join(' ');
  const kAt = i => Math.exp((arr[Math.round(i)]?.[0] || 0) * step);

  let mark = '';
  if (c) {
    const idx = arr.findIndex(x => x[0] <= c.k && x[0] + stride > c.k);
    if (idx >= 0) {
      mark = `<line x1="${X(idx)}" x2="${X(idx)}" y1="${top}" y2="${top + plotH}" stroke="#f59e0b" stroke-dasharray="4 3" stroke-width="1.5"/>`;
    }
  }

  return (
    `<svg viewBox="0 0 ${w} ${h}" class="plot" role="img" aria-label="成交股數換手衰減估算的成本分布">` +
    `<rect class="plot-bg" x="${l}" y="${top}" width="${pw}" height="${plotH}" rx="8"/>` +
    [0, 0.25, 0.5, 0.75, 1]
      .map(
        a =>
          `<line class="gridline" x1="${l}" x2="${w - r}" y1="${Y(max * a)}" y2="${Y(max * a)}"/>` +
          `<text class="axis" x="${l - 7}" y="${Y(max * a) + 3.5}" text-anchor="end">${fmt(max * a * 100, 1)}%</text>`
      )
      .join('') +
    `<path d="${path(1)}" stroke="#60a5fa" fill="none" stroke-width="2.2"/>` +
    `<path d="${path(2)}" stroke="#34d399" fill="none" stroke-width="2.2"/>` +
    mark +
    `<text class="axis" x="${l}" y="${h - 18}">NT$ ${fmt(kAt(0), 0)}</text>` +
    `<text class="axis" text-anchor="middle" x="${w / 2}" y="${h - 18}">NT$ ${fmt(kAt((arr.length - 1) / 2), 0)}</text>` +
    `<text class="axis" text-anchor="end" x="${w - r}" y="${h - 18}">NT$ ${fmt(kAt(arr.length - 1), 0)}</text>` +
    '</svg>' +
    '<div class="legend">' +
    '<span style="color:#60a5fa">● 基準分布</span>' +
    '<span style="color:#34d399">● 比較分布</span>' +
    '<span style="color:#f59e0b">│ 原底峰中心</span>' +
    '</div>'
  );
}
