'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseHistory,parseLatest,sources}=require('./market-data.cjs');
const {MarketBook}=require('./market-book.cjs');
const now='2026-11-23T16:00:00+08:00';
test('TPEx reported lots, Gregorian and ROC dates, gaps and invalid OHLC',()=>{
  const table={title:'6488 環球晶',fields:['日 期','成交張數','開盤','最高','最低','收盤'],data:[['115/11/06',12,10,13,8,12],['115/11/09',0,'---','---','---','---']]};
  const d={stat:'ok',tables:[table]};assert.deepEqual(parseHistory(d,'TPEx','6488','2026-11',now),{'2026-11-06':[10,13,8,12,12000]});
  assert.throws(()=>parseHistory(d,'TPEx','2404','2026-11',now),/代號/);
  table.data[0][3]=7;assert.throws(()=>parseHistory(d,'TPEx','6488','2026-11',now),/OHLC/);
});
test('separate markets persist, deduplicate and keep last good prices on failure',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'chip-market-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  let bad=false;
  const fetch=async url=>{
    if(url===sources.TPEx.day||bad)throw Error('HTTP 503');
    const data=Array.from({length:450},(_,i)=>({Code:String(1100+i),Date:'1151120',OpeningPrice:12,HighestPrice:13,LowestPrice:10,ClosingPrice:11,TradeVolume:1500}));
    return Buffer.from(JSON.stringify(data));
  };
  const make=()=>new MarketBook(dir,()=>[],fetch,()=>new Date(now));const book=make();
  await Promise.all([book.sync('TWSE','day'),book.sync('TPEx','day')]);
  assert.equal(book.summary().latest.TWSE,'2026-11-20');assert.match(book.status.TPExday,/503/);
  await book.sync('TWSE','day');assert.equal(book.store('TWSE','day','2026-11-20').read('market').revision,1);
  bad=true;const again=make();await again.sync('TWSE','day');
  assert.deepEqual(again.bars('TWSE','1101','2026-11-19','2026-11-23')['2026-11-20'].p,[12,13,10,11,1500]);
});
