'use strict';
const {createHash} = require('node:crypto');

const TDCC = 'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5';
const calendarURL = month => 'https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date='+month.replace('-','')+'01&response=json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const taipei = date => new Date(date.getTime()+8*3600000).toISOString().replace('Z','+08:00');
function check(ok,message) { if (!ok) throw Error(message); }
function dayISO(str) {
  check(/^\d{4}-\d{2}-\d{2}$/.test(str) && Number.isFinite(Date.parse(str)) && new Date(str).toISOString().slice(0,10)===str,'日期無效 '+str);
  return str;
}
const nat = n => Number.isSafeInteger(n) && n>=0;
function parseWeek(bytes,universe,fetched) {
  const lines = new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim().split(/\r?\n/);
  const fields = lines.shift().split(',').map(s=>s.trim());
  const ix = ['資料日期','證券代號','持股分級','人數','股數','占集保庫存數比例%'].map(s=>fields.indexOf(s));
  check(ix.every(i=>i>=0) && new Set(fields).size===fields.length,'集保欄位缺失或重複');
  const pool = new Set(universe), groups = new Map(), issues={}, adjustments={},rows={};
  let day;
  for (const line of lines) {
    const values=line.split(',');
    check(values.length===fields.length,'集保欄數錯誤');
    const [stamp,code,lv,holders,shares]=ix.map(i=>values[i].trim());
    if (!day) {
      check(/^\d{8}$/.test(stamp),'統計日期格式錯誤');
      day=dayISO(stamp.slice(0,4)+'-'+stamp.slice(4,6)+'-'+stamp.slice(6));
      check(day<=fetched.slice(0,10) && ![0,6].includes(new Date(day).getUTCDay()),'未來或非營業日的統計日期');
    }
    check(stamp===day.replaceAll('-',''),'同份集保檔混有不同日期');
    if (!pool.has(code)) continue;
    if (!groups.has(code)) groups.set(code,new Map());
    const levels=groups.get(code),level=Number(lv);
    if (!/^\d+$/.test(lv)||level<1||level>17||levels.has(level)||![holders,shares].every(s=>/^\d+$/.test(s)&&nat(Number(s)))) {
      issues[code]='重複級距或股數／戶數無效';
    } else levels.set(level,[Number(shares),Number(holders)]);
  }
  for (const code of universe) {
    const g=groups.get(code);
    if (!g || g.size!==17) issues[code] ||= '原表缺股或缺少級距';
    if (issues[code]) continue;
    const [den,count]=g.get(17);
    const sum=(first,col)=>{let total=0;for(let i=first;i<=15;i++) total+=g.get(i)[col];return total;};
    const bands=[0,1].flatMap(col=>[11,12,13,15].map(level=>sum(level,col)));
    if (!den || sum(1,0)-g.get(16)[0]!==den || sum(1,1)!==count || bands.slice(0,4).some(n=>n>den)) {
      issues[code]='股數或戶數與第17級未對帳，待核';continue;
    }
    rows[code]=[den,count,...bands];
    if (g.get(16).some(Boolean)) adjustments[code]=g.get(16);
  }
  const valid=Object.keys(rows).length;
  check(day && valid>=Math.ceil(pool.size*0.95),'集保有效股票覆蓋不足 95%（'+valid+'/'+pool.size+'）');
  return {day,rows,issues,adjustments,observed:fetched,quality:{raw_source:TDCC,sha256:digest(bytes),valid,invalid:pool.size-valid,universe:pool.size,
    fetched,publication:null,validation:'1–17 級日期、股數、戶數與固定母體覆蓋驗證通過'}};
}
function validateOfficial(w) {
  dayISO(w.day);
  const q=w.quality;
  check(q.raw_source===TDCC && /^[a-f0-9]{64}$/.test(q.sha256) && w.observed===q.fetched && Number.isFinite(Date.parse(q.fetched)) && q.publication===null,'官方來源或取得紀錄無效');
  check(Object.keys(w.rows).length===q.valid && Object.keys(w.issues).length===q.invalid && q.valid+q.invalid===q.universe && q.valid>0,'官方快照覆蓋無效');
  for (const r of Object.values(w.rows)) {
    check(Array.isArray(r)&&r.length===10&&r.every(nat)&&r[0]>0,'官方快照數值無效');
    for (const [i,limit] of [[2,r[0]],[6,r[1]]]) check(r[i]<=limit&&r[i]>=r[i+1]&&r[i+1]>=r[i+2]&&r[i+2]>=r[i+3],'官方累計級距無效');
  }
}
function parseMonth(bytes,month,fetched,known) {
  const m=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  check(m.stat==='OK' && m.fields[0]==='日期' && m.fields.includes('成交股數') && m.date===month.replace('-','')+'01' && m.data.length>0,'TWSE 日曆月份或欄位不符 '+month);
  const days=m.data.map(row=>{
    const match=/^(\d{2,3})\/(\d{2})\/(\d{2})$/.exec(row[0]);
    check(match && Number(String(row[1]).replaceAll(',',''))>0,'TWSE 交易日列無效');
    return dayISO((Number(match[1])+1911)+'-'+match[2]+'-'+match[3]);
  });
  check(days.every((d,i)=>d.startsWith(month+'-')&&d<=fetched.slice(0,10)&&(!i||d>days[i-1])) && known.every(d=>days.includes(d)),'TWSE 日曆日期倒退、錯月或缺少已知交易日');
  return {month,days,source:calendarURL(month),sha256:digest(bytes),fetched};
}
function validateCalendar(m) {
  check(/^\d{4}-\d\d$/.test(m.month)&&m.source===calendarURL(m.month)&&/^[a-f0-9]{64}$/.test(m.sha256)&&Number.isFinite(Date.parse(m.fetched)),'日曆來源無效');
  check(m.days.length>0 && m.days.every((d,i)=>dayISO(d).startsWith(m.month+'-')&&(!i||d>m.days[i-1])),'日曆交易日無效');
}
module.exports={TDCC,calendarURL,parseWeek,parseMonth,validateOfficial,validateCalendar,taipei};
