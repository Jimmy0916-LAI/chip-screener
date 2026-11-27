/**
 * Yahoo 奇摩股市風格互動式 K 線、均線（MA5/10/20/60）、成交量（MV5）與十字準線繪圖引擎
 * 配色採用台股慣例：紅漲綠跌。
 */

const MA_COLORS = {
  5: '#eab308',
  10: '#a855f7',
  20: '#3b82f6',
  60: '#f97316',
  200: '#22d3ee'
};

function aggregateBars(dailyBars, tf) {
  if (tf === 'D') return dailyBars.map(b => [...b]);
  const groups = [];
  let curKey = null;
  let cur = null;
  for (const [d, o, h, l, c, v] of dailyBars) {
    let key;
    if (tf === 'M') {
      key = d.slice(0, 7);
    } else {
      const parsed = dt(d);
      const day = (parsed.getUTCDay() + 6) % 7;
      parsed.setUTCDate(parsed.getUTCDate() - day);
      key = parsed.toISOString().slice(0, 10);
    }
    if (key !== curKey) {
      if (cur) groups.push(cur);
      curKey = key;
      cur = [d, o, h, l, c, v];
    } else {
      cur[0] = d;
      cur[2] = Math.max(cur[2], h);
      cur[3] = Math.min(cur[3], l);
      cur[4] = c;
      cur[5] += v;
    }
  }
  if (cur) groups.push(cur);
  return groups;
}

function computeMA(bars, period) {
  return bars.map((_, idx) => {
    if (idx + 1 < period) return null;
    let sum = 0;
    for (let k = idx - period + 1; k <= idx; k++) sum += bars[k][4];
    return sum / period;
  });
}

function computeVolMA(bars, period = 5) {
  return bars.map((_, idx) => {
    if (idx + 1 < period) return null;
    let sum = 0;
    for (let k = idx - period + 1; k <= idx; k++) sum += bars[k][5];
    return sum / period;
  });
}

