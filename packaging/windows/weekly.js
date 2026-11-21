// Statistical weeks and knowledge times are independent inputs. All consumers use this engine.
const tradingWeeks = new Map();
for (const day of D.sessions) tradingWeeks.set(monday(day),day);
const weekEnds = [...tradingWeeks.values()];
function nextOpen(known) {
  const stamp = Date.parse(known);
  const day = D.sessions.find(d => Date.parse(d+'T09:00:00+08:00') > stamp);
  return day && stamp >= Date.parse(D.sessions[0]+'T00:00:00+08:00') ? day+' 09:00' : null;
}
function evidenceTime(end) {
  return D.observed[end] || end+'T13:30:00+08:00';
}
function evaluation(cfg,end=state.win,asOf=state.asOf||evidenceTime(end)) {
  const index = weekEnds.indexOf(end);
  const dates = index < 0 ? [] : weekEnds.slice(Math.max(0,index-cfg.weeks),index+1);
  const context = {cfg,end,asOf,dates};
  if (!Number.isFinite(Date.parse(asOf))) context.issue='缺少可驗證的評估時點';
  else if (!D.observed[end] && D.series[end]) context.issue=end+' 公布時點待證';
  else if (index<0 || end >= D.sessions.at(-1)) context.issue=end+' 週末交易日曆待核';
  else if (dates.length!==cfg.weeks+1) context.issue='可驗證交易週不足';
  else {
    for (const d of dates) {
      if (!D.series[d]) { context.issue=d+' 缺週'; break; }
      if (!D.observed[d] || !Number.isFinite(Date.parse(D.observed[d]))) { context.issue=d+' 公布時點待證'; break; }
      if (Date.parse(D.observed[d])>Date.parse(asOf)) { context.issue=d+' 截止時尚無公開證據'; break; }
    }
  }
  if (!context.issue) {
    context.knownDate=dates.map(d=>D.observed[d]).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
    context.eligible=nextOpen(context.knownDate);
  }
  return context;
}
function vector(code,date,band) {
  const row=D.series[date]?.[code],i=BAND_NAMES.indexOf(band);
  return row && i>=0 ? {den:row[0],holders:row[1],shares:row[2+i],owner:row[6+i],pct:100*row[2+i]/row[0]} : null;
}
function weeklySignal(code,ctx) {
  const {cfg,dates,knownDate,eligible}=ctx;
  const pending=reason=>({status:'資料不足',reason,pass:false,insufficient:true});
  if(ctx.issue) return pending(ctx.issue);
  const values=dates.map(day=>vector(code,day,cfg.band));
  for(const [i,v] of values.entries()) {
    const d=dates[i];
    if(!v) return pending(d+' '+(D.issues[d]?.[code] || '股票缺少完整級距'));
    if(v.den<=0 || v.holders<=1 || v.shares<0 || v.shares>v.den) return pending(d+' 股數、分母或總戶數待核');
    if(i && Math.abs(v.den-values[i-1].den)*100>values[i-1].den) return pending(d+' 分母異動超過 1%，公司行動待核');
  }
  const delta=values.slice(1).map((v,i)=>v.pct-values[i].pct);
  const deltaShares=values.slice(1).map((v,i)=>v.shares-values[i].shares);
  const gain=values.at(-1).pct-values[0].pct;
  let status='通過';
  if(delta.some(v=>v<=0)) status='比例未連升';
  else if(cfg.needShares && deltaShares.some(v=>v<=0)) status='比例增、股數未增';
  else if(delta.some(v=>v+1e-10<cfg.weeklyMin)) status='每週增幅不足';
  else if(gain+1e-10<cfg.minPp) status='累計門檻不足';
  else if(cfg.needPeak || cfg.needPrice) return pending('複合條件尚無可驗證資料');
  return {status,pass:status==='通過',insufficient:false,reason:status==='通過'?'週增持算術條件達標':status,
    values,delta,deltaShares,gain,knownDate,eligible};
}
function scan(cfg=applied,ctx=evaluation(cfg)) {
  return D.universe.map(code=>({code,name:D.stocks[code][0],market:D.stocks[code][1],...weeklySignal(code,ctx)}));
}
function tally(rows) {
  return {all:rows.length,pass:rows.filter(r=>r.pass).length,unknown:rows.filter(r=>r.insufficient).length};
}
function comparison() {
  const a=evaluation(applied), b=evaluation(draft,a.end,a.asOf);
  return {a,b,rows:D.universe.map(code=>({code,name:D.stocks[code][0],a:weeklySignal(code,a),b:weeklySignal(code,b)}))};
}
