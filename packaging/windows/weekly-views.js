function wndSelect() {
  const asOf=state.asOf||evidenceTime(state.win);
  const saved=dates();
  const ends=[...new Set([...saved,...weekEnds.filter(d=>d>=saved[0] && d<=saved.at(-1))])].sort();
  return '<label>統計截止週 <select id="windowSelect">'+ends.map(d=>'<option '+(d===state.win?'selected':'')+'>'+d+'</option>').join('')+
    '</select></label> <label>評估時點（台北） <input id="asOf" type="datetime-local" step="1" value="'+esc(asOf.slice(0,19))+'"></label>';
}
function signalTable(code) {
  const ctx=evaluation(applied);
  return '<div class="section"><h2>所選窗口的週訊號</h2></div><div class="card"><div class="toolbar">'+wndSelect()+'</div><p>'+esc(ctx.dates.join(' → '))+'</p>'+
    '<table><thead><tr><th>級距</th><th>每週股數變動（股）</th><th>累計增幅（pp）</th><th>判定與原因</th><th>證據後首個開盤</th></tr></thead><tbody>'+
    BAND_NAMES.map(b=>{const r=weeklySignal(code,{...ctx,cfg:{...applied,band:b}});return '<tr data-signal-band="'+b+'"><td>'+b+' 張</td><td>'+
      (r.deltaShares?.map(n=>fmt(n)).join(' / ')||'—')+'</td><td>'+pp(r.gain)+'</td><td>'+esc(r.status)+' · '+esc(r.reason)+'</td><td>'+esc(r.eligible||'待核')+'</td></tr>';}).join('')+'</tbody></table><p>'+auditNote(code,ctx)+'</p></div>';
}
function compareExport(model) {
  return model.rows.map(x=>({code:x.code,name:x.name,window:model.a.end,as_of:model.a.asOf,
    A_weeks:model.a.cfg.weeks,A_dates:model.a.dates.join('|'),A_state:x.a.status,A_reason:x.a.reason,A_gain_pp:x.a.gain??'',
    B_weeks:model.b.cfg.weeks,B_dates:model.b.dates.join('|'),B_state:x.b.status,B_reason:x.b.reason,B_gain_pp:x.b.gain??'',data_version:D.run}));
}
function backtest() {
  const model=comparison(), rows=model.rows;
  const label=(side,ctx)=>{
    const stats=tally(rows.map(r=>r[side]));
    return '<div class="card" data-summary="'+side+'"><h3>'+side.toUpperCase()+'｜'+ctx.cfg.weeks+' 週</h3><p>'+esc(ctx.dates.join(' → '))+'</p>'+
      '<div>通過 '+fmt(stats.pass)+' · 不足 '+fmt(stats.unknown)+' · 母體 '+fmt(stats.all)+'</div><p>'+esc(ctx.issue||'依逐檔資料核對')+'</p></div>';
  };
  const comparable=rows.filter(r=>!r.a.insufficient&&!r.b.insufficient);
  const selected=rows.find(r=>r.code===(state.compareCode||'2404'));
  return title('回測與設定 A / B 比較','固定 2026-11-13 名單作回溯比較，歷史逐日股票池待證。')+
    '<div class="card"><div class="toolbar">'+wndSelect()+' <button class="btn" data-nav="settings">編輯 B 草稿</button></div></div>'+
    '<div class="grid2 equal">'+label('a',model.a)+label('b',model.b)+'</div>'+
    '<div class="card"><h3>兩側資料足夠的比較</h3><p>可比 '+fmt(comparable.length)+' 檔 · 僅 A 通過 '+fmt(comparable.filter(x=>x.a.pass&&!x.b.pass).length)+
    ' · 僅 B 通過 '+fmt(comparable.filter(x=>x.b.pass&&!x.a.pass).length)+' · 共同通過 '+fmt(comparable.filter(x=>x.a.pass&&x.b.pass).length)+'</p>'+
    '<div class="toolbar"><label>逐檔核對 <input id="compareCode" value="'+esc(state.compareCode||'2404')+'"></label><button class="btn" id="exportCompare">匯出全母體 A/B CSV</button></div>'+
    (selected?'<p id="compareResult">'+esc(selected.code+' '+selected.name+'｜A '+selected.a.status+' · '+selected.a.reason+'｜B '+selected.b.status+' · '+selected.b.reason)+'</p>':'查無此代號')+
    '</div><div class="notice warn">正式報酬與勝率待歷史行情、公司行動及交易可行性驗收。</div>'+(historicalView()?'':performanceEvidence());
}
function historicalView() {
  return !!state.asOf || state.win!==dates().at(-1);
}
function archiveDays() {
  if(!historicalView()) return dates();
  const asOf=Date.parse(state.asOf||evidenceTime(state.win));
  return dates().filter(d=>d<=state.win && Date.parse(D.observed[d])<=asOf);
}

function auditNote(code,ctx) {
  if(ctx.issue) return esc(ctx.issue);
  return ctx.dates.map(d=>{
    if(D.issues[d]?.[code]) return esc(d+' '+D.issues[d][code]);
    if(!D.adjustments[d] || !D.series[d]?.[code]) return esc(d+' 級距來源待核');
    const adjusted=D.adjustments[d][code] || [0,0];
    return esc(d+' 第16級 '+fmt(adjusted[0])+' 股，'+fmt(adjusted[1])+' 戶');
  }).join(' · ');
}
