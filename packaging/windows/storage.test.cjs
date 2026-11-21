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
