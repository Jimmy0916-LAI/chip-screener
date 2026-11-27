/** Prospective screening on evidence available at the selected instant. */

const SIGNAL_LABELS = Object.freeze({
  tdcc: '大股東連續增持',
  macd: '日線 MACD 黃金交叉',
  breakout: '突破前 N 日高點'
});

const DEFAULT_SIGNAL_STRATEGY = Object.freeze({
  version: 1,
  mode: 'all',
  enabled: Object.freeze(['tdcc']),
  macd: Object.freeze({ fast: 12, slow: 26, signal: 9 }),
  breakoutDays: 20
});

function validateSignalStrategy(input = DEFAULT_SIGNAL_STRATEGY) {
  const { version, mode, enabled, macd, breakoutDays } = input;
  if (version !== 1 || !['all', 'any'].includes(mode)) throw Error('多條件策略版本或組合方式無效');
  if (!Array.isArray(enabled) || !enabled.length || new Set(enabled).size !== enabled.length ||
      enabled.some(id => !Object.hasOwn(SIGNAL_LABELS, id))) {
    throw Error('請選擇至少一項有效的篩選條件');
  }
  const bounded = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
  if (!macd || !bounded(macd.fast, 2, 60) || !bounded(macd.slow, 3, 120) ||
      macd.fast >= macd.slow || !bounded(macd.signal, 2, 60)) {
    throw Error('MACD 期間無效，快線須短於慢線');
  }
  if (!bounded(breakoutDays, 2, 120)) throw Error('前高回看期須為 2–120 個交易日');
  return {
    version, mode, enabled: [...enabled],
    macd: { fast: macd.fast, slow: macd.slow, signal: macd.signal },
    breakoutDays
  };
}

function signalOutcome(state, reason, values = null) {
  return { state, reason, values };
}

function combineSignals(mode, conditions) {
  const states = conditions.map(condition => condition.state);
  if (mode === 'all') {
    if (states.includes('miss')) return 'miss';
    return states.every(state => state === 'pass') ? 'pass' : 'unknown';
  }
  if (states.includes('pass')) return 'pass';
  return states.every(state => state === 'miss') ? 'miss' : 'unknown';
}

function prepareSignalTime(sessions, asOf) {
  // Reject local/ambiguous timestamps. The calendar is the existing ordered exchange calendar.
  const instant = typeof asOf === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(asOf) ? Date.parse(asOf) : NaN;
  const sessionIndex = Number.isFinite(instant)
    ? sessions.findLastIndex(day => Date.parse(day + 'T13:30:00+08:00') <= instant)
    : -1;
  return { sessions, sessionIndex, day: sessions[sessionIndex] || '', instant, asOf };
}

function priceSignalHistory(context, packet) {
  if (!context.day) return { bars: [], issue: '尚無可確認已收盤的評估交易日' };
  if (!Array.isArray(packet?.bars) || !packet.bars.length) return { bars: [], issue: '尚未取得此股日 K' };
  const fetched = typeof packet.fetched === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(packet.fetched)
    ? Date.parse(packet.fetched) : NaN;
  if (!Number.isFinite(fetched) || fetched > context.instant) {
    return { bars: [], issue: '評估時點缺少可取得日 K 的證據' };
  }
  const byDay = new Map();
  for (const bar of packet.bars) {
    if (!Array.isArray(bar) || typeof bar[0] !== 'string' || bar[0] > context.day) continue;
    byDay.set(bar[0], byDay.has(bar[0]) ? null : bar);
  }
  const bars = [];
  let issue = '';
  for (let i = context.sessionIndex; i >= 0; i--) {
    const day = context.sessions[i];
    const bar = byDay.get(day);
    if (!bar || !bar.slice(1, 5).every(Number.isFinite) || bar.length < 5 ||
        bar[3] <= 0 || bar[3] > Math.min(bar[1], bar[4]) || bar[2] < Math.max(bar[1], bar[4])) {
      issue = day + ' 缺少唯一且有效的日 K';
      break;
    }
    bars.push(bar);
  }
  return { bars: bars.reverse(), issue };
}

function signalEma(values, period) {
  const first = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const result = [first];
  const alpha = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    const previous = result.at(-1);
    result.push(previous + alpha * (values[i] - previous));
  }
  return result;
}

function macdSignal(history, { fast, slow, signal }) {
  const { bars, issue } = history;
  const required = slow + signal;
  if (bars.length < required) {
    return signalOutcome('unknown', `MACD 需至少 ${required} 根連續日 K（已有 ${bars.length}）${issue ? '｜' + issue : ''}`);
  }

  const closes = bars.map(bar => bar[4]);
  const fastEma = signalEma(closes, fast);
  const slowEma = signalEma(closes, slow);
  const dif = slowEma.map((value, i) => fastEma[i + slow - fast] - value);
  const dea = signalEma(dif, signal);
  const values = { previousDif: dif.at(-2), previousDea: dea.at(-2), dif: dif.at(-1), dea: dea.at(-1) };
  const crossed = values.previousDif <= values.previousDea && values.dif > values.dea;
  return signalOutcome(crossed ? 'pass' : 'miss', crossed ? 'DIF 由不高於 DEA 轉為高於 DEA' : '當日無黃金交叉', values);
}

function breakoutSignal(history, days) {
  const { bars, issue } = history;
  if (bars.length <= days) {
    return signalOutcome('unknown', `突破需當日及前 ${days} 根連續日 K（已有 ${bars.length}）${issue ? '｜' + issue : ''}`);
  }
  const close = bars.at(-1)[4];
  const priorHigh = Math.max(...bars.slice(-(days + 1), -1).map(bar => bar[2]));
  return signalOutcome(close > priorHigh ? 'pass' : 'miss',
    close > priorHigh ? '收盤高於前期最高價' : '收盤未高於前期最高價', { close, priorHigh });
}

function evaluateSignalStrategy(strategy, { weekly, prices, time }) {
  const history = strategy.enabled.some(id => id !== 'tdcc') ? priceSignalHistory(time, prices) : null;
  const conditions = strategy.enabled.map(id => {
    let result;
    if (id === 'tdcc') {
      result = weekly
        ? signalOutcome(weekly.insufficient ? 'unknown' : weekly.pass ? 'pass' : 'miss', weekly.reason)
        : signalOutcome('unknown', '尚無可評估的集保週');
    } else if (id === 'macd') {
      result = macdSignal(history, strategy.macd);
    } else {
      result = breakoutSignal(history, strategy.breakoutDays);
    }
    return { id, ...result };
  });
  return { state: combineSignals(strategy.mode, conditions), conditions, day: time.day, asOf: time.asOf };
}
