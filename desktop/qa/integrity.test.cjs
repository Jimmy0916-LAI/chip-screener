const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function loadCore(file, globals) {
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/core', file + '.js'), 'utf8');
  const context = vm.createContext(globals);
  vm.runInContext(source, context);
  return context;
}

test('legacy settings survive a denied save; successful save restores the full tuple', () => {
  const data = new Map([['chipscr_applied', '{"band":"400"}']]);
  let blocked = true;
  const globals = {
    D: { quality: {}, series: {} }, DEFAULT: { band: '400' }, structuredClone,
    validateSettings: x => ({ ...x }), render() {}, toast() {},
    localStorage: {
      getItem(key) { return data.get(key) ?? null; },
      setItem(key, value) {
        if (blocked) throw Error('配額不足');
        data.set(key, value);
      }
    }
  };
  const context = loadCore('storage-adapter', globals);
  assert.equal(vm.runInContext("applied.band='600'; saveConfig()", context), false);
  assert.equal(vm.runInContext('applied.band', context), '400');
  blocked = false;
  assert.equal(vm.runInContext("applied.band='600'; draft.band='200'; presets=[]; saveConfig()", context), true);
  assert.equal(vm.runInContext('applied.band', loadCore('storage-adapter', { ...globals })), '600');
  assert.equal(vm.runInContext('draft.band', loadCore('storage-adapter', { ...globals })), '200');
});

async function importSample(day, blank, confirm) {
  const lines = ['資料日期,證券代號,持股分級,人數,股數'];
  for (let level = 1; level <= 17; level++) {
    const n = level === 1 || level === 17 ? 1 : 0;
    lines.push([day, '2330', level, n, blank && level === 12 ? '' : n].join(','));
  }
  const saved = [];
  const previews = [];
  const context = loadCore('data-io', {
    state: { importCount: 0, manualWeek: true }, D: { series: {} }, officialWeeks: {},
    sumLevels(row, lo, hi, col) {
      let total = 0;
      for (let i = lo; i <= hi; i++) total += row[i][col];
      return total;
    },
    window: { confirm(message) { previews.push(message); return confirm; } },
    saveWeek(...args) { saved.push(args); }, render() {}, toast() {}, $() {}
  });
  await context.importTDCC([{ name: '測試.csv', text: async () => lines.join('\n') }]);
  return { saved, previews };
}
test('manual import rejects nonexistent dates and missing shares', async () => {
  assert.equal((await importSample('20261131', false, true)).saved.length, 0);
  assert.equal((await importSample('20261127', true, true)).saved.length, 0);
});
test('manual import requires confirmation of the validated week', async () => {
  assert.equal((await importSample('20261127', false, false)).saved.length, 0);
  const result = await importSample('20261127', false, true);
  assert.match(result.previews[0], /2026-11-27/);
  assert.equal(result.saved[0][0], '2026-11-27');
});
test('future prices do not change a historical baseline peak', () => {
  const { modeledDistribution } = loadCore('peak-model', {});
  const prices = Array.from({ length: 150 }, (_, i) => i % 2 ? 100 : 99);
  prices.push(90, 110);
  const bars = prices.map((p, i) => [String(i), p, p, p, p, 100, 1000, 0.2]);
  const cfg = { warmup: 150, rangeDays: 20, grid: 1, lowPosition: 100, peakMin: 0 };
  const first = modeledDistribution('149', '149', cfg, bars);
  const later = modeledDistribution('149', '151', cfg, bars);
  assert.equal(later.basePeaksCount, first.basePeaksCount);
  assert.equal(later.c?.k, first.c?.k);
  bars[140][7] = null;
  assert.ok(modeledDistribution('149', '151', cfg, bars).error);
});
