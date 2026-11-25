'use strict';
// 在模擬 DOM 環境下針對建置後的 build/dashboard.html 執行完整週訊號與七頁整合回歸測試。
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, '..', 'build', 'dashboard.html'), 'utf8');
const nodes = new Map();
function node(id) {
  if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {} } });
  return nodes.get(id);
}

const ctx = vm.createContext({
  structuredClone,
  console,
  scrollTo() {},
  setTimeout() {},
  clearTimeout() {},
  document: { querySelector: node, body: { addEventListener() {} } },
  localStorage: { getItem() { return null; } },
  window: {
    addEventListener() {},
    desktopStore: { read: () => ({ ok: true }), save: () => ({ ok: true, redundant: true }) }
  }
});

for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
  vm.runInContext(script, ctx);
}

const run = source => JSON.parse(JSON.stringify(vm.runInContext(source, ctx)));
const rows = run('scan()');
assert.equal(rows.length, 1985);
assert.equal(new Set(rows.map(r => r.code)).size, 1985);
assert(rows.every(r => r.status && r.reason));
assert.deepEqual(run("D.adjustments['2026-11-13']['2330']"), [5899, 3]);

const previouslyMissing = run("Object.keys(D.adjustments['2026-11-13'])");
assert.equal(previouslyMissing.length, 29);
assert(previouslyMissing.every(code => rows.some(r => r.code === code)));
assert.deepEqual(rows.find(r => r.code === '2404').deltaShares, [796897, 579084]);

assert.equal(run("nextOpen('2026-10-23T14:41:16+08:00')"), '2026-10-27 09:00');
assert.equal(run("nextOpen('2026-11-16T08:59:59+08:00')"), '2026-11-16 09:00');
assert.equal(run("nextOpen('2026-11-19T12:00:00+08:00')"), null);

for (const asOf of ['2026-11-13T13:30:00+08:00', '2026-11-14T16:15:44+08:00']) {
  const r = run(`scan(DEFAULT,evaluation(DEFAULT,'2026-11-13','${asOf}'))`);
  assert(r.every(x => x.insufficient && !x.pass && !('gain' in x) && !('deltaShares' in x)));
}
assert.equal(run("weeklySignal('2404',evaluation(DEFAULT,'2026-11-13','2026-11-14T16:15:45+08:00')).pass"), true);

assert.equal(run("defaultStrictWeek({...DEFAULT,minPp:20}).end"), '2026-11-13');
assert.equal(run("const oldRows=D.series['2026-11-13'];D.series['2026-11-13']={};defaultStrictWeek(DEFAULT).end"), '2026-11-06');
run("D.series['2026-11-13']=oldRows;true");
assert(run("const originalEvidence={...D.observed};for(const end of dates())D.observed[end]=null;useDefaultWeek();!state.win && weekSelectionNotice().includes('沒有可評估窗口') && evaluation(applied).issue.includes('公布時點待證')"));
run("Object.assign(D.observed,originalEvidence);useDefaultWeek();true");

const ab = run("state.win='2026-10-30';draft.weeks=4;comparison()");
assert.equal(ab.a.end, ab.b.end);
assert.equal(ab.a.asOf, ab.b.asOf);
assert.equal(ab.rows.length, 1985);
assert.equal(ab.a.issue, undefined);
assert.match(ab.b.issue, /缺週/);
assert(ab.rows.every(x => x.b.insufficient && !x.b.pass && x.b.gain === undefined));
assert(run("compareExport(comparison()).every(x=>x.window==='2026-10-30' && x.B_state==='資料不足' && x.B_gain_pp==='')"));
assert(run("D.observed['2026-10-30']=null;scan().every(x=>x.insufficient && x.reason.includes('公布時點待證') && !x.delta)"));

for (const page of ['home', 'screen', 'stock', 'backtest', 'peak', 'settings', 'data']) {
  run(`go('${page}'); !!document.querySelector('#page').innerHTML`);
}
console.log('Weekly evidence, temporal gates, 1985 rows, 29 adjusted, 2330, holiday, HanTang, A/B cutoff and seven views passed.');

run("Object.assign(D.observed,originalEvidence);state.manualWeek=false;useDefaultWeek();true");
const newWeek = '2026-11-20';
run(`receiveOfficial({weeks:{'${newWeek}':{rows:D.series['2026-11-13'],issues:{},adjustments:{},quality:{},observed:'2026-11-22T10:00:00+08:00'}},months:{}});useDefaultWeek();true`);
assert.equal(run('state.win'), '2026-11-13');
assert.match(run("evaluation(applied,'2026-11-20').issue"), /日曆/);

run("receiveOfficial({weeks:{},months:{'2026-11':{days:['2026-11-20']}}});useDefaultWeek();true");
assert.equal(run('state.win'), newWeek);
assert.match(run("evaluation(applied,'2026-11-20','2026-11-20T13:30:00+08:00').issue"), /尚無公開證據/);

run("receiveOfficial({weeks:{'2026-12-04':{rows:D.series['2026-11-13'],issues:{},adjustments:{},quality:{},observed:'2026-12-06T10:00:00+08:00'}},months:{'2026-12':{days:['2026-11-27','2026-12-04']}}});useDefaultWeek();true");
assert.equal(run('state.win'), newWeek);
assert.match(run("evaluation(applied,'2026-12-04').issue"), /11-27 缺週/);
