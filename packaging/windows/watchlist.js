let pins=window.desktopStore.read('pins').value||[];
function pinButton(code) {
  return '<button class="btn sm" data-pin="'+esc(code)+'" aria-pressed="'+pins.includes(code)+'">'+(pins.includes(code)?'取消釘選':'釘選')+'</button>';
}
function togglePin(code) {
  if(!/^\d{4}$/.test(code)) return;
  const next=pins.includes(code)?pins.filter(x=>x!==code):[...pins,code];
  try {persist('pins',next);pins=next;render();}catch(e){toast(e.message);}
}
function watchlist() {
  const cards=pins.map(code=>{
    const day=dates().filter(d=>D.series[d]?.[code]).at(-1);
    const close=lastCloseDate(code);
    return '<div class="feature"><div><button class="btn sm" data-stock="'+code+'">'+esc(ticker(code))+'</button><small>籌碼 '+esc(day||'無資料')+'　收盤 '+esc(close||'無資料')+'</small></div>'+pinButton(code)+'</div>';
  }).join('');
  return '<div class="card" id="watchlist"><h3>自選股</h3>'+(cards||'<button class="btn" data-nav="screen">從篩選結果釘選股票</button>')+'</div>';
}
function lastCloseDate(code){return code==='2404'?D.daily2404.at(-1)?.[0]:null;}
const sortTips={gain:'按累計持股占比增幅（百分點）從大到小排列。',name:'按四碼股票代號從小到大排列。',market:'按市場英文代碼從小到大排列（TPEx、TWSE）。'};
function fieldControl(id,label,tip,options,value) {
  return '<div class="filter-field"><div><label for="'+id+'">'+label+'</label> <button type="button" class="help-dot" aria-label="'+label+'說明" aria-describedby="'+id+'Tip">?</button><span role="tooltip" id="'+id+'Tip">'+esc(tip)+'</span></div><select id="'+id+'">'+options.map(([k,v])=>'<option value="'+k+'" '+(k===value?'selected':'')+'>'+v+'</option>').join('')+'</select></div>';
}
function screenControls(){
  return fieldControl('filterPass','顯示結果','全部包含固定母體內所有股票。通過及未通過均已有足夠資料；資料不足／待證表示無法判定。',[['all','全部'],['pass','通過'],['miss','未通過'],['unknown','資料不足／待證']],state.filter)+
    fieldControl('sortBy','排序方式',sortTips[state.sort]+' 缺值排在末尾，同值依代號排序。',[['gain','增幅最高'],['name','代號順序'],['market','市場排序']],state.sort);
}
function screenOrder(a,b){
  const key={name:'code',market:'market',gain:'gain'}[state.sort];
  const empty=x=>x==null||x===''||x==='?'||(key==='gain'&&!Number.isFinite(x));
  const av=a[key],bv=b[key];
  if(empty(av)!==empty(bv))return empty(av)?1:-1;
  const cmp=empty(av)?0:key==='gain'?bv-av:String(av).localeCompare(String(bv),'en');
  return cmp||a.code.localeCompare(b.code);
}
