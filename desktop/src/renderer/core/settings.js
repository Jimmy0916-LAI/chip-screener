/**
 * 策略參數檢核（前後端一致的範圍與型別驗證）
 */

const NUMERIC_SETTING_KEYS = [
  'weeks', 'minPp', 'weeklyMin', 'profitDays', 'feeBuy', 'feeSell',
  'slip', 'warmup', 'grid', 'retention', 'dropPp', 'lowPosition', 'peakMin', 'rangeDays'
];

function validateSettings(input) {
  const out = { ...DEFAULT, ...input };

  for (const key of NUMERIC_SETTING_KEYS) {
    out[key] = Number(out[key]);
    if (!Number.isFinite(out[key])) throw Error('無效的參數：' + key);
  }

  if (!BAND_NAMES.includes(out.band)) throw Error('無效大戶級距');
  if (!Number.isInteger(out.weeks) || out.weeks < 1 || out.weeks > 4) throw Error('連續週數需為 1–4');
  if (out.minPp < 0 || out.minPp > 20 || out.weeklyMin < 0 || out.weeklyMin > 10) throw Error('級距門檻超出範圍');
  if (![150, 200, 500].includes(out.warmup)) throw Error('暖機期僅支援 150／200／500');
  if (![0.75, 1, 1.25].includes(out.grid)) throw Error('網格僅支援 0.75／1／1.25%');

  for (const k of ['feeBuy', 'feeSell', 'slip']) {
    if (out[k] < 0 || out[k] > 0.03) throw Error('費率超出範圍');
  }

  if (
    out.retention < 0 || out.retention > 100 ||
    out.dropPp < 0 || out.dropPp > 30 ||
    out.peakMin < 0 || out.peakMin > 60 ||
    out.lowPosition < 5 || out.lowPosition > 80 ||
    out.rangeDays < 20 || out.rangeDays > 250
  ) {
    throw Error('成本分布參數超出範圍');
  }

  for (const k of ['needShares', 'needPeak', 'needPrice']) {
    out[k] = Boolean(out[k]);
  }
  if (out.signals !== undefined) out.signals = validateSignalStrategy(out.signals);
  return out;
}
