'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { LocalStore } = require('./storage.cjs');
const key = 'snapshot';
const data = day => ({[day]:{rows:{2404:[100,10,80,70,60,50,8,7,6,5]},quality:{valid:1,invalid:0,raw_source:'手動匯入 QA'},observed:null}});
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'chip-store-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return new LocalStore(root);
}
test('read empty, validate before commit and recover a checksum failure', t=>{
  const s=setup(t), a=data('2026-09-18'), b=data('2026-09-25');
  assert.equal(s.read(key).value,null);
  s.save(key,a); assert.throws(()=>s.save(key,data('2026-02-31')));
  assert.deepEqual(s.read(key).value,a);
  s.save(key,b);
  const name=s.filename(key,'current'), corrupt=JSON.parse(fs.readFileSync(name));
  corrupt.body.value=a;
  fs.writeFileSync(name,JSON.stringify(corrupt));
  assert.deepEqual(s.read(key).value,b);
  fs.writeFileSync(s.filename(key,'mirror'),'broken');
  assert.deepEqual(s.read(key).value,a);
  fs.writeFileSync(s.filename(key,'previous'),'broken');
  assert.throws(()=>s.save(key,b),/所有副本/);
});
test('abrupt process exit after flush before rename leaves last commit readable',t=>{
  const store=setup(t), a=data('2026-09-18'), b=data('2026-09-25');
  store.save(key,a);
  const run=spawnSync(process.execPath,['-e',`
    const fs = require('node:fs'), orig = fs.renameSync;
    fs.renameSync = (a,b) => {if(b.endsWith('snapshot.current.json')) process.exit(77); orig(a,b)};
    const {LocalStore}=require(process.argv[1]); new LocalStore(process.argv[2]).save('snapshot',JSON.parse(process.argv[3]));
  `,require.resolve('./storage.cjs'),store.directory,JSON.stringify(b)]);
  assert.equal(run.status,77);
  assert.ok(fs.existsSync(store.filename(key,'current')+'.tmp'));
  assert.deepEqual(new LocalStore(store.directory).read(key).value,a);
  store.save(key,b);
  assert.deepEqual(store.read(key).value,b);
});

function config(minPp) {
  const settings = {band:'400',weeks:2,minPp,weeklyMin:0,profitDays:20,feeBuy:0,feeSell:0,slip:0,warmup:200,
    grid:1,retention:75,dropPp:5,lowPosition:40,peakMin:15,rangeDays:60,needShares:true,needPeak:false,needPrice:false};
  return {format:'chip-screener-config-v1',applied:settings,draft:settings,presets:[{name:'QA',settings}]};
}
for (const kind of ['settings','snapshot']) {
  test(kind + ': stale mirror, two missed copies, corrupt current, save after recovery', t => {
    const s=setup(t);
    const values=kind==='settings' ? [1,2,3,4].map(config) : ['01','02','03','04'].map(d=>data('2026-09-'+d));
    s.save(kind,values[0]);
    const mirrorStage=s.filename(kind,'mirror')+'.tmp';
    fs.mkdirSync(mirrorStage);
    assert.equal(s.save(kind,values[1]).redundant,false);
    assert.equal(s.save(kind,values[2]).redundant,false);
    fs.rmdirSync(mirrorStage);
    const current=s.filename(kind,'current');
    fs.copyFileSync(current,current+'.tmp');
    fs.writeFileSync(current,'truncated');
    const restored=new LocalStore(s.directory).read(kind);
    assert.equal(restored.revision,2);
    assert.equal(restored.slot,'previous');
    assert.deepEqual(restored.value,values[1]);
    s.save(kind,values[3]);
    assert.deepEqual(new LocalStore(s.directory).read(kind).value,values[3]);
    assert.equal(s.read(kind).revision,3);
  });
}
test('compare all committed revisions even with a valid current and validate candidate contents', t=>{
  const s=setup(t), current=s.filename(key,'current'), mirror=s.filename(key,'mirror');
  s.save(key,data('2026-09-01'));
  const first=fs.readFileSync(current);
  s.save(key,data('2026-09-02'));
  fs.writeFileSync(current,first);
  assert.equal(s.read(key).slot,'mirror');
  const bad=JSON.parse(fs.readFileSync(mirror));
  bad.body.value={'not-a-date':{}};
  bad.sha256=require('node:crypto').createHash('sha256').update(JSON.stringify(bad.body)).digest('hex');
  fs.writeFileSync(mirror,JSON.stringify(bad));
  assert.equal(s.read(key).revision,1);
  assert.equal(s.read(key).slot,'current');
});
