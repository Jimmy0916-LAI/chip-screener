'use strict';
const os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {MarketBook}=require('../windows/market-book.cjs');
const {venues,sources,parseLatest}=require('../windows/market-data.cjs');
const {download}=require('../windows/official-feed.cjs');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'markets-'));
async function main(){
  const requests=new Map();
  const get=url=>{if(!requests.has(url))requests.set(url,download(url,95000));return requests.get(url);};
  const book=new MarketBook(root,()=>['2026-11-20','2026-11-23'],get);
  await Promise.all(venues.flatMap(v=>['list','day'].map(async k=>{
    await book.sync(v,k);console.log('market-sync',v,k,book.status[v+k],Object.keys(book.lists[v]?.rows||{}).length,Object.keys(book.prices[v]));
    const data=JSON.parse((await get(sources[v][k])).toString('utf8').replace(/^\uFEFF/,''));
    const failures=[];
    for(const row of data){
      try{parseLatest([row],v,k,'2099-11-23',0);}catch(e){if(failures.length<8)failures.push([e.message,row]);}
    }
    console.log('row exceptions',v,k,JSON.stringify(failures));
  })));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
