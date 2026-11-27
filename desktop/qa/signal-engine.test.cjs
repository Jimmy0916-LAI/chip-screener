const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { createContext, runInContext } = require('node:vm');

const context = createContext();
const core = readFileSync(require.resolve('../src/renderer/core/signal-engine.js'), 'utf-8');
const { validateSignalStrategy, prepareSignalTime, evaluateSignalStrategy, combineSignals } =
  runInContext(core + '\n({ validateSignalStrategy, prepareSignalTime, evaluateSignalStrategy, combineSignals })', context);

const sessions = Array.from({ length: 45 }, (_, i) =>
  new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10));
const asOf = sessions[34] + 'T15:00:00+08:00';
const quote = (day, close, high = close) => [day, close, high, close, close];
const packet = bars => ({ bars, fetched: asOf });
const options = fields => validateSignalStrategy({
  version: 1, mode: 'all', enabled: ['tdcc', 'macd', 'breakout'],
  macd: { fast: 12, slow: 26, signal: 9 }, breakoutDays: 20, ...fields
});
const evaluate = (strategy, prices, time = prepareSignalTime(sessions, asOf), weekly = null) =>
  evaluateSignalStrategy(strategy, { weekly, prices, time });
const closeSeries = last => sessions.slice(0, 35).map((day, i) => quote(day, i === 34 ? last : 100));

test('validates and normalizes saved parameters', () => {
  assert.deepEqual(Array.from(validateSignalStrategy().enabled), ['tdcc']);
  assert.throws(() => options({ enabled: [] }));
  assert.throws(() => options({ enabled: ['macd', 'macd'] }));
  assert.throws(() => options({ macd: { fast: 26, slow: 12, signal: 9 } }));
  assert.throws(() => options({ breakoutDays: '20' }));
});

test('all / any use three-valued logic', () => {
  const check = (mode, ...states) => combineSignals(mode, states.map(state => ({ state })));
  assert.equal(check('all', 'pass', 'pass'), 'pass');
  assert.equal(check('all', 'pass', 'unknown'), 'unknown');
  assert.equal(check('all', 'miss', 'unknown'), 'miss');
  assert.equal(check('any', 'pass', 'unknown'), 'pass');
  assert.equal(check('any', 'miss', 'unknown'), 'unknown');
  assert.equal(check('any', 'miss', 'miss'), 'miss');
});

test('legacy weekly evidence is passed through unchanged', () => {
  const strategy = options({ enabled: ['tdcc'] });
  const time = prepareSignalTime(sessions, asOf);
  for (const [weekly, state] of [
    [{ pass: true, reason: '通過週增持' }, 'pass'],
    [{ pass: false, reason: '比例未連升' }, 'miss'],
    [{ pass: false, insufficient: true, reason: '缺週' }, 'unknown']
  ]) {
    const result = evaluate(strategy, null, time, weekly);
    assert.equal(result.state, state);
    assert.equal(result.conditions[0].reason, weekly.reason);
  }
});

test('MACD treats previous equality as a valid starting point and uses unrounded values', () => {
  const strategy = options({ enabled: ['macd'] });
  const outcome = evaluate(strategy, packet(closeSeries(110))).conditions[0];
  const expectedDif = 10 * (2 / 13 - 2 / 27);
  assert.equal(outcome.state, 'pass');
  assert.equal(outcome.values.previousDif, 0);
  assert.equal(outcome.values.previousDea, 0);
  assert.ok(Math.abs(outcome.values.dif - expectedDif) < 1e-12);
  assert.ok(Math.abs(outcome.values.dea - expectedDif * 0.2) < 1e-12);
  assert.equal(evaluate(strategy, packet(closeSeries(100))).state, 'miss');
  const weakPullback = closeSeries(101);
  weakPullback[33] = quote(sessions[33], 110);
  assert.equal(evaluate(strategy, packet(weakPullback)).state, 'miss');
});

test('breakout compares only the preceding 20 highs and requires strict inequality', () => {
  const strategy = options({ enabled: ['breakout'] });
  const prices = closeSeries(105);
  prices[13] = quote(sessions[13], 100, 500); // One session outside the window
  prices[14] = quote(sessions[14], 100, 104);
  prices[34] = quote(sessions[34], 105, 999);
  const outcome = evaluate(strategy, packet(prices)).conditions[0];
  assert.equal(outcome.state, 'pass');
  assert.equal(outcome.values.priorHigh, 104);
  prices[34] = quote(sessions[34], 104, 999);
  assert.equal(evaluate(strategy, packet(prices)).state, 'miss');
});

test('missing, malformed, duplicate bars and insufficient warmup stay unknown', () => {
  const strategy = options({});
  const full = closeSeries(110);
  const missing = full.filter(row => row[0] !== sessions[30]);
  assert.deepEqual(Array.from(evaluate(strategy, packet(missing)).conditions, r => r.state),
                   ['unknown', 'unknown', 'unknown']);
  assert.equal(evaluate(options({ enabled: ['macd'] }), packet(full.slice(1))).state, 'unknown');
  assert.equal(evaluate(options({ enabled: ['breakout'] }), packet([...full, full.at(-1)])).state, 'unknown');
  const malformed = [...full.slice(0, -1), [sessions[34], 1, 2, 3, 4]];
  assert.equal(evaluate(options({ enabled: ['breakout'] }), packet(malformed)).state, 'unknown');
});

test('partial history allows a shorter valid rule while MACD remains unknown', () => {
  const strategy = options({ mode: 'any', enabled: ['macd', 'breakout'] });
  const result = evaluate(strategy, packet(closeSeries(110).slice(-21)));
  assert.deepEqual(Array.from(result.conditions, r => r.state), ['unknown', 'pass']);
  assert.equal(result.state, 'pass');
});

test('future bars, timestamps, and unfinished sessions cannot affect the evaluation', () => {
  const strategy = options({ enabled: ['macd', 'breakout'] });
  const full = closeSeries(110);
  assert.deepEqual(evaluate(strategy, packet(full)),
                   evaluate(strategy, packet([...full, quote(sessions[35], 900)])));
  assert.equal(evaluate(strategy, { bars: full, fetched: sessions[35] + 'T01:00:00+08:00' }).state, 'unknown');
  assert.equal(evaluate(strategy, { bars: full, fetched: sessions[34] + 'T15:00:00' }).state, 'unknown');
  assert.equal(prepareSignalTime(sessions, sessions[34] + 'T13:29:59+08:00').day, sessions[33]);
  assert.equal(prepareSignalTime(sessions, sessions[34] + 'T13:30:00+08:00').day, sessions[34]);
});
