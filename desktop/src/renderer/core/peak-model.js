/**
 * 低位籌碼峰探索模型（換手率衰減成本分布）
 * 公式：分布(t) = (1 - r) * 分布(t-1) + r * 當日高低價區間均勻分布
 */

function modeledDistribution(base, compare, cfg, bars = D.daily2404) {
  if (!Array.isArray(bars) || !bars.length) return { error: '尚未取得此股票的日 K 與發行股數資料' };
  const i = bars.findIndex(r => r[0] === base);
  const j = bars.findIndex(r => r[0] === compare);

  if (i < 0 || j < 0) return { error: '請選擇有日 K 的日期' };
  if (j < i) return { error: '比較日不能早於基準日' };

  const start = i - cfg.warmup + 1;
  if (start < 0) {
    return { error: `需要在基準日前有完整 ${cfg.warmup} 個交易日；目前僅有 ${i + 1} 日。` };
  }

  const step = Math.log(1 + cfg.grid / 100);
  const bins = new Map();
  let initial = 0;
  let baseline = null;
  const basePrice = bars[i][4];
  const events = [];

  function allocate(row, weight) {
    const low = row[3];
    const high = row[2];
    if (low <= 0 || high < low) throw Error('非有效價格');

    if (high === low) {
      const k = Math.floor(Math.log(low) / step);
      bins.set(k, (bins.get(k) || 0) + weight);
      return;
    }

    const first = Math.floor(Math.log(low) / step);
    const last = Math.floor(Math.log(high) / step);
    for (let k = first; k <= last; k++) {
      const boundaryL = Math.exp(k * step);
      const boundaryR = Math.exp((k + 1) * step);
      const share = Math.max(0, Math.min(high, boundaryR) - Math.max(low, boundaryL)) / (high - low);
      if (share > 0) bins.set(k, (bins.get(k) || 0) + weight * share);
    }
  }

  try {
    allocate(bars[start], 1);
    initial = 1;
    if (i === start) baseline = new Map(bins);

    for (let k = start + 1; k <= j; k++) {
      const row = bars[k];
      const r = row[7];
      if (!Number.isFinite(r) || r < 0 || r > 1) return { error: '存在日換手率不在 0～100% 之間，停止模型' };
      if (row[8]) events.push([row[0], row[8]]);

      for (const [n, v] of bins) {
        const decayed = v * (1 - r);
        if (decayed < 1e-13) bins.delete(n);
        else bins.set(n, decayed);
      }

      initial *= 1 - r;
      allocate(row, r);
      if (k === i) baseline = new Map(bins);
    }

    if (!baseline) return { error: '基準日未完成計算' };
  } catch (e) {
    return { error: e.message };
  }

  const current = new Map(bins);
  const minKey = Math.min(...baseline.keys(), ...current.keys());
  const maxKey = Math.max(...baseline.keys(), ...current.keys());

  function findPeaks(dist) {
    const smooth = k => ((dist.get(k - 1) || 0) + (dist.get(k) || 0) + (dist.get(k + 1) || 0)) / 3;
    const peaks = [];
    const first = Math.min(...dist.keys()) + 7;
    const last = Math.max(...dist.keys()) - 7;
    for (let k = first; k <= last; k++) {
      const s = smooth(k);
      if (s <= 0 || s < smooth(k - 1) || s <= smooth(k + 1)) continue;
      const left = Math.min(...[3, 4, 5, 6].map(n => smooth(k - n)));
      const right = Math.min(...[3, 4, 5, 6].map(n => smooth(k + n)));
      if (s < 1.25 * Math.max(left, right)) continue;
      const band = [-2, -1, 0, 1, 2].reduce((acc, offset) => acc + (dist.get(k + offset) || 0), 0);
      peaks.push({ k, center: Math.exp((k + 0.5) * step), s, band });
    }
    return peaks;
  }

  const basePeaks = findPeaks(baseline);
  const rangeSlice = bars.slice(Math.max(0, i - cfg.rangeDays + 1), i + 1);
  const low60 = Math.min(...rangeSlice.map(x => x[3]));
  const high60 = Math.max(...rangeSlice.map(x => x[2]));

  const candidate = basePeaks
    .filter(
      p =>
        high60 > low60 &&
        ((p.center - low60) / (high60 - low60)) * 100 <= cfg.lowPosition &&
        Math.abs(basePrice / p.center - 1) <= 0.05 &&
        p.band * 100 >= cfg.peakMin
    )
    .sort((a, b) => b.band - a.band || a.center - b.center)[0];

  let result = '無符合規格的底峰基準';
  let c = null;
  let currentBand = null;
  let retain = null;
  let drop = null;
  let compPeak = null;

  if (candidate) {
    c = candidate;
    currentBand = [-2, -1, 0, 1, 2].reduce((acc, offset) => acc + (current.get(c.k + offset) || 0), 0);
    drop = (c.band - currentBand) * 100;
    retain = (currentBand / c.band) * 100;
    const nearby = findPeaks(current)
      .filter(p => Math.abs(p.k - c.k) <= 6)
      .sort((a, b) => Math.abs(a.k - c.k) - Math.abs(b.k - c.k) || b.s - a.s);
    compPeak = nearby[0];
    result =
      compPeak && Math.abs(compPeak.k - c.k) <= 1 && drop <= cfg.dropPp && retain >= cfg.retention
        ? '候選底峰保留'
        : '底峰未通過保留';
  }

  return {
    baseline,
    current,
    minKey,
    maxKey,
    step,
    base,
    compare,
    start: bars[start][0],
    basePrice,
    c,
    currentBand,
    retain,
    drop,
    compPeak,
    result,
    initial,
    events,
    basePeaksCount: basePeaks.length,
    low60,
    high60
  };
}