function drawDetailKline() {
  if (typeof document === 'undefined') return;
  const canvas = document.querySelector('#klineCanvas');
  if (!canvas || typeof canvas.getContext !== 'function') return;

  const isUsPage = state.page === 'us_stock';
  const activeCode = isUsPage ? state.usStock : state.stock;
  const detail = isUsPage ? state.usDetailByCode?.[activeCode] : state.stockDetailByCode?.[activeCode];
  if (!detail?.bars?.length) return;

  const maPeriods = isUsPage ? [5, 10, 20, 60, 200] : [5, 10, 20, 60];
  const allAgg = aggregateBars(detail.bars, state.detailTf || 'D');
  const allMa = {
    5: computeMA(allAgg, 5),
    10: computeMA(allAgg, 10),
    20: computeMA(allAgg, 20),
    60: computeMA(allAgg, 60),
    200: computeMA(allAgg, 200)
  };
  const allMv5 = computeVolMA(allAgg, 5);

  const count = state.detailTf === 'D' ? Math.min(state.detailRange || 60, allAgg.length) : allAgg.length;
  const startIdx = allAgg.length - count;
  const view = allAgg.slice(startIdx);
  if (!view.length) return;

  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  const cssW = canvas.clientWidth || 900;
  const cssH = 360;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 58;
  const padR = 16;
  const topP = 14;
  const priceH = 228;
  const volTop = 258;
  const volH = 76;
  const plotW = cssW - padL - padR;

  ctx.fillStyle = '#0d1118';
  ctx.fillRect(padL, topP, plotW, priceH);
  ctx.fillRect(padL, volTop, plotW, volH);

  let hi = -Infinity;
  let lo = Infinity;
  let maxV = 1;
  view.forEach((b, i) => {
    hi = Math.max(hi, b[2]);
    lo = Math.min(lo, b[3]);
    maxV = Math.max(maxV, b[5]);
    for (const p of maPeriods) {
      const mv = allMa[p][startIdx + i];
      if (state.detailMas[p] && mv !== null) {
        hi = Math.max(hi, mv);
        lo = Math.min(lo, mv);
      }
    }
  });
  const holdingCost = typeof getBestHoldingCostInfo === 'function' ? getBestHoldingCostInfo(activeCode) : null;
  const costPrice = holdingCost?.costPrice || null;
  if (costPrice && costPrice >= lo * 0.75 && costPrice <= hi * 1.25) {
    hi = Math.max(hi, costPrice);
    lo = Math.min(lo, costPrice);
  }
  const marginP = (hi - lo) * 0.08 || 2;
  hi += marginP;
  lo -= marginP;

  const Y = p => topP + ((hi - p) / (hi - lo)) * priceH;
  const stepX = plotW / Math.max(1, view.length);
  const X = i => padL + i * stepX + stepX / 2;
  const barW = Math.max(2, Math.min(11, stepX * 0.68));

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'right';
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const val = lo + (hi - lo) * f;
    const y = Y(val);
    ctx.beginPath();
    ctx.setLineDash([3, 4]);
    ctx.moveTo(padL, y);
    ctx.lineTo(cssW - padR, y);
    ctx.stroke();
    ctx.fillText((isUsPage ? '$' : '') + fmt(val, val < 150 ? 1 : 0), padL - 6, y + 4);
  }
  ctx.setLineDash([]);

  // K 棒與成交量（統一紅漲綠跌）
  view.forEach((b, i) => {
    const x = X(i);
    const up = b[4] >= b[1];
    const color = up ? '#ef4444' : '#22c55e';
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(x, Y(b[2]));
    ctx.lineTo(x, Y(b[3]));
    ctx.stroke();

    const yTop = Math.min(Y(b[1]), Y(b[4]));
    const bodyH = Math.max(1.5, Math.abs(Y(b[1]) - Y(b[4])));
    ctx.fillRect(x - barW / 2, yTop, barW, bodyH);

    const vh = (b[5] / maxV) * volH;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(x - barW / 2, volTop + volH - vh, barW, Math.max(1, vh));
    ctx.globalAlpha = 1;
  });

  // 均線 MA5/10/20/60(/200)
  for (const p of maPeriods) {
    if (!state.detailMas[p]) continue;
    ctx.strokeStyle = MA_COLORS[p];
    ctx.lineWidth = p === 200 ? 1.8 : 1.6;
    ctx.beginPath();
    let started = false;
    view.forEach((_, i) => {
      const val = allMa[p][startIdx + i];
      if (val === null) return;
      const x = X(i);
      const y = Y(val);
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
  }

  // 持有成本均價線（若收藏夾有填寫購入價）
  if (costPrice) {
    const dpCost = isUsPage ? 2 : costPrice < 150 ? 2 : 1;
    const inRange = costPrice >= lo && costPrice <= hi;
    const cy = inRange ? Y(costPrice) : costPrice > hi ? topP + 10 : topP + priceH - 10;
    ctx.save();
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
    ctx.lineWidth = 1.4;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(padL, cy);
    ctx.lineTo(cssW - padR, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    const lbl = `成本 ${isUsPage ? '$' : ''}${fmt(costPrice, dpCost)}${inRange ? '' : costPrice > hi ? ' ↑' : ' ↓'}`;
    ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
    const tw = ctx.measureText(lbl).width + 10;
    const bx = cssW - padR - tw - 4;
    const by = Math.max(topP + 2, Math.min(topP + priceH - 20, cy - 18));
    ctx.fillStyle = 'rgba(13, 17, 24, 0.92)';
    ctx.fillRect(bx, by, tw, 17);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.strokeRect(bx, by, tw, 17);
    ctx.fillStyle = '#38bdf8';
    ctx.textAlign = 'left';
    ctx.fillText(lbl, bx + 5, by + 12);
    ctx.restore();
  }

  // MV5 均量線
  ctx.strokeStyle = '#eab308';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  let mvStarted = false;
  view.forEach((_, i) => {
    const val = allMv5[startIdx + i];
    if (val === null) return;
    const x = X(i);
    const y = volTop + volH - (val / maxV) * volH;
    if (!mvStarted) {
      ctx.moveTo(x, y);
      mvStarted = true;
    } else {
      ctx.lineTo(x, y);
    }
  });
  ctx.stroke();

  // X 軸日期
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText(view[0][0], padL, cssH - 8);
  ctx.textAlign = 'center';
  ctx.fillText(view[Math.floor(view.length / 2)][0], padL + plotW / 2, cssH - 8);
  ctx.textAlign = 'right';
  ctx.fillText(view.at(-1)[0], cssW - padR, cssH - 8);

  const activeIdx =
    state.detailHoverIdx !== null && state.detailHoverIdx < view.length
      ? state.detailHoverIdx
      : view.length - 1;
  const b = view[activeIdx];
  const prevB = activeIdx > 0 ? view[activeIdx - 1] : startIdx > 0 ? allAgg[startIdx - 1] : b;
  const diff = b[4] - prevB[4];
  const diffPct = prevB[4] ? (diff / prevB[4]) * 100 : 0;

  if (state.detailHoverIdx !== null && state.detailHoverIdx < view.length) {
    const cx = X(activeIdx);
    const cy = Y(b[4]);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx, topP);
    ctx.lineTo(cx, volTop + volH);
    ctx.moveTo(padL, cy);
    ctx.lineTo(cssW - padR, cy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  const readout = document.querySelector('#klineReadout');
  if (readout) {
    const dCls = diff > 0 ? 'tw-up' : diff < 0 ? 'tw-down' : '';
    const dp = isUsPage ? 2 : b[4] < 150 ? 2 : 1;
    const pfx = isUsPage ? '$' : '';
    const volStr = isUsPage && typeof fmtUsShares === 'function' ? fmtUsShares(b[5]) : `${fmt(b[5])} 張`;
    const maSpans = maPeriods
      .filter(p => state.detailMas[p])
      .map(
        p =>
          `<span style="color:${MA_COLORS[p]};font-weight:600">MA${p} ${pfx}${fmt(allMa[p][startIdx + activeIdx], dp)}</span>`
      )
      .join(' ');
    readout.innerHTML =
      `<b>${b[0]}</b>` +
      `<span>開 <b>${pfx}${fmt(b[1], dp)}</b></span>` +
      `<span>高 <b class="tw-up">${pfx}${fmt(b[2], dp)}</b></span>` +
      `<span>低 <b class="tw-down">${pfx}${fmt(b[3], dp)}</b></span>` +
      `<span>收 <b class="${dCls}">${pfx}${fmt(b[4], dp)} (${diffPct >= 0 ? '+' : ''}${fmt(diffPct, 2)}%)</b></span>` +
      `<span>量 <b>${volStr}</b></span>` +
      maSpans;
  }

  canvas.onmousemove = ev => {
    const rect = canvas.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    if (mx < padL || mx > cssW - padR) return;
    const idx = Math.max(0, Math.min(view.length - 1, Math.floor((mx - padL) / stepX)));
    if (idx !== state.detailHoverIdx) {
      state.detailHoverIdx = idx;
      drawDetailKline();
    }
  };
  canvas.onmouseleave = () => {
    if (state.detailHoverIdx !== null) {
      state.detailHoverIdx = null;
      drawDetailKline();
    }
  };
}
