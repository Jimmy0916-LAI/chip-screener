'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {TDCC,calendarURL,parseWeek,parseMonth}=require('./tdcc.cjs');
const {OfficialFeed}=require('./official-feed.cjs');
const universe=['2301','2404'],base={universe,hashes:{'2026-11-13':'embedded'},sessions:['2026-11-13','2026-11-19']};
function csv(day,codes=universe) {
  const lines=['資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%'];
  for(const code of codes) for(let i=1;i<=17;i++) lines.push([day.replaceAll('-',''),code,i,i===17?15:i===16?0:1,i===17?1499:i===16?1:100,'0.00'].join(','));
  return Buffer.from(lines.join('\r\n'));
}
function calendar(days) {return Buffer.from(JSON.stringify({stat:'OK',date:'20261101',fields:['日期','成交股數'],data:days.map(d=>['115/11/'+d,'1,300'])}));}
const stamp='2026-12-05T10:00:00+08:00';
test('validate official fields, date, coverage, adjustments and session overlap',()=>{
  const week=parseWeek(csv('2026-11-20'),universe,stamp);
  assert.deepEqual(week.adjustments['2404'],[1,0]);assert.equal(week.rows['2404'][3],400);
  assert.throws(()=>parseWeek(csv('2026-11-20',['2404']),universe,stamp),/95%/);
  assert.throws(()=>parseWeek(Buffer.from(csv('2026-11-20').toString().replace('20261120','20261113')),universe,stamp),/不同日期/);
  assert.throws(()=>parseWeek(Buffer.from('html error'),universe,stamp),/欄位/);
  assert.throws(()=>parseMonth(calendar(['13','20']),'2026-11',stamp,base.sessions),/倒退/);
});
test('save, restart, deduplicate, reject stale or damaged, and resume independent sources after disconnect',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chip-b05-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let body=csv('2026-11-20'),cal=calendar(['13','19','20']),offline=false,calendarFailure=true;
  const get=async url=>{if(offline)throw Error('連線失敗 ENETDOWN');if(url===TDCC)return body;assert.equal(url,calendarURL('2026-11'));if(calendarFailure)throw Error('HTTP 500');return cal;};
  const open=()=>new OfficialFeed(dir,base,get,()=>new Date('2026-11-30T10:00:00Z'));
  let feed=open(),r=await feed.update();
  assert.equal(r.status,'部分成功');assert(r.weeks['2026-11-20']);assert.deepEqual(r.months,{});
  calendarFailure=false;feed=open();r=await feed.update();assert.equal(r.status,'已是最新');
  assert.equal(r.months['2026-11'].days.at(-1),'2026-11-20');assert.deepEqual(r.weeks,{});
  assert.equal(feed.store('official','2026-11-20').read('official').revision,1);
  body=csv('2026-11-13');assert.match((await feed.update()).message,/忽略舊回應/);
  body=Buffer.concat([csv('2026-11-20'),Buffer.from('\n')]);assert.match((await feed.update()).message,/同期內容變更/);
  body=csv('2026-11-27',['2404']);assert.match((await feed.update()).message,/覆蓋不足/);
  offline=true;assert.equal((await feed.update()).status,'離線');assert.equal(open().latest(),'2026-11-20');
  offline=false;body=csv('2026-11-27');cal=calendar(['13','19','20','27']);r=await feed.update();
  assert.equal(r.status,'有新資料');assert.deepEqual(Object.keys(open().weeks).sort(),['2026-11-20','2026-11-27']);
});
