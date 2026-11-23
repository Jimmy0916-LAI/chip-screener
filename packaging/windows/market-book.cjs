'use strict';
const fs=require('node:fs'),path=require('node:path');
const {LocalStore}=require('./storage.cjs');
const {download}=require('./official-feed.cjs');
const {taipei}=require('./tdcc.cjs');
const {venues,sources,historyURL,datedURL,parseLatest,parseHistory,parseDated,codeOK,isoDate,sha}=require('./market-data.cjs');
const monthAfter=m=>new Date(Date.UTC(+m.slice(0,4),+m.slice(5),1)).toISOString().slice(0,7);
const decode=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
class MarketBook {
  constructor(root,sessions,request=url=>download(url,95000),clock=()=>new Date()){
    this.root=root;this.sessions=sessions;this.request=request;this.clock=clock;this.pending=new Map();
    this.lists={};this.prices={TWSE:{},TPEx:{}};this.closeDates={};this.status={};
    for(const v of venues) {
      for(const k of ['list','day']){
        const records=this.keys(v,k);if(k==='list'&&records.length)this.lists[v]=this.read(v,k,records.at(-1));
        if(k==='day')for(const day of records){const p=this.read(v,k,day);if(p)this.addDay(p);}
      }
      for(const code of this.keys(v,'history')){const m=this.keys(v,'history',code).at(-1);if(!m)continue;
        const rec=this.read(v,'history',path.join(code,m));if(rec)this.noteClose(code,Object.keys(rec.rows).sort().at(-1));}
    }
  }
  keys(v,k,sub=''){const dir=path.join(this.root,v,k,sub);return fs.existsSync(dir)?fs.readdirSync(dir).sort():[];}
  store(v,k,key){return new LocalStore(path.join(this.root,v,k,key));}
  read(v,k,key){return this.store(v,k,key).read('market').value;}
  noteClose(c,d){if(d && (!this.closeDates[c]||this.closeDates[c]<d))this.closeDates[c]=d;}
  addDay(p){this.prices[p.venue][p.day]=p;for(const c of Object.keys(p.rows))this.noteClose(c,p.day);}
  summary(){
    const latest={},receipts={};
    for(const venue of venues){
      latest[venue]=Object.keys(this.prices[venue]).sort().at(-1)||null;
      const price=this.prices[venue][latest[venue]];
      receipts[venue]=[this.lists[venue],price].filter(Boolean).map(({kind,day,url,hash,fetched})=>({kind,day,url,hash,fetched}));
    }
    return {lists:this.lists,latest,receipts,closeDates:this.closeDates,status:this.status};
  }
  once(key,task){if(!this.pending.has(key))this.pending.set(key,task().finally(()=>this.pending.delete(key)));return this.pending.get(key);}
  async packet(v,k,url,parse){
    const bytes=await this.request(url),fetched=taipei(this.clock());return {venue:v,kind:k,url,hash:sha(bytes),fetched,...parse(decode(bytes),fetched)};
  }
  commitDay(p){
    const old=this.prices[p.venue][p.day];
    if(old){if(old.hash!==p.hash && Object.entries(old.rows).some(([c,row])=>JSON.stringify(p.rows[c])!==JSON.stringify(row)))throw Error(p.day+' 已存行情與回應衝突，保留原版');return;}
    this.store(p.venue,'day',p.day).save('market',p);this.addDay(p);
  }
  async sync(v,k){
    if(!venues.includes(v)||!['list','day'].includes(k))throw Error('市場或來源錯誤');
    return this.once(v+k,async()=>{
      const errors=[];
      try {
        const p=await this.packet(v,k,sources[v][k],(data,now)=>parseLatest(data,v,k,now));
        const last=k==='list'?this.lists[v]?.day:Object.keys(this.prices[v]).sort().at(-1);
        if(last&&p.day<last)throw Error('回應日期倒退至 '+p.day);
        if(k==='list'){
          if(this.lists[v]?.hash!==p.hash){this.store(v,k,p.day).save('market',p);this.lists[v]=p;}
        }else this.commitDay(p);
      }catch(e){errors.push(e.message);}
      if(k==='day'){
        for(const day of this.sessions().filter(d=>d>'2026-11-19'&&!this.prices[v][d])){
          try{const p=await this.packet(v,k,datedURL(v,day),data=>parseDated(data,v,day));this.commitDay(p);}
          catch(e){errors.push(day+' '+e.message);}
        }
      }
      this.status[v+k]=errors.length?'保留成功資料｜'+errors.join('；'):'已核對';
      return this.summary();
    });
  }
  bars(v,code,start,end){
    const out={};
    for(const [day,p] of Object.entries(this.prices[v])){
      if(day>=start&&day<=end&&p.rows[code])out[day]={p:p.rows[code],known:p.fetched,hash:p.hash,url:p.url};
    }
    for(let month=start.slice(0,7);month<=end.slice(0,7);month=monthAfter(month)){
      const packet=this.read(v,'history',path.join(code,month));if(!packet)continue;
      for(const [d,x] of Object.entries(packet.rows))if(d>=start&&d<=end&&(!out[d]||x.known<out[d].known))out[d]={...x,url:packet.url};
    }
    return out;
  }
  async history(v,code,start,end,refresh){
    if(!venues.includes(v)||!codeOK(code)||isoDate(start)!==start||isoDate(end)!==end||end<start||start<'1990-01-01'||end>taipei(this.clock()).slice(0,10))throw Error('不支援的股票或日期');
    const errors=[];
    if(refresh)for(let m=start.slice(0,7);m<=end.slice(0,7);m=monthAfter(m)){
      try{await this.once(v+code+m,async()=>{
        const key=path.join(code,m),old=this.read(v,'history',key);
        if(refresh!=='retry'&&old&&old.fetched.slice(0,7)>m)return;
        const url=historyURL(v,code,m),packet=await this.packet(v,'history',url,(data,now)=>({rows:parseHistory(data,v,code,m,now)}));
        if(old?.hash===packet.hash)return;
        const rows={...old?.rows};
        for(const [day,p] of Object.entries(packet.rows)){
          if(rows[day]&&JSON.stringify(rows[day].p)!==JSON.stringify(p))throw Error(day+' 原價與已存版本衝突');
          rows[day]||={p,known:packet.fetched,hash:packet.hash};
        }
        this.store(v,'history',key).save('market',{...packet,rows});
        this.noteClose(code,Object.keys(rows).sort().at(-1));
      });}catch(e){errors.push(m+' '+e.message);}
    }
    return {bars:this.bars(v,code,start,end),errors,last:this.closeDates[code]};
  }
}
module.exports={MarketBook};
