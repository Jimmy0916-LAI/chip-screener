let market=window.marketFeed?.read()||{lists:{},latest:{},closeDates:{},status:{}};
const marketBusy=new Set(), chartCache=new Map();
function stockVenue(code){
  for(const v of ['TWSE','TPEx'])if(market.lists[v]?.rows[code])return v;
  return D.stocks[code]?.[1];
}
function marketName(code){return market.lists[stockVenue(code)]?.rows[code]||D.stocks[code]?.[0]||code;}
function lastCloseDate(code){
  return [market.closeDates[code],code==='2404'?D.daily2404.at(-1)?.[0]:null].filter(Boolean).sort().at(-1);
}
function marketStatus(){
  return '<div id="marketStatus" class="card"><h3>上市櫃名單與日行情</h3>'+['TWSE','TPEx'].map(v=>{
    const names=market.lists[v];
    return '<div class="feature"><div><b>'+v+'</b><small>名單 '+(names?esc(names.day)+' · '+fmt(Object.keys(names.rows).length)+' 檔':'尚未取得')+'　收盤 '+esc(market.latest[v]||'尚未取得')+'</small><small>'+esc(['list','day'].map((k,i)=>(i?'行情':'名單')+'：'+(marketBusy.has(v+k)?'更新中':market.status[v+k]||'待檢查')).join('｜'))+'</small></div><button class="btn sm" data-retry-market="'+v+'">重試 '+v+'</button></div>';
  }).join('')+'<details><summary>官方來源與取得紀錄</summary>'+Object.entries(market.receipts||{}).flatMap(([v,rs])=>rs.map(r=>'<p class="mini">'+esc(v+' '+(r.kind==='day'?'日行情':'名單')+' '+r.day+'｜取得 '+r.fetched)+'<br>'+esc(r.url)+'<br>SHA-256 '+esc(r.hash)+'</p>')).join('')+'</details></div>';
}
function paintMarket(){
  if(state.page==='data'&&$('#marketStatus'))$('#marketStatus').outerHTML=marketStatus();
  if(state.page==='home'&&$('#watchlist'))$('#watchlist').outerHTML=watchlist();
  if(state.page==='stock'&&$('#symbols'))$('#symbols').innerHTML=symbolOptions();
}
function symbolOptions(){return Object.entries(market.lists).flatMap(([v,x])=>Object.entries(x?.rows||{}).map(([c,n])=>'<option value="'+c+'">'+esc(n+' '+v)+'</option>')).join('');}
async function refreshMarket(v,k){
  if(!window.marketFeed||marketBusy.has(v+k))return;
  marketBusy.add(v+k);paintMarket();
  try {
    const next=await window.marketFeed.update(v,k);
    market={...next,closeDates:{...market.closeDates,...next.closeDates}};
    if(k==='day'&&state.page==='stock'&&state.overlay&&stockVenue(state.stock)===v)ensureOverlay(true);
  }catch(e){market.status[v+k]=e.message;}
  finally{marketBusy.delete(v+k);paintMarket();}
}
function allMarkets(){for(const v of ['TWSE','TPEx'])for(const k of ['list','day'])refreshMarket(v,k);}
function plotDays(){
  const all=dates(),cut=state.asOf||evidenceTime(state.win);
  const ds=(state.manualWeek||state.asOf)?all.filter(d=>d<=state.win && D.observed[d]&&Date.parse(D.observed[d])<=Date.parse(cut)):all;
  return state.chartRange==='recent'?ds.slice(-3):ds;
}
function chartRequest(){
  const ds=plotDays(),code=state.stock,v=stockVenue(code),start=ds[0],end=ds.at(-1);
  return {ds,code,v,start,end,key:[v,code,start,end].join(':')};
}
function redrawChart(key){
  if(state.page!=='stock'||!state.overlay||chartRequest().key!==key||!$('#combinedPlot'))return;
  $('#combinedPlot').innerHTML=alignedPlot(state.stock,state.bands.length?state.bands:[applied.band]);
}
async function ensureOverlay(force=false){
  if(!state.overlay||state.page!=='stock'||!window.marketFeed)return;
  const {code,v,start,end,key}=chartRequest();
  if(!start||!['TWSE','TPEx'].includes(v))return;
  const last=chartCache.get(key);
  if(last?.busy||(last&&!force))return;
  const entry={bars:last?.bars||{},errors:[],busy:true};chartCache.set(key,entry);redrawChart(key);
  try {
    for(const refresh of [false,true]){
      const response=await window.marketFeed.history(v,code,start,end,refresh&&force?'retry':refresh);
      Object.assign(entry,response);
      if(response.last)market.closeDates[code]=response.last;
      redrawChart(key);
    }
  }catch(e){entry.errors=[e.message];}
  finally{entry.busy=false;redrawChart(key);}
}
function alignedPlot(code,bands){
  const {ds,key,v}=chartRequest();if(!ds.length)return '<div class="empty">截止時點沒有可用的集保統計日。</div>';
  const overlay=!!state.overlay,cache=chartCache.get(key),from=Date.parse(ds[0]),to=Date.parse(ds.at(-1)),oneDay=86400000;
  const W=820,H=258,L=57,R=overlay?69:24,T=25,B=220,pw=W-L-R;
  const X=date=>L+(to===from ? .5 :(Date.parse(date)-from)/(to-from))*pw;
  const cutoff=state.manualWeek||state.asOf?Date.parse(state.asOf||evidenceTime(state.win)):Infinity;
  const bars=overlay?Object.entries(cache?.bars||{}).filter(([d,b])=>d>=ds[0]&&d<=ds.at(-1)&&Date.parse(b.known)<=cutoff).sort(([a],[b])=>a.localeCompare(b)):[];
  const pct=ds.flatMap(d=>bands.map(b=>vector(code,d,b)?.pct)).filter(Number.isFinite);
  function scale(values,minPad){const lo=values.length?Math.min(...values):0,hi=values.length?Math.max(...values):1,pad=Math.max(minPad,(hi-lo)*.1);return y=>B-(y-lo+pad)/(hi-lo+2*pad)*(B-T);}
  const Y=scale(pct,.4),prices=bars.flatMap(([,b])=>[b.p[1],b.p[2]]),P=scale(prices,.1);
  const ticks=(arr,y,right)=>{if(!arr.length)return '';const lo=Math.min(...arr),hi=Math.max(...arr);return [...new Set([lo,(hi+lo)/2,hi])].map(n=>'<text class="axis" text-anchor="'+(right?'start':'end')+'" x="'+(right?W-R+6:L-6)+'" y="'+(y(n)+3)+'">'+fmt(n,2)+'</text>').join('');};
  const width=Math.min(8,.58*pw/Math.max(1,(to-from)/oneDay));
  const candles=bars.map(([d,b])=>{
    const [o,h,l,c]=b.p,x=X(d),color=c>=o?'#ef8d77':'#5bbaa1';
    return '<g data-bar="'+d+'" data-ohlc="'+b.p.slice(0,4).join(',')+'" data-x="'+x+'"><title>'+esc(d+' 原價｜開 '+o+' 高 '+h+' 低 '+l+' 收 '+c+'｜已證可用 '+b.known)+'</title><line x1="'+x+'" x2="'+x+'" y1="'+P(h)+'" y2="'+P(l)+'" stroke="'+color+'"/><rect x="'+(x-width/2)+'" y="'+Math.min(P(o),P(c))+'" width="'+width+'" height="'+Math.max(.8,Math.abs(P(c)-P(o)))+'" fill="'+color+'"/></g>';
  }).join('');
  const series=bands.map(b=>{
    const chunks=[],dots=[];let prev='',points=[];
    for(const d of ds){const val=vector(code,d,b);
      if(!val||!prev||monday(d)-monday(prev)!==7){if(points.length)chunks.push(points);points=[];}
      if(val){const x=X(d),y=Y(val.pct);points.push(x+','+y);dots.push('<circle data-stat="'+d+'" cx="'+x+'" cy="'+y+'" r="4" fill="'+COLORS[b]+'"><title>'+esc(code+'｜統計日 '+d+'｜'+b+' 張 '+fmt(val.pct,5)+'%｜已證可用 '+(D.observed[d]||'公布時點待證'))+'</title></circle>');}
      prev=val?d:'';
    }
    if(points.length)chunks.push(points);
    return chunks.map(c=>'<polyline data-band-line="'+b+'" points="'+c.join(' ')+'" fill="none" stroke="'+COLORS[b]+'" stroke-width="2.5"/>').join('')+dots.join('');
  }).join('');
  const ticksX=[...new Set([0,.25,.5,.75,1].map(f=>new Date(from+Math.round((to-from)/oneDay*f)*oneDay).toISOString().slice(0,10)))].map(d=>'<text class="axis" text-anchor="middle" x="'+X(d)+'" y="244">'+d.slice(5)+'</text>').join('');
  const chart='<svg class="plot" role="img" aria-label="'+code+' 集保持股比例與台北日期軸" viewBox="0 0 '+W+' '+H+'"><rect class="plot-bg" x="'+L+'" y="'+T+'" width="'+pw+'" height="'+(B-T)+'"/><text class="axis" x="6" y="15">持股 %</text>'+(overlay?'<text class="axis" x="'+(W-R)+'" y="15">原價 元</text>':'')+ticks(pct,Y,false)+ticks(prices,P,true)+candles+series+ticksX+'</svg>';
  const reasons=[];if(!pct.length)reasons.push('本區間缺少該股集保資料');
  if(overlay){if(!v)reasons.push('尚無可核對的上市櫃市場');else if(cache?.busy||!cache)reasons.push('讀取官方行情中');
    if(Number.isFinite(cutoff))reasons.push('只顯示截止時點 '+(state.asOf||evidenceTime(state.win))+' 已證可用的資料');
    if(!bars.length&&!cache?.busy)reasons.push('區間內沒有可用日 K');reasons.push(...(cache?.errors||[]));
    const days=new Set(bars.map(([d])=>d)),missing=D.sessions.filter(d=>d>=ds[0]&&d<=ds.at(-1)&&!days.has(d));
    if(!cache?.busy&&missing.length)reasons.push('缺少可用日 K '+missing.length+' 日（'+missing.slice(0,4).join('、')+(missing.length>4?' 等':'')+'）');}
  return chart+'<p class="footnote">台北日期｜集保點採統計日，游標可查已證可用時點。'+(overlay?'日 K 為未復權成交原價；休市與缺值留白。櫃買個股月報成交量採原報張數。':'')+esc(reasons.join('｜'))+'</p>'+(overlay?'<button id="retryBars" class="btn sm">重試個股行情</button>':'');
}
