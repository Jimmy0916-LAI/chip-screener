// Official, manually imported and embedded weeks retain separate provenance.
const frozenDays=dates();
const officialWeeks={}, officialMonths={};
let feedBusy=false, feedStatus='上次保存資料', feedMessage='',checkedAt='';
function receiveOfficial(packet) {
  for(const [day,week] of Object.entries(packet.weeks||{})) {
    officialWeeks[day]=week;
    applyWeek(day,week);
    D.issues[day]=week.issues;
    D.adjustments[day]=week.adjustments;
  }
  Object.assign(officialMonths,packet.months);
  if(Object.keys(packet.months||{}).length) {
    D.sessions=[...new Set([...D.sessions,...Object.values(officialMonths).flatMap(m=>m.days)])].sort();
    rebuildWeeks();
  }
}
function feedPanel() {
  const day=[...frozenDays.filter(d=>!Object.hasOwn(savedWeeks,d)),...Object.keys(officialWeeks)].sort().at(-1);
  const last=officialWeeks[day]?.quality;
  const gaps=weekEnds.filter(d=>d>frozenLast && d<day && !D.observed[d]);
  const text=(feedBusy?'檢查中':feedStatus)+(feedMessage?'｜'+feedMessage:'');
  let details='';
  if(state.page==='data') {
    const records=Object.entries(officialWeeks).sort((a,b)=>b[0].localeCompare(a[0]));
    details=records.map(([d,w])=>'<p>'+esc(d+'｜TDCC 1-5｜'+w.quality.valid+' 檔有效，'+w.quality.invalid+' 檔待核｜'+w.quality.validation)+'<br>'+
      esc('來源 '+w.quality.raw_source+'｜SHA-256 '+w.quality.sha256)+'<br>'+esc('取得／已證實可用 '+w.observed+'｜官方首次公布時間待證')+'</p>').join('');
    details+=Object.entries(savedWeeks).sort().map(([d,w])=>'<p>'+esc(d+'｜'+w.quality.raw_source+'｜手動快照，公布時點待證')+'</p>').join('');
    details+='<p>交易日曆截至 '+esc(D.sessions.at(-1))+'（證交所實際成交日期）。</p>';
    if(gaps.length) details+='<p>官方整批檔未取得的統計週：'+esc(gaps.join('、'))+'。個股歷史可由集保查詢，待證期保留缺口。</p>';
  }
  return '<div class="card" id="feedPanel"><div class="toolbar"><b>集保週資料</b><button id="refreshTDCC" class="btn" '+(feedBusy?'disabled':'')+'>'+ (state.page==='data'?'重試集保與日曆':'立即更新')+'</button></div><p id="feedStatus">'+esc(text)+'</p><div>最新已驗證統計日 <b id="feedDay">'+esc(day||'—')+'</b>　目前篩選週 '+esc(state.win||'無可評估窗口')+'</div><div class="mini">最後成功取得 '+esc(last?.fetched||'內建封存資料')+'　最近檢查 '+esc(checkedAt||'—')+'</div>'+details+'</div>';
}
function paintFeed() {
  const panel=document.querySelector('#feedPanel');
  if(panel && ['home','data'].includes(state.page)) panel.outerHTML=feedPanel();
}
async function refreshTDCC() {
  if(feedBusy||!window.officialFeed) return;
  feedBusy=true;paintFeed();
  let changed=false;
  try {
    const packet=await window.officialFeed.update();
    receiveOfficial(packet);
    changed=Object.keys(packet.weeks).length+Object.keys(packet.months).length>0;
    if(changed && !state.manualWeek) useDefaultWeek();
    feedStatus=packet.status;feedMessage=packet.message;checkedAt=packet.checked;
  } catch(e) {feedStatus='失敗';feedMessage=e.message;}
  finally {
    feedBusy=false;
    if(changed && ['home','data','stock','backtest','screen'].includes(state.page)) render();
    else paintFeed();
  }
}
const frozenLast=Object.keys(D.quality).filter(d=>!Object.hasOwn(savedWeeks,d)).sort().at(-1);
if(window.officialFeed) {
  const cached=window.officialFeed.read();
  receiveOfficial(cached);
  feedMessage=cached.notes.join('；');
}
