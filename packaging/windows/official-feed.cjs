'use strict';
const fs=require('node:fs'),path=require('node:path');
const {LocalStore}=require('./storage.cjs');
const {TDCC,calendarURL,parseWeek,parseMonth,taipei}=require('./tdcc.cjs');

async function download(url) {
  let response;
  try { response=await fetch(url,{signal:AbortSignal.timeout(40000),redirect:'error',headers:{'Cache-Control':'no-cache','User-Agent':'ChipScreener/0.6 (weekly public data)'}}); }
  catch(e) { throw Error('連線失敗 '+(e.cause?.code||e.message)); }
  if (!response.ok) throw Error('官方 HTTP '+response.status);
  const parts=[];let length=0;
  for await (const part of response.body) {
    length+=part.length;if(length>16*1024*1024) throw Error('回應過大');parts.push(part);
  }
  return Buffer.concat(parts);
}
const nextMonth = m => new Date(Date.UTC(+m.slice(0,4),+m.slice(5),1)).toISOString().slice(0,7);
class OfficialFeed {
  constructor(root,base,request=download,clock=()=>new Date()) {
    this.root=root;this.base=base;this.request=request;this.clock=clock;
    this.weeks={};this.months={};this.notes=[];
    for (const [kind,pattern,target] of [['official',/^\d{4}-\d\d-\d\d$/,this.weeks],['calendar',/^\d{4}-\d\d$/,this.months]]) {
      const dir=path.join(root,kind);
      for(const key of fs.existsSync(dir)?fs.readdirSync(dir).filter(x=>pattern.test(x)):[]) {
        const rec=this.store(kind,key).read(kind);
        if(rec.value && (rec.value.day||rec.value.month)===key) target[key]=rec.value;
        if(rec.damaged) this.notes.push(key+(rec.slot?' 已讀有效副本':' 所有副本待復原'));
      }
    }
  }
  store(kind,key) {return new LocalStore(path.join(this.root,kind,key));}
  latest() {return [...Object.keys(this.base.hashes),...Object.keys(this.weeks)].sort().at(-1);}
  initial() {return {weeks:this.weeks,months:this.months,notes:this.notes};}
  async checkWeek() {
    const bytes=await this.request(TDCC);
    const week=parseWeek(bytes,this.base.universe,taipei(this.clock()));
    const latest=this.latest(),day=week.day;
    if (day<latest) throw Error('忽略舊回應 '+day+'，已保存 '+latest);
    if (day===latest) {
      if ((this.weeks[day]?.quality.sha256||this.base.hashes[day])!==week.quality.sha256) throw Error(day+' 同期內容變更，保留已驗證版本待核');
      return {message:'已是最新 '+day};
    }
    const receipt=this.store('official',day).save('official',week);
    this.weeks[day]=week;
    return {week,message:'有新資料 '+day+(receipt.redundant?'':'（備份寫入失敗）')};
  }
  async checkCalendar(changed) {
    let month=Object.keys(this.months).sort().at(-1)||this.base.sessions.at(-1).slice(0,7);
    const today=taipei(this.clock()).slice(0,10);
    for (; month<=today.slice(0,7); month=nextMonth(month)) {
      const old=this.months[month]?.days || this.base.sessions.filter(d=>d.startsWith(month));
      const record=parseMonth(await this.request(calendarURL(month)),month,taipei(this.clock()),old);
      if (record.days.length>old.length) {
        this.store('calendar',month).save('calendar',record);
        this.months[month]=record;changed[month]=record;
      }
    }
  }
  async update() {
    const months={},errors=[];
    let week,message='';
    try {({week,message}=await this.checkWeek());} catch(e) {errors.push('集保：'+e.message);}
    try {await this.checkCalendar(months);} catch(e) {errors.push('交易日曆：'+e.message);}
    const status=errors.length===2&&errors.every(e=>e.includes('連線失敗'))?'離線':
      errors.length===2?'失敗':errors.length?'部分成功':week?'有新資料':'已是最新';
    return {weeks:week?{[week.day]:week}:{},months,status,message:[message,...errors].filter(Boolean).join('｜'),checked:taipei(this.clock())};
  }
}
module.exports={OfficialFeed,download};
