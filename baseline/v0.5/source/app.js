'use strict';
const D=INITIAL_DATA;
const BAND_NAMES=['200','400','600','1000'];
const COLORS={'200':'#6fa9fa','400':'#3bd3a2','600':'#edba66','1000':'#b39af8'};
const NAV=[['home','▦','研究總覽'],['screen','◎','全市場篩選'],['stock','⌁','個股研究'],['backtest','◷','回測與比較'],['peak','▥','底峰研究'],['settings','⚙','策略設定'],['data','≡','資料與驗收']];
const DEFAULT={band:'400',weeks:2,minPp:0.2,weeklyMin:0,needShares:true,needPeak:false,needPrice:false,profitDays:20,feeBuy:0.001425,feeSell:0.004425,slip:0.001,warmup:500,grid:1,retention:75,dropPp:5,lowPosition:40,peakMin:15,rangeDays:60};
const localGet=(k,d)=>{try{const s=localStorage.getItem('chipscr_'+k);return s?JSON.parse(s):d}catch(e){return d}};
const localSet=(k,v)=>{try{localStorage.setItem('chipscr_'+k,JSON.stringify(v));return true}catch(e){toast('無法儲存至瀏覽器，設定僅本次有效');return false}};
let applied={...DEFAULT,...localGet('applied',{})};
let draft={...applied,...localGet('draft',{})};
let presets=localGet('presets',[{name:'原始 v0.4',settings:{...DEFAULT}}]);
let state={page:'home',stock:'2404',win:'2026-11-13',bands:['400'],chartRange:'all',dailyRange:60,filter:'pass',query:'',sort:'gain',pageNum:0,selectedDay:'2026-11-13',peakBase:'2026-10-30',peakCompare:'2026-11-19',peakConfig:{...DEFAULT},report:'',windowsReady:[],showList:[],importCount:0};
const $=sel=>document.querySelector(sel);
const esc=x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const fmt=(v,dp=0)=>typeof v==='number'&&isFinite(v)?v.toLocaleString('en-US',{minimumFractionDigits:dp,maximumFractionDigits:dp}):'—';
const pp=(v,n=3)=>typeof v==='number'&&isFinite(v)?`${v>=0?'+':''}${fmt(v,n)}`:'—';
const sign=v=>v>0?'green':v<0?'red':'muted';
const badge=(txt,type='')=>`<span class="tag ${type}">${esc(txt)}</span>`;
const dt=ds=>new Date(ds+'T12:00:00+08:00');
const monday=ds=>{const d=dt(ds),w=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-w);return Math.floor(d.getTime()/86400000)};
const dates=()=>Object.keys(D.series).sort();
function windows(weeks=2){const ds=dates(),ws=[];for(let j=weeks;j<ds.length;j++){const group=ds.slice(j-weeks,j+1);if(group.every((d,i)=>!i||monday(d)-monday(group[i-1])===7))ws.push({end:ds[j],dates:group})}return ws;}
const chosenWin=(cfg=applied)=>windows(cfg.weeks).find(x=>x.end===state.win)||windows(cfg.weeks).at(-1);
const vector=(code,date,band)=>{const row=D.series[date]?.[code],i=BAND_NAMES.indexOf(band);return row&&i>=0?{den:row[0],holders:row[1],shares:row[2+i],owner:row[6+i],pct:100*row[2+i]/row[0]}:null};
function calculate(code,band,window,cfg,asOf=null){
 if(!window)return {status:'缺週',pass:false,reason:'連續集保期不足'};
 const values=window.dates.map(day=>vector(code,day,band));
 if(values.some(v=>!v))return {status:'缺資料',pass:false,reason:'股票缺少完整集保級距'};
 if(values.some(v=>v.den<=0||v.holders<=1||v.shares<0||v.shares>v.den))return {status:'資料異常',pass:false,reason:'股數、總戶數或分母不合理'};
 for(let k=1;k<values.length;k++){if(Math.abs((values[k].den-values[k-1].den)/values[k-1].den)>.01)return {status:'分母異動',pass:false,reason:'股本／集保分母週變動超過 1%，須核查公司行動',values};}
 const delta=values.slice(1).map((v,i)=>v.pct-values[i].pct),deltaShares=values.slice(1).map((v,i)=>v.shares-values[i].shares);
 const gain=delta.reduce((a,b)=>a+b,0);
 const ratio=delta.every(n=>n>0),shares=deltaShares.every(n=>n>0);
 const known=window.dates.every(day=>D.observed[day]);
 const knownDate=known?window.dates.map(day=>D.observed[day]).sort().at(-1):null;
 let status='通過';
 if(!ratio)status='比例未連升';
 else if(cfg.needShares&&!shares)status='比例增、股數未增';
 else if(cfg.weeklyMin>0&&!delta.every(x=>x>=cfg.weeklyMin-1e-10))status='每週增幅不足';
 else if(gain+1e-10<cfg.minPp)status='累計門檻不足';
 else if(cfg.needPeak||cfg.needPrice)status='複合條件待證';
 else if(!known||asOf&&new Date(knownDate)>new Date(asOf))status='公布時點待證';
 const pass=status==='通過',provisional=status==='公布時點待證';
 return {status,pass,provisional,values,delta,deltaShares,gain,shares,ratio,known,knownDate,eligible:knownDate?nextOpen(knownDate):null,
  reason:pass?'比例、股數與門檻達標；全市場公司行動仍待逐檔驗證':status};
}
function nextOpen(known){const s=dt(known.slice(0,10));let d=new Date(s);for(let i=0;i<10;i++){d.setUTCDate(d.getUTCDate()+1);const w=d.getUTCDay();if(w!==0&&w!==6){return d.toISOString().slice(0,10)+' 09:00（假期另核）';}}return null;}
function scan(cfg=applied,win=chosenWin(cfg)){
 if(!win)return [];
 const last=D.series[win.end]||{};
 const rows=[];
 for(const code of Object.keys(last)){
   const info=D.stocks[code]||['名稱未驗證','?'];
   const result=calculate(code,cfg.band,win,cfg);
   rows.push({code,name:info[0],market:info[1],...result});
 }
 return rows;
}
function tally(rows){return {pass:rows.filter(x=>x.pass).length,unknown:rows.filter(x=>['缺資料','分母異動','資料異常','公布時點待證','複合條件待證'].includes(x.status)).length,all:rows.length};}
const ticker=code=>`${esc(code)} <span class="cell-muted">${esc((D.stocks[code]||[''])[0])}</span>`;
function toast(msg){const el=$('#toast');if(!el)return;el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),4200);}
const title=(name,desc,actions='')=>`<div class="pagehead"><div><p class="eyebrow">TAIWAN MARKET / RESEARCH</p><h1>${name}</h1><p class="sub">${desc}</p></div>${actions}</div>`;
const cardhead=(head,detail,act='')=>`<div class="splithead"><div><h3>${head}</h3><div class="mini">${detail}</div></div>${act}</div>`;
const metric=(label,value,foot,cl='')=>`<div class="card metric"><span class="label">${label}</span><div class="value ${cl}">${value}</div><span class="foot">${foot}</span></div>`;
const settingsHint=()=>`<span class="tag">${esc(applied.band)} 張 · ${fmt(applied.minPp,2)} pp · ${applied.weeks} 週</span>`;
function populateNav(){const n=$('#nav'),m=$('#mobilebar');n.innerHTML=NAV.map(([id,ic,name])=>`<button data-nav="${id}" class="${state.page===id?'active':''}"><span class="ico">${ic}</span>${name}</button>`).join('');m.innerHTML=NAV.filter(x=>['home','screen','stock','backtest','settings'].includes(x[0])).map(([id,ic,name])=>`<button data-nav="${id}" class="${state.page===id?'active':''}"><span>${ic}</span>${name.replace('全市場','').replace('研究','')}</button>`).join('');}
function go(page){state.page=page;state.pageNum=0;render();scrollTo({top:0,behavior:'instant'});}
function selectStock(code){state.stock=code;state.page='stock';state.bands=[applied.band];state.selectedDay=state.win;render();scrollTo({top:0,behavior:'instant'});}
function render(){populateNav();$('#crumb').textContent=NAV.find(x=>x[0]===state.page)?.[2]||'研究';const pages={home:home,screen:screen,stock:stock,backtest:backtest,peak:peak,settings:settingsPage,data:dataPage};$('#page').innerHTML=pages[state.page]();attachCharts();}
function wndSelect(cfg=applied){return `<select id="windowSelect" class="select">${windows(cfg.weeks).map(w=>`<option value="${w.end}" ${w.end===state.win?'selected':''}>截至 ${w.end}</option>`).join('')}</select>`;}
function renderTable(rows,more=false){if(!rows.length)return `<div class="empty"><b>沒有符合篩選條件的資料</b>調低門檻或切換歷史窗口，並注意目前只有六期快照。</div>`;
return `<div class="tblwrap"><table><thead><tr><th>代號／名稱</th><th>市場</th><th>級距</th><th>累計增幅</th><th>倒數第二週</th><th>最新一週</th><th>股數變化（股）</th><th>判定</th></tr></thead><tbody>${rows.map(x=>`<tr class="clickable" data-stock="${esc(x.code)}"><td><b>${ticker(x.code)}</b></td><td>${esc(x.market)}</td><td>${applied.band} 張</td><td class="${sign(x.gain)}">${pp(x.gain,3)} pp</td><td>${pp(x.delta?.at(-2),3)}</td><td>${pp(x.delta?.at(-1),3)}</td><td>${x.deltaShares?x.deltaShares.map(v=>(v>=0?'+':'')+fmt(v)).join(' / '):'—'}</td><td>${badge(x.status,x.pass?'good':x.status.includes('待')?'warn':'')}</td></tr>`).join('')}</tbody></table></div>`;}
function home(){const win=chosenWin(),rows=scan(),t=tally(rows),best=rows.filter(x=>x.pass).sort((a,b)=>b.gain-a.gain).slice(0,8);
const a2404=calculate('2404','400',windows(2).find(w=>w.end==='2026-11-13'),applied);
return title('台股籌碼研究總覽','以集保分級股數計算，先找到異動，再辨別證據是否足以支持交易。',`<button class="btn main" data-nav="screen">查看完整篩選結果 →</button>`)+
`<div class="notice warn"><b>研究範圍聲明：</b>已載入六期原始集保全表，可依最新三期篩選約兩千檔上市櫃候選；股票母體採 11/13 行情備份，可能有存活偏差。除漢唐外，逐檔公司行動與正式回測未通過驗收。不是即時報價或買賣訊號。</div>`+
`<div class="metricgrid">${metric('目前候選股票池',fmt(Object.keys(D.stocks).length),'四碼非零開頭、上市櫃行情備份')}${metric('最新窗口通過數',fmt(t.pass),'級距 '+applied.band+' 張 · 門檻 '+fmt(applied.minPp,2)+' pp','green')}${metric('資料／條件待證',fmt(t.unknown),'不列為正式有效進場')}${metric('日 K 已核對',fmt(D.daily2404.length),'漢唐 2404 · 2024–2026')}</div>`+
`<div class="grid2"><div class="card">${cardhead('最新集保增持候選','同一最後週 '+esc(win?.end||'—')+' · 依累計增幅排序',settingsHint())}${best.length?`<div class="tblwrap"><table><thead><tr><th>個股</th><th>增幅</th><th>股數連增</th><th>訊號</th></tr></thead><tbody>${best.map(x=>`<tr class="clickable" data-stock="${x.code}"><td><b>${ticker(x.code)}</b></td><td class="green">${pp(x.gain)} pp</td><td>＋${fmt(x.deltaShares[0])} / ＋${fmt(x.deltaShares[1])}</td><td>${badge('週訊號候選','good')}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">目前參數無通過候選</div>`}<button class="btn ghost sm" data-nav="screen" style="margin-top:15px">展開所有股票 →</button></div>`+
`<div class="card hot">${cardhead('漢唐 2404｜固定驗收案例','2026-10-30 → 11-06 → 11-13',badge('原始數值已驗證','good'))}<div class="feature"><span class="muted">400 張大戶持股比例</span><strong>55.496% → 56.218%</strong></div><div class="statbar"><div><span class="mini">兩週累計</span><strong class="green">+0.721971 pp</strong></div><div><span class="mini">持股變化</span><strong>+796,897 / +579,084 股</strong></div></div><div style="margin-top:18px">${weeklyPlot('2404',['400'], 'all')}</div><p class="footnote">證據最晚可得：2026-11-14 16:15:45；最早觀察開盤：11-16 09:00。不是經績效驗證的進場建議。</p><button class="btn main sm" data-stock="2404">打開漢唐完整分析 →</button></div></div>`+
`<div class="section"><h2>工作流程與交付能力</h2></div><div class="grid2 equal"><div class="card"><div class="feature"><strong>01. 篩選與比較</strong>${badge('可使用','good')}</div><div class="feature"><strong>02. 大戶級距切換與日期明細</strong>${badge('可使用','good')}</div><div class="feature"><strong>03. 本機策略方案與 A/B 訊號比較</strong>${badge('可使用','good')}</div><div class="feature"><strong>04. 全市場正式報酬回測</strong>${badge('待資料驗收','warn')}</div></div><div class="card"><div class="feature"><strong>05. 漢唐日線與成交量</strong>${badge('可使用','good')}</div><div class="feature"><strong>06. 成本分布／底峰探索計算</strong>${badge('研究版','warn')}</div><div class="feature"><strong>07. 跨裝置雲端同步</strong>${badge('尚未部署','warn')}</div><div class="feature"><strong>08. 新資料匯入與 CSV 匯出</strong>${badge('可使用','good')}</div></div></div>`;
}
function screen(){const cfg=applied;const win=chosenWin(cfg);const raw=scan(cfg,win);const t=tally(raw);
const q=state.query.trim().toLowerCase();let rows=raw.filter(r=>(!q||(r.code+' '+r.name).toLowerCase().includes(q)));
if(state.filter==='pass')rows=rows.filter(r=>r.pass);
if(state.filter==='unknown')rows=rows.filter(r=>['分母異動','缺資料','資料異常','公布時點待證','複合條件待證'].includes(r.status));
if(state.filter==='miss')rows=rows.filter(r=>!r.pass);
rows.sort(state.sort==='name'?(a,b)=>a.code.localeCompare(b.code):state.sort==='market'?(a,b)=>a.market.localeCompare(b.market):((a,b)=>(b.gain??-9999)-(a.gain??-9999)));
const limit=40,pages=Math.ceil(rows.length/limit),items=rows.slice(state.pageNum*limit,(state.pageNum+1)*limit);
state.showList=rows;
return title('全市場籌碼篩選','從真實集保原始股數計算，而非展示人工假資料。',`<button class="btn" data-nav="settings">⚙ 調整篩選參數</button>`)+
`<div class="notice">目前母體：${fmt(Object.keys(D.stocks).length)} 檔候選股票。最後週股數有資料：${fmt(t.all)} 檔。<b>注意：</b>來自 2026-11-13 的股票名單，未重建歷史逐日母體，也尚未逐檔完成公司行動核對；篩選通過僅代表算術條件符合。</div>`+
`<div class="metricgrid">${metric('符合現行條件',fmt(t.pass),'通過股數 + 比例 + 門檻','green')}${metric('不符條件',fmt(t.all-t.pass-t.unknown),'明列原因')}${metric('資料／複合條件待證',fmt(t.unknown),'須查證，不當作通過')}${metric('目前觀測截止',win?.end||'—','公布證據與交易開盤分開處理')}</div>`+
`<div class="card">${cardhead('篩選控制台','參數更動只在「策略設定」按套用後影響篩選',settingsHint())}<div class="toolbar"><input id="searchCode" placeholder="搜尋股票代號或名稱" value="${esc(state.query)}" aria-label="股票搜尋"><span class="mini">連續 ${cfg.weeks} 週增持，累計至少 ${fmt(cfg.minPp,2)} 百分點</span>${wndSelect(cfg)}<select id="filterPass"><option value="pass" ${state.filter==='pass'?'selected':''}>只看通過</option><option value="all" ${state.filter==='all'?'selected':''}>全部結果</option><option value="miss" ${state.filter==='miss'?'selected':''}>未通過／待證</option><option value="unknown" ${state.filter==='unknown'?'selected':''}>資料與條件待證</option></select><select id="sortBy"><option value="gain" ${state.sort==='gain'?'selected':''}>增幅最高</option><option value="name" ${state.sort==='name'?'selected':''}>代號順序</option><option value="market" ${state.sort==='market'?'selected':''}>市場排序</option></select><button class="btn sm" id="exportScreener">↓ 匯出結果 CSV</button></div><div class="mini" style="margin-bottom:7px">篩選結果 ${fmt(rows.length)} 筆，每頁 40 筆 · 點擊股票可查看各週原始值</div>${renderTable(items)}<div class="toolbar" style="justify-content:flex-end;margin-top:15px"><button class="btn sm" id="prevPage" ${state.pageNum<=0?'disabled':''}>← 上一頁</button><span class="mini">${pages?state.pageNum+1:0} / ${pages} 頁</span><button class="btn sm" id="nextPage" ${state.pageNum+1>=pages?'disabled':''}>下一頁 →</button></div></div>`;
}
function stock(){const code=state.stock;const info=D.stocks[code]||['未驗證股票名稱','待確認'];const ds=dates().filter(day=>D.series[day]?.[code]);const latest=ds.at(-1);const win=windows(2).find(w=>w.end===state.win)||windows(2).at(-1);
const sigs=BAND_NAMES.map(b=>({band:b,...calculate(code,b,win,{...applied,band:b})}));const chartBand=state.bands.length?state.bands:[applied.band];const model=code==='2404';
const thisPoint=vector(code,state.selectedDay,chartBand[0]);
return title(`個股研究｜${esc(code)} ${esc(info[0])}`,`市場：${esc(info[1])}　·　目前可驗證集保快照 ${ds.length} 期　·　原始股數直接重算`, `<div class="toolbar"><input id="stockCode" placeholder="輸入股票代號" value="${esc(code)}"><button class="btn main" id="goStock">查詢</button></div>`)+
(!ds.length?`<div class="notice warn">沒有此股的集保原始資料；名稱可能來自舊市場名單。請在資料頁匯入可信集保 CSV。</div>`:'')+
`<div class="metricgrid">${metric('最後一次集保資料',latest||'—','缺週時不拼接')}${metric('400 張持股比例',vector(code,latest,'400')?fmt(vector(code,latest,'400').pct,3)+'%':'—','以最新快照的總股數為分母')}${metric('總集保股數',fmt(vector(code,latest,'400')?.den),'股數／戶數分開追蹤')}${metric('400 張戶數',fmt(vector(code,latest,'400')?.owner),'非持股人身分辨識')}</div>`+
`<div class="card">${cardhead('大戶累計持股比例','同一座標對齊；遇缺週折線自動斷開', `<div class="seg"><button data-chart-range="all" class="${state.chartRange==='all'?'on':''}">全部</button><button data-chart-range="recent" class="${state.chartRange==='recent'?'on':''}">近三期</button></div>`)}<div class="legend" style="margin-bottom:8px">${BAND_NAMES.map(b=>`<label><input type="checkbox" data-band="${b}" ${chartBand.includes(b)?'checked':''}><span style="color:${COLORS[b]}">●</span>${b} 張</label>`).join('')}</div>${weeklyPlot(code,chartBand,state.chartRange)}<p class="footnote">選取級距僅改變圖表，並不修改實際選股策略。400 張含千張級距，不能把兩條線相加。</p></div>`+
`<div class="section"><h2>最近三期訊號核對</h2><div class="toolbar" style="margin:0">${wndSelect({...applied,weeks:2})}</div></div><div class="card">${win?`<p class="panelhint">W0 ${win.dates[0]} · W1 ${win.dates[1]} · W2 ${win.dates[2]}。公開／可取得時間以最新固定證據為界。</p>`:''}<div class="tblwrap"><table><thead><tr><th>級距</th><th>W0 比例</th><th>W1 比例</th><th>W2 比例</th><th>Δ1 (pp)</th><th>Δ2 (pp)</th><th>合計 (pp)</th><th>判定</th></tr></thead><tbody>${sigs.map(s=>`<tr><td><b>${s.band} 張</b></td>${(s.values||[0,0,0]).map(v=>`<td>${v?.pct!==undefined?fmt(v.pct,4)+'%':'—'}</td>`).join('')}<td class="${sign(s.delta?.[0])}">${pp(s.delta?.[0])}</td><td class="${sign(s.delta?.[1])}">${pp(s.delta?.[1])}</td><td class="${sign(s.gain)}">${pp(s.gain,5)}</td><td>${badge(s.status,s.pass?'good':'')}</td></tr>`).join('')}</tbody></table></div>${code==='2404'?`<div class="notice good">漢唐 400 張的 2026-11-13 窗口有原始官方核對；獨立驗收結果：+0.721971163 pp、股數 +796,897 / +579,084。11-13 收盤不得提前顯示通過，最早觀察開盤 11-16。</div>`:'<div class="notice warn">此股的週級距股數經原始表完整性檢查，但未取得逐檔公司行動及正式價格績效驗收；不能當作交易建議。</div>'}</div>`+
`<div class="section"><h2>指定週原始股數</h2><span class="mini">股、張、人數、分母與公布證據分開顯示</span></div><div class="card"><div class="toolbar"><select id="daySelect">${ds.map(d=>`<option value="${d}" ${d===state.selectedDay?'selected':''}>${d}</option>`).join('')}</select></div><div class="tblwrap"><table><thead><tr><th>級距</th><th>占比 %</th><th>持有股數</th><th>持有張數</th><th>戶數</th><th>集保總股數</th></tr></thead><tbody>${BAND_NAMES.map(b=>{const v=vector(code,state.selectedDay,b);return `<tr><td>${b} 張以上</td><td>${v?fmt(v.pct,6):'—'}</td><td>${v?fmt(v.shares):'—'}</td><td>${v?fmt(v.shares/1000,3):'—'}</td><td>${v?fmt(v.owner):'—'}</td><td>${v?fmt(v.den):'—'}</td></tr>`}).join('')}</tbody></table></div><div class="footnote">${esc(state.selectedDay)} 最早已知公開證據：${esc(D.observed[state.selectedDay]||'未知，禁止嚴格時點重播')}。不是集保官方實際公布秒數。</div></div>`+
(model?`<div class="section"><h2>日 K 與成交量</h2><div class="seg">${[20,60,120,250].map(x=>`<button data-daily-range="${x}" class="${state.dailyRange===x?'on':''}">${x} 日</button>`).join('')}</div></div><div class="card">${dailyPlot()}<p class="footnote">漢唐 697 個交易日回補資料對帳通過。部分早期行情沒有可驗證的當時公布版本，因此不能直接當成嚴格回測資料。</p><button class="btn sm" data-nav="peak">開啟漢唐底峰研究 →</button></div>`:`<div class="notice warn">目前完整逐日日 K 只驗收漢唐 2404；此股票尚未取得足夠的日行情用於 K 線與正式績效回測。</div>`);
}
function weeklyPlot(code,bands,range){
 let ds=dates(),orig=ds;if(range==='recent')ds=ds.slice(-3);
 const allValues=ds.flatMap(day=>bands.map(b=>vector(code,day,b)?.pct).filter(x=>Number.isFinite(x)));
 if(!allValues.length)return `<div class="empty">沒有可繪製的集保數據</div>`;
 let mn=Math.min(...allValues),mx=Math.max(...allValues),pad=Math.max(0.4,(mx-mn)*.3);mn-=pad;mx+=pad;
 const w=770,h=240,left=50,right=24,top=20,bottom=39,plotW=w-left-right,plotH=h-top-bottom;
 const X=i=>left+(ds.length<=1?0.5:i/(ds.length-1))*plotW,Y=v=>top+(mx-v)/(mx-mn)*plotH;
 const yGrid=[0,.25,.5,.75,1].map(fr=>{let val=mn+(mx-mn)*fr;return `<line class="gridline" x1="${left}" x2="${w-right}" y1="${Y(val)}" y2="${Y(val)}"/><text class="axis" x="${left-7}" y="${Y(val)+3}" text-anchor="end">${fmt(val,1)}%</text>`}).join('');
 const axes=ds.map((day,i)=>`<text class="axis" x="${X(i)}" y="${h-12}" text-anchor="middle">${day.slice(5)}</text>`).join('');
 const lines=bands.map(b=>{
 let chunks=[],chunk=[];
 ds.forEach((day,i)=>{const v=vector(code,day,b);if(chunk.length&&i>0&&(monday(day)-monday(ds[i-1])!==7||!v)){chunks.push(chunk);chunk=[]}if(v)chunk.push([X(i),Y(v.pct)]);else if(chunk.length){chunks.push(chunk);chunk=[]}});if(chunk.length)chunks.push(chunk);
 const path=chunks.map(points=>`<polyline points="${points.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${COLORS[b]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`).join('');
 const circles=ds.map((day,i)=>{const v=vector(code,day,b);return v?`<circle cx="${X(i)}" cy="${Y(v.pct)}" r="${b===bands[0]?'5':'3.5'}" fill="${COLORS[b]}" stroke="#0d1b2e" stroke-width="1.7"><title>${code} ${day} ${b} 張：${fmt(v.pct,6)}%／${fmt(v.shares)} 股／${fmt(v.owner)} 戶</title></circle>`:''}).join('');return path+circles;
 }).join('');
 return `<svg role="img" aria-label="${code} 集保大戶持股比例圖，缺週折線中斷" viewBox="0 0 ${w} ${h}" class="plot"><rect x="${left}" y="${top}" width="${plotW}" height="${plotH}" rx="9" class="plot-bg"/>${yGrid}${lines}${axes}</svg>`;
}
function dailyPlot(){const bars=D.daily2404.slice(-state.dailyRange);const width=775,height=280,marginLeft=52,marginR=13,top=12,priceH=196,volTop=217,volH=35,plotW=width-marginLeft-marginR;
const lowest=Math.min(...bars.map(b=>b[3])),highest=Math.max(...bars.map(b=>b[2])),pad=(highest-lowest)*.1||10;
const Y=p=>top+(highest+pad-p)/(highest-lowest+2*pad)*priceH;
const X=i=>marginLeft+i*plotW/bars.length+plotW/(2*bars.length);
const barW=Math.max(1,Math.min(7,plotW/bars.length*.6));const vmax=Math.max(...bars.map(b=>b[5]));
const marks=bars.map((b,i)=>{const x=X(i),up=b[4]>=b[1],c=up?'#36bf9b':'#f07881';return `<line x1="${x}" x2="${x}" y1="${Y(b[2])}" y2="${Y(b[3])}" stroke="${c}" stroke-width="1.1"/><rect x="${x-barW/2}" y="${Math.min(Y(b[1]),Y(b[4]))}" width="${barW}" height="${Math.max(1,Math.abs(Y(b[1])-Y(b[4])))}" fill="${c}"/><rect x="${x-barW/2}" y="${volTop+volH*(1-b[5]/vmax)}" width="${barW}" height="${volH*b[5]/vmax}" fill="${c}" opacity=".58"><title>${b[0]} 開 ${b[1]} 高 ${b[2]} 低 ${b[3]} 收 ${b[4]} 量 ${fmt(b[5])} 股</title></rect>`}).join('');
const grid=[0,.25,.5,.75,1].map(a=>{const val=lowest-pad+(highest-lowest+2*pad)*a;return `<line class="gridline" x1="${marginLeft}" x2="${width-marginR}" y1="${Y(val)}" y2="${Y(val)}"/><text class="axis" x="${marginLeft-8}" y="${Y(val)+4}" text-anchor="end">${fmt(val,0)}</text>`}).join('');
return `<svg class="plot" viewBox="0 0 ${width} ${height}" role="img" aria-label="漢唐日線開高低收與成交量"><rect class="plot-bg" x="${marginLeft}" y="${top}" width="${plotW}" height="${priceH+volH+10}" rx="7"/>${grid}${marks}<text class="axis" x="${marginLeft}" y="${height-6}">${bars[0]?.[0]}</text><text class="axis" text-anchor="end" x="${width-marginR}" y="${height-6}">${bars.at(-1)?.[0]}</text></svg><div class="statbar"><div><span class="mini">最新收盤（資料日）</span><strong>${fmt(bars.at(-1)?.[4],2)}</strong></div><div><span class="mini">最後交易日</span><strong style="font-size:14px">${bars.at(-1)?.[0]}</strong></div><div><span class="mini">最後成交量</span><strong>${fmt(bars.at(-1)?.[5])}</strong></div></div>`;
}
function backtest(){const A={...applied},B={...draft};const win=chosenWin(A);const wB=windows(B.weeks).find(w=>w.end===win?.end)||windows(B.weeks).at(-1);
const a=scan(A,win),b=scan(B,wB),ta=tally(a),tb=tally(b);const aSet=new Set(a.filter(r=>r.pass).map(x=>x.code)),bSet=new Set(b.filter(r=>r.pass).map(x=>x.code));const onlyA=[...aSet].filter(x=>!bSet.has(x)),onlyB=[...bSet].filter(x=>!aSet.has(x));
const days=D.daily2404;const eventDay=days.findIndex(d=>d[0]==='2026-11-16');const entry=eventDay>=0?days[eventDay]:null;const close=days.at(-1),available=entry&&close&&days.length-1-eventDay;const events=windows(2).filter(w=>w.end==='2026-11-13');const baseSig=calculate('2404','400',events[0],{...DEFAULT});
const settingsDiff=Object.keys(DEFAULT).filter(k=>A[k]!==B[k]).map(k=>`<span class="pill">${esc(k)}：${esc(A[k])} → ${esc(B[k])}</span>`).join(' ');
return title('回測與設定 A / B 比較','同一份凍結版集保資料、同一窗口對照兩套條件。訊號統計≠報酬績效。',`<button class="btn" data-nav="settings">編輯 B 草稿</button>`)+
`<div class="notice warn"><b>正式績效狀態：尚未具備可信歷史資料。</b>現有全市場集保只有六期，並非多年完整公開時點與公司行動紀錄；僅漢唐有 697 日歷史股價，2026-11-16 才出現驗收訊號，距離 11-19 僅 ${available??0} 個已完成後續交易日。禁止將這個短樣本的盈虧率當成策略勝率。</div>`+
`<div class="grid2 equal"><div class="card"><div class="splithead"><h3>A｜目前套用的選股方案</h3>${badge('現行','good')}</div><div class="statbar"><div><span class="mini">通過條件筆數</span><strong class="green">${fmt(ta.pass)}</strong></div><div><span class="mini">篩選母體</span><strong>${fmt(ta.all)}</strong></div></div><div class="feature"><span class="muted">級距／門檻／連升</span><strong>${A.band} 張 · ${fmt(A.minPp,2)}pp · ${A.weeks} 週</strong></div></div><div class="card"><div class="splithead"><h3>B｜未套用的比較草稿</h3>${badge('試算，不改選股')}</div><div class="statbar"><div><span class="mini">通過條件筆數</span><strong class="blue">${fmt(tb.pass)}</strong></div><div><span class="mini">與 A 的筆數差</span><strong class="${sign(tb.pass-ta.pass)}">${pp(tb.pass-ta.pass,0)}</strong></div></div><div class="feature"><span class="muted">級距／門檻／連升</span><strong>${B.band} 張 · ${fmt(B.minPp,2)}pp · ${B.weeks} 週</strong></div></div></div>`+
`<div class="section"><h2>條件差異</h2></div><div class="card"><div class="toolbar" style="margin:0">${settingsDiff||'<span class="muted">A 與 B 的設定目前完全一致。請到策略設定修改 B 草稿。</span>'}</div><div class="statbar"><div><span class="mini">只符合 A</span><strong>${fmt(onlyA.length)}</strong></div><div><span class="mini">只符合 B</span><strong>${fmt(onlyB.length)}</strong></div><div><span class="mini">兩者都符合</span><strong>${fmt([...aSet].filter(x=>bSet.has(x)).length)}</strong></div></div><p class="footnote">對比固定同一最新快照週，變更連升週數時會使用相應的歷史窗口。資料不足、公布時間未知不計入通過。</p><button class="btn sm" id="exportCompare">↓ 匯出 A/B 訊號差異</button></div>`+
`<div class="section"><h2>真正的收益回測驗收狀態</h2></div><div class="card">${cardhead('漢唐 2404｜400 張真實已驗證事件','不是模擬產生的勝率',badge('持有期未成熟','warn'))}<div class="feature"><span>資料可用上界</span><b>2026-11-14 16:15:45</b></div><div class="feature"><span>第三週第一個觀察開盤</span><b>2026-11-16 09:00</b></div><div class="feature"><span>11-16 現有行情開盤</span><b>${entry?fmt(entry[1],2):'缺資料'}</b></div><div class="feature"><span>觀測到的最後交易日</span><b>${close?.[0]}</b></div><div class="feature"><span>已經走完的後續交易日</span><b>${available??0} 日</b></div><div class="feature"><span>預設持有期</span><b>${DEFAULT.profitDays} 個交易日</b></div><div class="notice">正式報酬、勝率、損益比、最大回撤：<b>不可計算</b>（持有期不足，且跨全市場回測缺行情及當時可用性證據）。原始樣本沒有證明漲跌停是否能成交、沒有經股利調整的完整報酬。</div></div>`+
`<div class="section"><h2>接近實用回測還缺什麼</h2></div><div class="grid2 equal"><div class="card"><h3>已具備</h3><p class="help">全市場多期原始集保、按公開時間計算的週訊號、同一公式的 A/B 篩選、個股日行情樣本。</p></div><div class="card"><h3>仍欠缺</h3><p class="help">逐日歷史股票母體、各股日 K 和當時版本、公司行動、5/10/20/40 日已成熟的交易事件、交易可成交性驗證。</p></div></div>`;
}
function modeledDistribution(base,compare,cfg){
 const bars=D.daily2404;const i=bars.findIndex(r=>r[0]===base),j=bars.findIndex(r=>r[0]===compare);
 if(i<0||j<0)return {error:'請選擇有日 K 的日期'};
 if(j<i)return {error:'比較日不能早於基準日'};
 const start=i-cfg.warmup+1;if(start<0)return {error:`需要在基準日前有完整 ${cfg.warmup} 個交易日；目前僅有 ${i+1} 日。`};
 const step=Math.log(1+cfg.grid/100),bins=new Map();let initial=0,baseline=null,basePrice=bars[i][4], events=[];
 function allocate(row,weight){let low=row[3],high=row[2];if(low<=0||high<low)throw Error('非有效價格');
   if(high===low){const k=Math.floor(Math.log(low)/step);bins.set(k,(bins.get(k)||0)+weight);return;}
   const first=Math.floor(Math.log(low)/step),last=Math.floor(Math.log(high)/step);
   for(let k=first;k<=last;k++){
     const boundaryL=Math.exp(k*step),boundaryR=Math.exp((k+1)*step);
     const share=Math.max(0,Math.min(high,boundaryR)-Math.max(low,boundaryL))/(high-low);
     if(share>0)bins.set(k,(bins.get(k)||0)+weight*share);
   }
 }
 try{
  allocate(bars[start],1);initial=1;
  for(let k=start+1;k<=j;k++){
   const row=bars[k],r=row[7];if(!(r>=0&&r<=1))return {error:'存在日換手率不在 0～100% 之間，停止模型'};
   if(row[8])events.push([row[0],row[8]]);
   for(let [n,v] of bins){const a=v*(1-r);if(a<1e-13)bins.delete(n);else bins.set(n,a)}
   initial*=1-r;allocate(row,r);
   if(k===i)baseline=new Map(bins);
  }
  if(i===start)baseline=baseline||new Map(bins);
  if(!baseline)return {error:'基準日未完成計算'};
 }catch(e){return {error:e.message}}
 const current=new Map(bins);
 const minKey=Math.min(...baseline.keys(),...current.keys()),maxKey=Math.max(...baseline.keys(),...current.keys());
 function findPeaks(dist){
  const smooth=k=>((dist.get(k-1)||0)+(dist.get(k)||0)+(dist.get(k+1)||0))/3;
  const peaks=[];
  for(let k=minKey+7;k<=maxKey-7;k++){
   const s=smooth(k);if(s<=0||s<smooth(k-1)||s<=smooth(k+1))continue;
   const left=Math.min(...[3,4,5,6].map(n=>smooth(k-n))),right=Math.min(...[3,4,5,6].map(n=>smooth(k+n)));
   if(s<1.25*Math.max(left,right))continue;
   const band=[-2,-1,0,1,2].reduce((a,j)=>a+(dist.get(k+j)||0),0);
   peaks.push({k,center:Math.exp((k+.5)*step),s,band});
  }
  return peaks;
 }
 const basePeaks=findPeaks(baseline);
 const low60=Math.min(...bars.slice(Math.max(0,i-cfg.rangeDays+1),i+1).map(x=>x[3]));
 const high60=Math.max(...bars.slice(Math.max(0,i-cfg.rangeDays+1),i+1).map(x=>x[2]));
 const candidate=basePeaks.filter(p=>high60>low60&&(p.center-low60)/(high60-low60)*100<=cfg.lowPosition && Math.abs(basePrice/p.center-1)<=.05 && p.band*100>=cfg.peakMin).sort((a,b)=>b.band-a.band||a.center-b.center)[0];
 let result='無符合規格的底峰基準';let c=null,currentBand=null,retain=null,drop=null,compPeak=null;
 if(candidate){c=candidate;currentBand=[-2,-1,0,1,2].reduce((a,n)=>a+(current.get(c.k+n)||0),0);
  drop=(c.band-currentBand)*100;retain=currentBand/c.band*100;
  const ps=findPeaks(current).filter(p=>Math.abs(p.k-c.k)<=6).sort((a,b)=>Math.abs(a.k-c.k)-Math.abs(b.k-c.k)||b.s-a.s);
  compPeak=ps[0];
  result=compPeak&&Math.abs(compPeak.k-c.k)<=1&&drop<=cfg.dropPp&&retain>=cfg.retention?'候選底峰保留':'底峰未通過保留';
 }
 return {baseline,current,minKey,maxKey,step,base,compare,start:bars[start][0],basePrice,c,currentBand,retain,drop,compPeak,result,initial,events,basePeaksCount:basePeaks.length,low60,high60};
}
function distPlot(res){const {baseline,current,minKey,maxKey,step,c}=res;let list=[];for(let k=minKey;k<=maxKey;k++)if((baseline.get(k)||0)+(current.get(k)||0)>.00007)list.push(k);if(!list.length)return '';
let xMin=Math.min(...list),xMax=Math.max(...list);let stride=Math.max(1,Math.ceil((xMax-xMin)/140));const arr=[];
for(let a=xMin;a<=xMax;a+=stride){let b=0,n=0;for(let k=a;k<Math.min(a+stride,xMax+1);k++){b+=baseline.get(k)||0;n+=current.get(k)||0;}arr.push([a,b,n])}
const max=Math.max(...arr.flatMap(x=>[x[1],x[2]]),.00001),w=730,h=238,l=48,r=15,top=12,plotH=179,pw=w-l-r;
const Y=x=>top+(max-x)/max*plotH,X=i=>l+i/Math.max(1,arr.length-1)*pw;
const path=j=>arr.map((p,i)=>(i?'L':'M')+X(i).toFixed(2)+' '+Y(p[j]).toFixed(2)).join(' ');
const kAt=i=>Math.exp((arr[Math.round(i)]?.[0]||0)*step);
let mark='';if(c){const idx=arr.findIndex(x=>x[0]<=c.k&&x[0]+stride>c.k);if(idx>=0)mark=`<line x1="${X(idx)}" x2="${X(idx)}" y1="${top}" y2="${top+plotH}" stroke="#eab968" stroke-dasharray="4 3"/>`}
return `<svg viewBox="0 0 ${w} ${h}" class="plot" role="img" aria-label="成交股數換手衰減估算的成本分布"><rect class="plot-bg" x="${l}" y="${top}" width="${pw}" height="${plotH}" rx="8"/>${[0,.25,.5,.75,1].map(a=>`<line class="gridline" x1="${l}" x2="${w-r}" y1="${Y(max*a)}" y2="${Y(max*a)}"/><text class="axis" x="${l-7}" y="${Y(max*a)+4}" text-anchor="end">${fmt(max*a*100,1)}%</text>`).join('')}<path d="${path(1)}" stroke="#619afb" fill="none" stroke-width="2.3"/><path d="${path(2)}" stroke="#3bcc9d" fill="none" stroke-width="2.3"/>${mark}<text class="axis" x="${l}" y="${h-20}">NT$ ${fmt(kAt(0),0)}</text><text class="axis" text-anchor="middle" x="${w/2}" y="${h-20}">NT$ ${fmt(kAt((arr.length-1)/2),0)}</text><text class="axis" text-anchor="end" x="${w-r}" y="${h-20}">NT$ ${fmt(kAt(arr.length-1),0)}</text></svg><div class="legend"><span style="color:#619afb">● 基準分布</span><span style="color:#3bcc9d">● 比較分布</span><span style="color:#eab968">│ 原底峰中心</span></div>`;
}
function peak(){const cfg=state.peakConfig;const days=D.daily2404.map(x=>x[0]);if(!days.includes(state.peakBase))state.peakBase='2026-10-30';if(!days.includes(state.peakCompare))state.peakCompare='2026-11-19';const result=modeledDistribution(state.peakBase,state.peakCompare,cfg);
const form=`<div class="formgrid"><div class="field"><label>基準日（鎖定原價帶）</label><input type="date" id="peakBase" min="${days[0]}" max="${days.at(-1)}" value="${state.peakBase}"></div><div class="field"><label>比較日期</label><input type="date" id="peakCompare" min="${days[0]}" max="${days.at(-1)}" value="${state.peakCompare}"></div><div class="field"><label>模型暖機交易日</label><select data-peak-setting="warmup">${[150,200,500].map(n=>`<option value="${n}" ${cfg.warmup===n?'selected':''}>${n} 日</option>`).join('')}</select></div><div class="field"><label>價格格寬（%）</label><select data-peak-setting="grid">${[.75,1,1.25].map(n=>`<option value="${n}" ${cfg.grid===n?'selected':''}>${n}%</option>`).join('')}</select></div><div class="field"><label>允許原帶下降（百分點）</label><input type="number" min="0" max="100" step="0.5" data-peak-setting="dropPp" value="${cfg.dropPp}"></div><div class="field"><label>底峰最低保留比例（%）</label><input type="number" min="0" max="100" step="1" data-peak-setting="retention" value="${cfg.retention}"></div></div><button class="btn main" id="calcPeak" style="margin-top:16px">重新計算成本分布</button>`;
return title('低位籌碼峰｜研究模型','使用實際日成交股數、當時股數估算與固定價格格，展示底峰是否留存。',badge('尚未正式驗收','warn'))+
`<div class="notice warn"><b>此頁是實際執行的探索模型，不是通過驗收的底峰訊號。</b>原始日 K 大多為事後回補資料，部分公司行動的當時可知證據未補齊。成本分布是換手率模型，不能識別真實持有人或直接當成主力成本。</div><div class="grid2"><div class="card"><h3>漢唐 2404｜比較條件</h3><p class="mini" style="margin-bottom:14px">公式：分布 = (1 − r) × 昨日分布 + r × 當日區間分布。r = 成交股數 / 已發行股數。</p>${form}</div><div class="card">${cardhead('原價帶保留判定','條件與規格 v0.4 對齊',result.error?badge('條件不足','warn'):badge('探索結果','warn'))}${result.error?`<div class="empty"><b>${esc(result.error)}</b>可改為 150 或 200 日暖機，或選擇更晚的基準日。</div>`:`<div class="statbar"><div><span class="mini">模型狀態</span><strong style="font-size:15px">${esc(result.result)}</strong></div><div><span class="mini">初始化殘留</span><strong>${fmt(result.initial*100,3)}%</strong></div></div>${result.c?`<div class="feature"><span>原峰中心</span><strong>NT$ ${fmt(result.c.center,2)}</strong></div><div class="feature"><span>原價帶基準占比</span><strong>${fmt(result.c.band*100,3)}%</strong></div><div class="feature"><span>比較日原帶占比</span><strong>${fmt(result.currentBand*100,3)}%</strong></div><div class="feature"><span>原帶占比變化</span><strong class="${sign(-result.drop)}">${pp(-result.drop)} pp</strong></div><div class="feature"><span>剩餘原帶比例</span><strong>${fmt(result.retain,1)}%</strong></div><div class="feature"><span>鄰近峰位移</span><strong>${result.compPeak?fmt(result.compPeak.k-result.c.k)+' 格':'附近無峰'}</strong></div>`:`<p class="notice">以基準前 ${cfg.rangeDays} 日高低與峰值條件檢視，該日沒有足夠證據鎖定底峰；模型仍會顯示分布，並非資料缺失。</p>`}<p class="footnote">比較期間現金除息事件數：${result.events.length}。跨事件請保守解讀，不能直接視為穩健訊號。</p>`}</div></div>`+
(!result.error?`<div class="section"><h2>價位成本分布</h2></div><div class="card">${distPlot(result)}<p class="footnote">基準模型回看起點 ${result.start}；以固定格寬 ${cfg.grid}% 估算。圖上只有分布形狀，尚未驗證與未來報酬的統計關係。</p></div>`:'');
}
function settingsPage(){const s=draft;
const field=(key,label,min,max,step,unit,desc)=>`<div class="field"><label>${label} <span class="mini">（${unit}）</span></label><input type="number" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${s[key]}"><small>${desc}</small></div>`;
return title('策略設定與方案管理','一套設定描述選股，B 草稿獨立做比較；不會因為改欄位就改變現行結果。',badge('參數保存在這個瀏覽器',''))+
`<div class="notice good">現行選股：<b>${applied.band} 張 · ${applied.weeks} 週 · 累計 +${fmt(applied.minPp,2)} 百分點</b>。此頁變更先存為 B 草稿，只有按「套用到選股」才會取代現行設定。</div>`+
`<div class="grid2"><div class="card"><h3>常用選股條件</h3><div class="formgrid" style="margin-top:13px"><div class="field"><label>大戶級距（張）</label><select data-setting="band">${BAND_NAMES.map(b=>`<option value="${b}" ${s.band===b?'selected':''}>${b} 張以上</option>`).join('')}</select><small>400 張預設含 1,000 張，四條線是重疊累計級距</small></div><div class="field"><label>連續增持週數</label><select data-setting="weeks">${[1,2,3,4].map(n=>`<option value="${n}" ${s.weeks===n?'selected':''}>${n} 週變動（${n+1} 期快照）</option>`).join('')}</select><small>不是隨意串接不同週快照，會檢查週別連續</small></div>${field('minPp','累計持股最低增加',0,20,.01,'百分點','+0.20 pp = 40.00% → 40.20%')}${field('weeklyMin','每一週最低增加',0,10,.01,'百分點','0 代表只要求每次嚴格大於 0；0.05 是強化條件')}<div class="checkfield"><input id="setShares" type="checkbox" data-setting="needShares" ${s.needShares?'checked':''}><label for="setShares">要求每週級距股數同時增加</label></div><div class="checkfield"><input id="setPeak" type="checkbox" data-setting="needPeak" ${s.needPeak?'checked':''}><label for="setPeak">同時要求低位峰保留（未驗收的股票保持待證）</label></div><div class="checkfield fullrow"><input id="setPrice" type="checkbox" data-setting="needPrice" ${s.needPrice?'checked':''}><label for="setPrice">同時要求價格確認（未取得可靠日 K 的股票保持待證）</label></div></div></div>
<div class="card"><h3>保存與應用</h3><p class="help" style="margin:12px 0">保留一組現行選股設定和一組研究草稿。複製 B 不影響 A；歷史原始資料也不會隨著調參改動。</p><div class="feature"><span>A｜目前已套用的方案</span><b>${applied.band} 張 / ${fmt(applied.minPp,2)} pp</b></div><div class="feature"><span>B｜本次草稿</span><b>${s.band} 張 / ${fmt(s.minPp,2)} pp</b></div><div class="toolbar" style="margin-top:20px"><button class="btn main" id="applySetting">✓ 套用 B 到選股</button><button class="btn" id="goCompare">先跑 A/B 比較 →</button></div><div class="toolbar"><button class="btn ghost sm" id="resetDraft">恢復原始預設</button><button class="btn ghost sm" id="copyApplied">複製現行到 B</button><button class="btn ghost sm" id="savePreset">另存方案</button></div><div class="line"></div><h3>已保存的研究方案</h3><div class="tblwrap"><table><thead><tr><th>名稱</th><th>級距／門檻</th><th>操作</th></tr></thead><tbody>${presets.map((p,i)=>`<tr><td>${esc(p.name)}</td><td>${p.settings.band} 張 / ${fmt(Number(p.settings.minPp),2)} pp</td><td><button class="tableaction" data-load-preset="${i}">載入草稿</button></td></tr>`).join('')}</tbody></table></div><div class="toolbar" style="margin-top:18px"><button class="btn sm" id="exportPresets">↓ 匯出設定 JSON</button><label class="btn sm" style="cursor:pointer">↑ 匯入設定 JSON<input type="file" accept=".json,application/json" id="importPresets" hidden></label></div></div></div>`+
`<div class="section"><h2>進階研究與成交參數</h2></div><div class="card"><div class="notice warn">此處先完整保留設定欄位。底峰模型使用暖機、格寬與保留比例等參數；收益計算需要價格資料及事件驗收，不能只靠輸入費率就虛構績效。</div><div class="formgrid"><div class="field"><label>成本分布暖機交易日</label><select data-setting="warmup">${[150,200,500].map(n=>`<option value="${n}" ${s.warmup===n?'selected':''}>${n} 日</option>`).join('')}</select><small>150／200／500 日三種研究版本</small></div>${field('grid','價格格寬',.5,2,.25,'%','主要網格預設 1%，可做 .75% 與 1.25% 敏感性對照')}${field('retention','原底峰最低保留比例',0,100,1,'%','原始價帶在後期的保留幅度')}${field('dropPp','原價帶最大占比下降',0,30,.5,'百分點','固定原帶占比下降超過值視為失敗')}${field('lowPosition','底峰低位限制',5,80,5,'%','原峰中心需在近期高低區間下方比例')}${field('peakMin','原帶最低占比',0,60,1,'%','原始五格未平滑占比')}${field('rangeDays','低位區間回看',20,250,10,'交易日','範圍與基準日期同時固定')}${field('profitDays','預設回測持有',5,100,5,'交易日','歷史結果是否成熟要用後續實際交易日核對')}${field('feeBuy','模擬買入費率',0,.03,.0001,'比率','0.001425 = 0.1425%')}${field('feeSell','模擬賣出成本',0,.03,.0001,'比率','含交易費及交易稅，單位是比率')}${field('slip','單邊滑價',0,.03,.0001,'比率','0.001 = 0.1%；回測扣成本用')}</div></div>`;
}
function dataPage(){const ds=dates(),count=Object.keys(D.stocks).length;
const records=Object.values(D.quality).reduce((a,b)=>a+b.valid,0);
return title('資料來源、匯入與驗收','資料檔與訊號的時點可追溯，未知時間絕不冒充已公布。',badge('固定研究版本 '+D.run))+
`<div class="metricgrid">${metric('已存集保快照',ds.length,'六期原始全表')}${metric('級距驗證成功的股期',fmt(records),'按四碼上市櫃候選母體')}${metric('母體股票',fmt(count),'2026-11-13 當期行情備份')}${metric('核對日 K',fmt(D.daily2404.length),'只有漢唐 2404 的完整日序列')}</div>`+
`<div class="card">${cardhead('每期資料可用性','日期、來源版本與最早已知公開證據相互獨立')}<div class="tblwrap"><table><thead><tr><th>統計日</th><th>可驗證股票數</th><th>資料品質剔除</th><th>最晚已知公開時間（台北）</th><th>時點性</th></tr></thead><tbody>${ds.map(day=>`<tr><td><b>${day}</b></td><td>${fmt(D.quality[day]?.valid||0)}</td><td>${fmt(D.quality[day]?.invalid||0)}</td><td>${esc(D.observed[day]||'未取得')}</td><td>${D.observed[day]?badge('備份可得','good'):badge('待證','warn')}</td></tr>`).join('')}</tbody></table></div><p class="footnote">資料版本：${D.run}。備份取得時間不是交易當下公布時間；原集保官方上架的精確時刻仍待證。</p></div>`+
`<div class="section"><h2>匯入更多集保歷史資料</h2></div><div class="grid2"><div class="card"><h3>匯入官方 1-5 集保 CSV</h3><p class="help" style="margin-bottom:14px">可以一次選多個完整單週 CSV，程式會在瀏覽器內核對 1–17 級股數、戶數及分母，並加入個股線圖。此操作不會自動上傳到網路。</p><div class="filezone"><b>選擇集保原始 CSV 檔案</b><p class="mini">需含：資料日期、證券代號、持股分級、人數、股數</p><input type="file" id="importTDCC" accept=".csv,text/csv" multiple style="margin-top:12px"></div><p class="footnote">新匯入期的發布時間無法由 CSV 單獨證明，因此顯示「公布時點待證」，不能用於嚴格回測。原本已驗證的六期資料禁止覆蓋。</p><div id="importStatus" class="mini">本次已額外匯入 ${fmt(state.importCount)} 期（重新開啟頁面需重匯）。</div></div><div class="card"><h3>來源及資料品管</h3><div class="feature"><span>TDCC 集保股權分散</span>${badge('已核對分級','good')}</div><div class="feature"><span>市場行情與公司股數</span>${badge('分層樣本驗收','good')}</div><div class="feature"><span>公司行動、個股退市</span>${badge('部分樣本','warn')}</div><div class="feature"><span>全市場日 K 的當時可知版本</span>${badge('尚未取得','warn')}</div><div class="feature"><span>正式 5/10/20/40 日報酬</span>${badge('不可宣稱','warn')}</div><p class="footnote">公開資料來源可能有取用與再傳輸限制；本版僅供個人離線研究，不包含商業再授權。</p></div></div>`+
`<div class="section"><h2>查看原始驗收證據</h2></div><div class="card"><div class="toolbar"><button class="btn sm" id="exportQuality">↓ 匯出目前資料清單</button><button class="btn sm" id="export2404">↓ 匯出 2404 日線 CSV</button><button class="btn sm" id="exportWeekly">↓ 匯出 2404 集保 CSV</button></div><div class="notice"><b>完整原始資料仍留在壓縮包：</b><code>evidence/raw/</code>、<code>evidence/runs/</code>、<code>reports/${D.run}/</code>。這個網頁是讀取經驗收的數值，不會改動原始證據。</div><p class="help">官方原始資料：<a href="https://www.tdcc.com.tw/portal/zh/smWeb/qryStock" target="_blank" rel="noopener">集保查詢</a>、<a href="https://www.twse.com.tw/" target="_blank" rel="noopener">證交所</a>、<a href="https://www.tpex.org.tw/" target="_blank" rel="noopener">櫃買中心</a>。本系統完全離線可用，原資料不會自動隨時間更新。</p></div>`;
}
function csvDownload(filename,rows){if(!rows?.length){toast('沒有可匯出的資料');return}const columns=Object.keys(rows[0]);function quote(v){const s=String(v??'');return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s}const lines=[columns.map(quote).join(','),...rows.map(row=>columns.map(k=>quote(row[k])).join(','))];download(filename,'\ufeff'+lines.join('\r\n'),'text/csv;charset=utf-8-sig')}
function download(filename,contents,mime){const blob=new Blob([contents],{type:mime}),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=filename;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),5000)}
function exportScreener(){const rows=state.showList;csvDownload(`chip_screener_${state.win}_${applied.band}.csv`,rows.map(x=>({code:x.code,name:x.name,market:x.market,window:state.win,band:applied.band,state:x.status,total_pp:x.gain??'',weekly_changes:x.delta?.join('|')??'',weekly_shares:x.deltaShares?.join('|')??'',known_by:x.knownDate??'',data_version:D.run})));}
function parseCSV(text){const lines=[];let row=[],str='',quote=false;for(let i=0;i<text.length;i++){const ch=text[i];if(quote){if(ch==='"'&&text[i+1]==='"'){str+='"';i++}else if(ch==='"')quote=false;else str+=ch;}else if(ch==='"')quote=true;else if(ch===','){row.push(str);str=''}else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(str);if(row.some(x=>x.trim()!==''))lines.push(row);row=[];str=''}else str+=ch;}if(row.length||str){row.push(str);lines.push(row)}return lines;}
async function importTDCC(files){let successes=[],errors=[];
for(const f of files){try{
 const content=await f.text(),lines=parseCSV(content.replace(/^\uFEFF/,''));const head=lines.shift(),indexes={};['資料日期','證券代號','持股分級','人數','股數'].forEach(k=>{indexes[k]=head.indexOf(k);if(indexes[k]<0)throw Error('缺少欄位 '+k)});
 let day='',byCode={};for(const cols of lines){const r=k=>cols[indexes[k]]?.trim();const rawday=r('資料日期');if(!/^\d{8}$/.test(rawday))continue;
 if(day&&day!==rawday)throw Error('同一檔案含有不同統計日');day=rawday;
 const code=r('證券代號');if(!/^\d{4}$/.test(code)||code[0]==='0')continue;
 const lvl=Number(r('持股分級')),n=Number(r('股數')),h=Number(r('人數'));
 if(!Number.isInteger(lvl)||lvl<1||lvl>17||!Number.isSafeInteger(n)||!Number.isSafeInteger(h)||n<0||h<0)continue;
 const codeRow=byCode[code]||(byCode[code]={});if(codeRow[lvl])throw Error('出現同個股同級距重複資料：'+code);codeRow[lvl]=[n,h];
 }
 if(!day)throw Error('沒有符合的資料日期');const ds=`${day.slice(0,4)}-${day.slice(4,6)}-${day.slice(6,8)}`;
 if(D.series[ds])throw Error('日期 '+ds+' 已存在，不允許覆蓋原始版本');
 let valid={},excluded=0;
 for(const [code,row] of Object.entries(byCode)){
  if(Object.keys(row).length!==17||!row[17]){excluded++;continue}const den=row[17][0],holders=row[17][1];
  if(den<=0||sumLevels(row,1,16,0)!==den||sumLevels(row,1,15,1)!==holders){excluded++;continue}
  const areas=[[11,15],[12,15],[13,15],[15,15]];
  valid[code]=[den,holders,...areas.map(([lo,hi])=>sumLevels(row,lo,hi,0)),...areas.map(([lo,hi])=>sumLevels(row,lo,hi,1))];
  if(!D.stocks[code])D.stocks[code]=['名稱待證','?'];
 }
 if(!Object.keys(valid).length)throw Error('沒有通過股數／戶數核對的股票');
 D.series[ds]=valid;D.observed[ds]=null;D.quality[ds]={valid:Object.keys(valid).length,invalid:excluded,raw_source:'手動匯入 '+f.name};
 successes.push(`${ds}：${Object.keys(valid).length} 檔通過，${excluded} 檔排除`);
 }catch(e){errors.push(`${f.name}：${e.message}`)}}
state.importCount+=successes.length;
render();
const msg=[...successes,...errors].join('；');toast(msg||'沒有匯入資料');
$('#importStatus').textContent=msg;
}
function sumLevels(row,lo,hi,col){let s=0;for(let k=lo;k<=hi;k++)s+=(row[k]?.[col]||0);return s}
function validateSettings(x){const out={...DEFAULT,...x};for(const key of ['weeks','minPp','weeklyMin','profitDays','feeBuy','feeSell','slip','warmup','grid','retention','dropPp','lowPosition','peakMin','rangeDays']){out[key]=Number(out[key]);if(!Number.isFinite(out[key]))throw Error('無效的參數：'+key)}
 if(!BAND_NAMES.includes(out.band))throw Error('無效大戶級距');
 if(!Number.isInteger(out.weeks)||out.weeks<1||out.weeks>4)throw Error('連續週數需為 1–4');
 if(out.minPp<0||out.minPp>20||out.weeklyMin<0||out.weeklyMin>10)throw Error('級距門檻超出範圍');
 if(![150,200,500].includes(out.warmup))throw Error('暖機期僅支援 150／200／500');
 if(![.75,1,1.25].includes(out.grid))throw Error('網格僅支援 0.75／1／1.25%');
 for(const k of ['feeBuy','feeSell','slip'])if(out[k]<0||out[k]>.03)throw Error('費率超出範圍');
 if(out.retention<0||out.retention>100||out.dropPp<0||out.dropPp>30||out.peakMin<0||out.peakMin>60||out.lowPosition<5||out.lowPosition>80||out.rangeDays<20||out.rangeDays>250)throw Error('成本分布參數超出範圍');
 for(const k of ['needShares','needPeak','needPrice'])out[k]=Boolean(out[k]);return out;
}
function handleSetting(el){const key=el.dataset.setting;const value=el.type==='checkbox'?el.checked:(el.type==='number'?Number(el.value):el.value);try{draft=validateSettings({...draft,[key]:value});localSet('draft',draft)}catch(e){toast(e.message);return}if(key==='weeks')state.win=windows(draft.weeks).at(-1)?.end||state.win;}
function attachCharts(){}
// Event delegation ensures table paging, settings and chart widgets work after rerender.
document.body.addEventListener('click',e=>{
 const nav=e.target.closest('[data-nav]');if(nav){go(nav.dataset.nav);return}
 const stockTarget=e.target.closest('[data-stock]');if(stockTarget){selectStock(stockTarget.dataset.stock);return}
 const r=e.target.closest('[data-chart-range]');if(r){state.chartRange=r.dataset.chartRange;render();return}
 const dr=e.target.closest('[data-daily-range]');if(dr){state.dailyRange=Number(dr.dataset.dailyRange);render();return}
 const preset=e.target.closest('[data-load-preset]');if(preset){draft=validateSettings(presets[Number(preset.dataset.loadPreset)].settings);localSet('draft',draft);render();toast('已載入 B 草稿，現行選股未改變');return}
 const id=e.target.id;
 if(id==='goStock'){
  const code=$('#stockCode').value.trim();if(!/^\d{4}$/.test(code)){toast('請輸入四碼股票代號');return}selectStock(code);return;
 }
 if(id==='prevPage'){state.pageNum=Math.max(0,state.pageNum-1);render();return}
 if(id==='nextPage'){state.pageNum++;render();return}
 if(id==='exportScreener'){exportScreener();return}
 if(id==='goCompare'){go('backtest');return}
 if(id==='applySetting'){try{applied=validateSettings(draft);localSet('applied',applied);state.win=windows(applied.weeks).at(-1)?.end;toast('新方案已套用到選股');go('screen')}catch(e){toast(e.message)}return}
 if(id==='copyApplied'){draft={...applied};localSet('draft',draft);render();toast('現行方案已複製到 B 草稿');return}
 if(id==='resetDraft'){draft={...DEFAULT};localSet('draft',draft);render();toast('B 草稿恢復原始 v0.4 預設，未影響現行選股');return}
 if(id==='savePreset'){const name=prompt('這份方案要叫什麼名字？');if(name&&name.trim()){presets.push({name:name.trim().slice(0,50),settings:{...draft}});localSet('presets',presets);render();toast('研究方案已儲存')}return}
 if(id==='exportPresets'){download('chip_screener_settings.json',JSON.stringify({format:'chip-screener-config-v1',applied,draft,presets},null,2),'application/json');return}
 if(id==='exportQuality'){csvDownload('chip_data_coverage.csv',dates().map(day=>({snapshot:day,verified_stock_count:D.quality[day].valid,invalid:D.quality[day].invalid,observed_by:D.observed[day]||'',source_sha256:D.quality[day].raw_source,run:D.run})));return}
 if(id==='export2404'){csvDownload('2404_daily.csv',D.daily2404.map(d=>({date:d[0],open:d[1],high:d[2],low:d[3],close:d[4],volume_shares:d[5],issued_shares:d[6],turnover:d[7],cash_dividend:d[8],strict_eod:d[9]})));return}
 if(id==='exportWeekly'){csvDownload('2404_weekly.csv',dates().flatMap(day=>BAND_NAMES.map(b=>{const v=vector('2404',day,b);return v?{date:day,band:b,pct:v.pct,shares:v.shares,holders:v.owner,den:v.den,observed_by:D.observed[day]}:null}).filter(Boolean)));return}
 if(id==='exportCompare'){
  const wa=chosenWin(applied),wb=windows(draft.weeks).find(x=>x.end===wa?.end)||windows(draft.weeks).at(-1);const ra=scan(applied,wa),rb=scan(draft,wb);const mapB=new Map(rb.map(r=>[r.code,r]));csvDownload('chip_AB_signal_compare.csv',ra.map(a=>({code:a.code,name:a.name,A_state:a.status,A_gain_pp:a.gain??'',B_state:mapB.get(a.code)?.status||'缺資料',B_gain_pp:mapB.get(a.code)?.gain??'',data_version:D.run})));return;
 }
 if(id==='calcPeak'){
  const v=$('#peakBase').value,c=$('#peakCompare').value;
  if(!D.daily2404.some(x=>x[0]===v)||!D.daily2404.some(x=>x[0]===c)){toast('請選擇實際交易日（非假日）');return}
  state.peakBase=v;state.peakCompare=c;render();return;
 }
});
document.body.addEventListener('change',async e=>{
 const el=e.target;
 if(el.dataset.setting){handleSetting(el);return}
 if(el.dataset.peakSetting){const k=el.dataset.peakSetting,v=Number(el.value);state.peakConfig[k]=v;return}
 if(el.dataset.band){const b=el.dataset.band;state.bands=el.checked?[...new Set([...state.bands,b])]:state.bands.filter(x=>x!==b);render();return}
 if(el.id==='filterPass'){state.filter=el.value;state.pageNum=0;render();return}
 if(el.id==='sortBy'){state.sort=el.value;state.pageNum=0;render();return}
 if(el.id==='windowSelect'){state.win=el.value;state.selectedDay=el.value;state.pageNum=0;render();return}
 if(el.id==='daySelect'){state.selectedDay=el.value;render();return}
 if(el.id==='importTDCC'){if(el.files.length)await importTDCC([...el.files]);return}
 if(el.id==='importPresets'){
  try{const obj=JSON.parse(await el.files[0].text());if(obj.format!=='chip-screener-config-v1')throw Error('不是籌碼雷達設定格式');
   const newPresets=(obj.presets||[]).map(p=>({name:String(p.name).slice(0,50),settings:validateSettings(p.settings)}));
   if(!newPresets.length)throw Error('找不到有效方案');presets=newPresets;draft=validateSettings(obj.draft||newPresets[0].settings);localSet('presets',presets);localSet('draft',draft);render();toast('匯入成功；現行選股未變')
  }catch(err){toast('匯入設定失敗：'+err.message)}return;
 }
});
document.body.addEventListener('input',e=>{if(e.target.id==='searchCode'){state.query=e.target.value;state.pageNum=0;const pos=e.target.selectionStart;render();const inp=$('#searchCode');if(inp){inp.focus();inp.setSelectionRange(pos,pos)}}});
window.addEventListener('error',e=>{console.error(e.error);toast('畫面操作發生錯誤：'+e.message)});
// 初始選擇最新連續窗口；若使用者保存的設定超出資料窗口，取可用最後一期。
state.win=windows(applied.weeks).at(-1)?.end||dates().at(-1);
render();
