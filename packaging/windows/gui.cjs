'use strict';
// Runs against the EXE extracted from the release ZIP, with no renderer code replacement.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');
const [exePath, evidenceDir, phase] = process.argv.slice(2);
const out = path.resolve(evidenceDir);

const report = { platform: process.platform, architecture: process.arch, cases: {}, snapshots: {}, screenshots: [], rendererErrors: [] };
const routes = ['home', 'screen', 'stock', 'backtest', 'peak', 'settings', 'data'];
let app, browser, renderer;
async function record() { await fs.writeFile(path.join(out, phase + '-gui.json'), JSON.stringify(report, null, 2)); }
async function check(name, fn) {
  try { await fn(); report.cases[name] = { status: 'passed' }; }
  catch (error) { report.cases[name] = { status: 'failed', reason: error.message }; throw error; }
  finally { await record(); }
}
async function waitFor(get, ms = 30000, name = 'condition') {
  const end = Date.now() + ms;
  let last;
  do { try { const value = await get(); if (value) return value; } catch (error) { last = error; } await sleep(350); } while (Date.now() < end);
  throw new Error('Timeout waiting for ' + name + (last ? ': ' + last.message : ''));
}
async function freePort() {
  const server = net.createServer(); await new Promise((ok, bad) => server.once('error', bad).listen(0, '127.0.0.1', ok));
  const port = server.address().port; await new Promise(ok => server.close(ok)); return port;
}
async function connect(url) {
  const socket = new WebSocket(url); const pending = new Map(); let sequence = 0;
  await new Promise((ok, bad) => {socket.addEventListener('open', ok, {once:true}); socket.addEventListener('error', () => bad(new Error('CDP socket failed')), {once:true});});
  socket.addEventListener('message', ({data}) => {
    const msg = JSON.parse(data);
    if (msg.method === 'Runtime.exceptionThrown') { const x=msg.params.exceptionDetails; report.rendererErrors.push(x.exception?.description || x.text); }
    const callback = pending.get(msg.id); if (!callback) return; pending.delete(msg.id); clearTimeout(callback.timer);
    if (msg.error) callback.bad(new Error(msg.error.message)); else callback.ok(msg.result);
  });
  socket.addEventListener('close', () => {for (const p of pending.values()) {clearTimeout(p.timer); p.bad(new Error('CDP closed'));} pending.clear();});
  return { close: () => socket.close(), call(method, params = {}) {const id=++sequence;return new Promise((ok,bad) => {
    const timer=setTimeout(()=>{pending.delete(id);bad(new Error('CDP timeout '+method));},15000); pending.set(id,{ok,bad,timer});socket.send(JSON.stringify({id,method,params}));});} };
}
async function evaluate(expression) { const reply=await renderer.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description || reply.exceptionDetails.text);return reply.result.value; }
async function launch(exe) {
  const port=await freePort();
  app=spawn(exe,[`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1'],{cwd:path.dirname(exe),stdio:'ignore'});
  let launchError; app.once('error',e=>{launchError=e});
  const base=`http://127.0.0.1:${port}`;
  const targets=await waitFor(async()=>{if(launchError)throw launchError;const items=await (await fetch(base+'/json/list')).json();return items.find(x=>x.type==='page' && x.url === 'radar://desktop/index.html');},90000,'native Electron renderer');
  const version=await (await fetch(base+'/json/version')).json(); browser=await connect(version.webSocketDebuggerUrl); renderer=await connect(targets.webSocketDebuggerUrl);
  await renderer.call('Runtime.enable');await renderer.call('Page.enable');
  await waitFor(()=>evaluate(`!!document.querySelector('#page h1') && !!document.querySelector('#nav [data-nav]')`),35000,'embedded dashboard');
}
async function stop() {
  if (!app) return;
  if(browser) {try {await browser.call('Browser.close');} catch {} browser.close();browser=null;}
  if(renderer) {renderer.close();renderer=null;}
  if(app.pid && app.exitCode===null && app.signalCode===null){
    await Promise.race([new Promise(ok=>app.once('exit',ok)),sleep(6000)]);
    if(app.exitCode===null && app.signalCode===null){try{execFileSync('taskkill.exe',['/T','/F','/PID',String(app.pid)],{stdio:'ignore'});}catch{}}
  } app=null;
}
async function click(selector) {
  const rect=await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el||el.disabled)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
  assert(rect,'Visible enabled control required: '+selector);
  const params={...rect,button:'left',clickCount:1};await renderer.call('Input.dispatchMouseEvent',{type:'mousePressed',...params});await renderer.call('Input.dispatchMouseEvent',{type:'mouseReleased',...params});
}
async function nav(route) {await click(`#nav [data-nav="${route}"]`);await waitFor(()=>evaluate(`document.querySelector('#nav [data-nav="${route}"]')?.classList.contains('active') && !!document.querySelector('#page h1')`),5000,'route '+route);}
async function screenshot(name) {const {data}=await renderer.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const png=Buffer.from(data,'base64');assert(png.length>5000 && png.readUInt32BE(0)===0x89504e47);await fs.writeFile(path.join(out,phase+'-'+name+'.png'),png);report.screenshots.push(name+'.png');}

const sampleDay = '2026-09-18';
const samplePreset = 'B03 保存驗收';
async function change(selector, value) {
  await evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function importWeek(day, name, scale=1) {
  const file = path.join(out,name+'.csv');
  const lines = ['資料日期,證券代號,持股分級,人數,股數'];
  for (let level=1;level<=17;level++) {
    const holders = level===17 ? 120 : level===16 ? 0 : level;
    lines.push([day.replaceAll('-',''),'2404',level,holders,(level===17?136000:level===16?0:level===1?17000:1000*level)*scale].join(','));
  }
  await fs.writeFile(file,lines.join('\r\n'),'utf8');
  const {root} = await renderer.call('DOM.getDocument');
  const {nodeId} = await renderer.call('DOM.querySelector',{nodeId:root.nodeId,selector:'#importTDCC'});
  await renderer.call('DOM.setFileInputFiles',{nodeId,files:[file]});
}
async function seedStorage() {
  await nav('settings');
  await change('[data-setting="minPp"]','0.77');
  await click('#applySetting');
  await nav('settings');
  await click('#savePreset');
  await renderer.call('Input.insertText',{text:samplePreset});
  await click('dialog[open] button');
  await nav('data');
  await importWeek(sampleDay,'B03-合成快照');
  await waitFor(()=>evaluate("document.querySelector('#importStatus')?.textContent.includes('1 檔通過')"),6000,'snapshot persisted');
}
async function verifyStored() {
  await nav('settings');
  const config = await evaluate(`({
    draft:document.querySelector('[data-setting="minPp"]').value,
    applied:[...document.querySelectorAll('.feature')].find(el=>el.innerText.includes('目前已套用'))?.innerText,
    preset:[...document.querySelectorAll('tbody tr')].find(el=>el.innerText.includes('B03 保存驗收'))?.innerText
  })`);
  assert.equal(config.draft,'0.77');
  assert(config.applied?.includes('0.77 pp') && config.preset?.includes('0.77 pp'),JSON.stringify(config));
  await screenshot('stored-settings');
  await nav('data');
  const info=await evaluate("document.querySelector('#importStatus').textContent");
  assert(info.includes(sampleDay) && info.includes('B03-合成快照.csv') && info.includes('本機快照 1 期'), info);
  const version=phase==='upgrade-source'?'0.6.0-b06.0':'0.6.0-b06.1';
  assert(info.includes(version),info);
  if(phase==='recovered') assert(info.includes('策略設定已從備份復原') && info.includes('資料快照已從備份復原'),info);
  await screenshot('stored-snapshot');
  await nav('stock');
  await change('#daySelect',sampleDay);
  const row=await evaluate(`document.querySelector('#daySelect').closest('.card').querySelectorAll('tbody tr')[1].innerText`);
  assert(row.includes('54,000') && row.includes('136,000'),row);
  await screenshot('stored-stock');
  report.snapshots.persistence={config,info,sampleDay,row};
}
async function verifyWriteFailure() {
  const store=path.join(process.env.LOCALAPPDATA,'ChipScreener','store-v1');
  const stage=path.join(store,'snapshot.current.json.tmp');
  await fs.mkdir(stage);
  try {
    await nav('data'); await importWeek('2026-09-25','B03-中斷寫入');
    await waitFor(()=>evaluate("document.querySelector('#importStatus')?.textContent.includes('本機寫入失敗')"),8000,'visible write failure');
    report.snapshots.rejectedWrite = await evaluate("document.querySelector('#importStatus').textContent");
    await nav('stock');
    assert.equal(await evaluate("!!document.querySelector('#daySelect option[value=\"2026-09-25\"]')"),false);
  } finally { await fs.rmdir(stage); }
  const stageConfig=path.join(store,'settings.current.json.tmp');
  await fs.mkdir(stageConfig);
  try {
    await nav('settings');
    await change('[data-setting="minPp"]','1.11');
    assert.equal(await evaluate("document.querySelector('[data-setting=minPp]').value"),'0.77');
  } finally { await fs.rmdir(stageConfig); }
}

const revisionDays = ['2026-09-04','2026-09-11','2026-09-18','2026-09-25'];
const revisionThresholds = ['0.41','0.62','0.83','0.94'];
async function saveRevision(index) {
  const day=revisionDays[index];
  await nav('settings');
  await change('[data-setting="minPp"]',revisionThresholds[index]);
  await nav('data');
  await importWeek(day,'B03-復原-'+day,index+1);
  await waitFor(()=>evaluate(`document.querySelector('#importStatus').textContent.includes(${JSON.stringify(day+'：1 檔通過')})`),6000,'import '+day);
}
async function seedMissedMirrors() {
  await saveRevision(0);
  const dir=path.join(process.env.LOCALAPPDATA,'ChipScreener','store-v1');
  const blocks=['settings','snapshot'].map(kind=>path.join(dir,kind+'.mirror.json.tmp'));
  for (const stage of blocks) await fs.mkdir(stage);
  try { await saveRevision(1); await saveRevision(2); }
  finally { for (const stage of blocks) await fs.rmdir(stage); }
  for (const kind of ['settings','snapshot']) {
    const revisions={};
    for (const slot of ['current','mirror','previous']) {
      const file=path.join(dir,kind+'.'+slot+'.json');
      revisions[slot]=JSON.parse(await fs.readFile(file,'utf8')).body.revision;
    }
    assert.deepEqual(revisions,{current:3,mirror:1,previous:2});
    report.snapshots[kind]=revisions;
  }
}
async function verifyRevision(index) {
  const day=revisionDays[index];
  await nav('settings');
  const threshold=await evaluate("document.querySelector('[data-setting=minPp]').value");
  assert.equal(threshold,revisionThresholds[index]);
  await screenshot('revision-'+(index+1)+'-settings');
  await nav('data');
  const info=await evaluate("document.querySelector('#importStatus').textContent");
  assert(info.includes('0.6.0-b06.1') && info.includes(day),info);
  if(index===1) assert(info.includes('策略設定已從備份復原') && info.includes('資料快照已從備份復原'),info);
  await nav('stock');
  assert.equal(await evaluate("!!document.querySelector('#daySelect option[value=\"2026-09-18\"]')"),false);
  await change('#daySelect',day);
  const row=await evaluate("document.querySelector('#daySelect').closest('.card').querySelectorAll('tbody tr')[1].innerText");
  assert(row.includes(index===1?'108,000':'216,000'),row);
  await screenshot('revision-'+(index+1)+'-stock');
  report.snapshots[day]={threshold,info,row};
}

async function readExport(selector, filename) {
  const dir=path.join(out,'weekly-csv');
  await fs.mkdir(dir,{recursive:true});
  await browser.call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dir});
  await click(selector);
  const file=path.join(dir,filename);
  const csv=await waitFor(()=>fs.readFile(file,'utf8'),20000,'CSV download '+filename);
  const items=await evaluate(`(()=>{const [keys,...rows]=parseCSV(${JSON.stringify(csv.replace(/^\uFEFF/,''))});return {count:rows.length,unique:new Set(rows.map(r=>r[0])).size,selected:Object.fromEntries(keys.map((k,i)=>[k,rows.find(r=>r[0]==='2330')[i]])),states:rows.reduce((counts,r)=>{const k=r[keys.indexOf('B_state')];counts[k]=(counts[k]||0)+1;return counts},{})}})()`);
  assert.equal(items.count,1985);assert.equal(items.unique,1985);
  return items;
}
async function verifyWeekly() {
  await nav('screen');
  const screen=await readExport('#exportScreener','chip_screener_2026-11-13_400.csv');
  await evaluate("const q=document.querySelector('#searchCode');q.value='2330';q.dispatchEvent(new Event('input',{bubbles:true}));true");
  const stockRow=await evaluate("document.querySelector('tr[data-stock=\"2330\"]').innerText");
  assert(stockRow.includes(screen.selected.state) && stockRow.includes(screen.selected.reason));
  assert.equal(screen.selected.state,'比例未連升');
  await click('tr[data-stock="2330"]');
  const signal=await evaluate("document.querySelector('[data-signal-band=\"400\"]').innerText");
  assert(signal.includes(screen.selected.state) && signal.includes('-37,973,336'));
  assert(await evaluate("document.querySelector('#page').innerText.includes('5,899')"));
  await screenshot('2330');
  await nav('settings');await change('[data-setting="weeks"]','4');
  await nav('backtest');await change('#windowSelect','2026-10-30');await change('#compareCode','2330');
  const visible=await evaluate("document.querySelector('#compareResult').innerText");
  const csv=await readExport('#exportCompare','chip_AB_signal_compare.csv');
  const row=csv.selected;
  assert.equal(row.window,'2026-10-30');
  assert.equal(row.as_of,'2026-10-31T15:41:17+08:00');
  assert.equal(csv.states['資料不足'],1985);
  assert.equal(row.B_gain_pp,'');
  assert(visible.includes('A '+row.A_state+' · '+row.A_reason) && visible.includes('B '+row.B_state+' · '+row.B_reason));
  assert(row.B_reason.includes('缺週') && !row.B_dates.includes('11-13'));
  await screenshot('same-cutoff');
  await change('#asOf','2026-10-30T13:30');
  const early=await evaluate("document.querySelector('#compareResult').innerText");
  assert(early.includes('A 資料不足') && early.includes('尚無公開證據'));
  await nav('stock');
  assert(!(await evaluate("document.querySelector('[data-signal-band=\"400\"]').innerText")).includes('-37,973,336'));
  report.snapshots.weekly={screen,stockRow,signal,comparison:csv,visible,early};
}

async function pendingWeekTest() {
  const pendingDay = '2026-11-20';
  if (phase.endsWith('-seed')) {
    await nav('data');
    await importWeek(pendingDay,'B04-待證快照');
    await waitFor(()=>evaluate("document.querySelector('#importStatus').textContent.includes('2026-11-20：1 檔通過')"));
    return;
  }
  await nav('screen');
  async function readWindow() {
    return evaluate(`(()=>{
      const metrics=Object.fromEntries([...document.querySelectorAll('.metric')].map(el=>[el.querySelector('.label').textContent,el.querySelector('.value').textContent]));
      return {week:document.querySelector('#windowSelect').value,pass:metrics['符合現行條件'],insufficient:metrics['資料／複合條件待證'],notice:document.querySelector('#weekSelection')?.textContent};
    })()`);
  }
  const initial=await readWindow();
  report.snapshots.initial=initial;
  assert.equal(initial.week,'2026-11-13');
  assert.equal(initial.pass,'268');
  assert(initial.notice.includes(pendingDay) && initial.notice.includes('公布時點待證'));
  await screenshot('strict-default');
  await nav('data');
  const stored=await evaluate("document.querySelector('#importStatus').textContent");
  assert(stored.includes(pendingDay) && stored.includes('B04-待證快照.csv'),stored);
  await nav('stock');await change('#daySelect',pendingDay);
  const raw=await evaluate("document.querySelector('#daySelect').closest('.card').innerText");
  assert(raw.includes('54,000') && raw.includes('未知'),raw);
  assert.equal(await evaluate("document.querySelector('#windowSelect').value"),'2026-11-13');
  await screenshot('pending-raw');
  await nav('screen');await change('#windowSelect',pendingDay);
  await nav('backtest');await nav('screen');
  const explicit=await readWindow();
  assert.equal(explicit.week,pendingDay);assert.equal(explicit.pass,'0');
  assert.equal(explicit.insufficient,'1,985');
  assert(explicit.notice.includes('公布時點待證'),explicit.notice);
  await screenshot('explicit-week');
  await click('#useDefaultWeek');
  assert.deepEqual(await readWindow(),initial);
  report.snapshots.explicit=explicit;
  report.snapshots.raw={date:pendingDay,stored,row:raw.slice(-500)};
}

async function liveOfficialTest() {
  async function homeState() {
    return evaluate(`(()=>{
      const metrics=Object.fromEntries([...document.querySelectorAll('.metric')].map(el=>[el.querySelector('.label').textContent,el.querySelector('.value').textContent]));
      return {day:document.querySelector('#feedDay').innerText,notice:document.querySelector('#weekSelection').innerText,
        week:state.win,pass:metrics['所選窗口通過數'],unknown:metrics['資料／條件待證'],status:document.querySelector('#feedStatus').innerText};
    })()`);
  }
  const before=await homeState();report.snapshots.before=before;
  if(phase==='live-auto' || phase==='live-pin') {
    assert.equal(before.week,'2026-11-13');assert.equal(before.pass,'268');await screenshot('before');
  }
  if(phase==='live-pin') {
    await nav('screen');await change('#windowSelect','2026-10-30');
  }
  await waitFor(()=>evaluate("!!checkedAt && !feedBusy"),135000,'official check completion');
  if(phase==='live-pin') assert.equal(await evaluate("document.querySelector('#windowSelect').value"),'2026-10-30');
  await nav('home');
  const after=await homeState();report.snapshots.after=after;
  await record();
  assert(after.day>'2026-11-13',JSON.stringify(after));
  const official=await evaluate(`(()=>{const d=Object.keys(officialWeeks).sort().at(-1);const w=officialWeeks[d];const c=evaluation(applied,d,evidenceTime(d));const t=tally(scan(applied,c));return {day:d,source:w.quality,calendar:D.sessions.at(-1),months:Object.values(officialMonths).map(m=>({month:m.month,source:m.source,sha256:m.sha256})),dates:c.dates,issue:c.issue||'',...t,appliedWeek:state.win,baseline: frozenLast};})()`);
  report.snapshots.official=official;await record();
  assert.equal(official.source.raw_source,'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5');
  assert.equal(official.source.publication,null);
  assert.equal(official.source.valid+official.source.invalid,1985);
  if(phase==='live-auto'){
    assert(after.status.includes('有新資料'),after.status);
    if(official.day==='2026-11-20') {assert.equal(official.issue,'');assert.equal(after.week,official.day);assert(official.unknown<1985);}
    else if(!official.issue) assert.equal(after.week,official.day);
    await fs.writeFile(path.join(out,'first-official.json'),JSON.stringify(official,null,2));
  }
  if(['live-repeat','live-offline'].includes(phase)){
    const first=JSON.parse(await fs.readFile(path.join(out,'first-official.json'),'utf8'));
    assert.deepEqual(official,first);
    assert.equal(before.day,official.day);
    assert(after.status.includes(phase==='live-repeat'?'已是最新':'離線'),after.status);
  }
  await screenshot('home');
  await nav('data');assert((await evaluate("document.querySelector('#feedPanel').innerText")).includes(official.source.sha256));
  await screenshot('provenance');await nav('screen');
  const displayed=await evaluate("({date:document.querySelector('#windowSelect').value,values:[...document.querySelectorAll('.metric .value')].map(x=>x.textContent)})");
  if(after.week===official.day) {assert.equal(displayed.date,official.day);assert.equal(displayed.values[0].replaceAll(',',''),String(official.pass));}
  report.snapshots.screen=displayed;
  await screenshot('screen');console.log(phase,JSON.stringify(report.snapshots));
}

async function pinQA(){
  if(phase==='pins-seed'){
    await nav('screen');
    for(const [mode,count] of [['all',1985],['miss',1692],['unknown',25],['pass',268]]){
      await change('#filterPass',mode);
      assert.equal(await evaluate('state.showList.length'),count);
      assert(await evaluate("state.showList.every(r=>state.filter==='all'||(state.filter==='pass'?r.pass:state.filter==='miss'?!r.pass&&!r.insufficient:r.insufficient))"));
    }
    await change('#filterPass','all');
    for(const sort of ['name','market','gain']){
      await change('#sortBy',sort);
      await evaluate("document.querySelector('[aria-describedby=sortByTip]').focus()");
      assert(await evaluate("getComputedStyle(document.querySelector('#sortByTip')).display!=='none' && document.querySelector('#sortByTip').innerText.includes('缺值')"));
    }
    const pos=await evaluate("(()=>{const r=document.querySelector('[aria-describedby=filterPassTip]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
    await renderer.call('Input.dispatchMouseEvent',{type:'mouseMoved',...pos});
    assert(await evaluate("getComputedStyle(document.querySelector('#filterPassTip')).display!=='none'"));
    await screenshot('tooltips');
    await nav('stock');await click('[data-pin="2404"]');
    await nav('screen');
    await evaluate("const input=document.querySelector('#searchCode');input.value='6488';input.dispatchEvent(new Event('input',{bubbles:true}));true");
    await click('[data-pin="6488"]');await nav('home');
  }
  const list=await evaluate("document.querySelector('#watchlist').innerText");
  assert(list.includes('2404')&&list.includes('6488'),list);
  await click('#watchlist [data-stock="6488"]');assert((await evaluate("document.querySelector('#page h1').textContent")).includes('6488'));
  await nav('home');await screenshot('pins');report.snapshots.watchlist=list;
  if(phase==='pins-remove'){await click('[data-pin="6488"]');assert(!(await evaluate("document.querySelector('#watchlist').innerText")).includes('6488'));}
}

async function overlayQA(){
  const evidence={};report.snapshots.charts=evidence;
  try {
    await waitFor(()=>evaluate("Object.keys(market.lists).length===2 && market.latest.TWSE && market.latest.TPEx"),540000,'two official lists and day quotes');
  } catch(e){
    const status=await evaluate("({lists:Object.keys(market.lists),latest:market.latest,status:market.status,busy:[...marketBusy]})");
    throw Error(e.message+' '+JSON.stringify(status));
  }
  report.snapshots.markets=await evaluate("Object.fromEntries(['TWSE','TPEx'].map(v=>[v,{date:market.lists[v].day,count:Object.keys(market.lists[v].rows).length,quote:market.latest[v],url:market.lists[v].url,hash:market.lists[v].hash,status:market.status[v+'day']}]))");
  await nav('data');await screenshot('market-sources');await nav('stock');
  assert.equal(await evaluate("document.querySelector('#overlay').checked"),false);
  async function readChart(code,range){
    const loaded=()=>evaluate(`(()=>{const q=chartRequest(),e=chartCache.get(q.key);return q.code==='${code}'&&state.chartRange==='${range}'&&e&&!e.busy?{errors:e.errors,count:Object.keys(e.bars).length}:null})()`);
    let loadedState=await waitFor(loaded,480000,'individual official months '+code);
    if(loadedState.errors.length){await click('#retryBars');loadedState=await waitFor(loaded,480000,'retry '+code);}
    assert.deepEqual(loadedState.errors,[],code+': '+loadedState.errors.join(';'));
    const result=await evaluate(`(()=>{
      const svg=document.querySelector('#combinedPlot svg'),days=plotDays(),bars={};
      for(const g of svg.querySelectorAll('g[data-bar]')){
        const d=g.dataset.bar,ohlc=g.dataset.ohlc.split(',').map(Number),x=Number(g.dataset.x);
        if(bars[d])throw Error('duplicate candle');
        const expected=57+(Date.parse(d)-Date.parse(days[0]))/(Date.parse(days.at(-1))-Date.parse(days[0]))*694;
        if(Math.abs(x-expected)>.00001||Math.abs(Number(g.querySelector('line').getAttribute('x1'))-x)>.00001)throw Error('candlestick date axis '+d);
        bars[d]=ohlc;
      }
      for(const dot of svg.querySelectorAll('circle[data-stat]')){
        const x=57+(Date.parse(dot.dataset.stat)-Date.parse(days[0]))/(Date.parse(days.at(-1))-Date.parse(days[0]))*694;
        if(Math.abs(Number(dot.getAttribute('cx'))-x)>.00001||!dot.textContent.includes('已證可用'))throw Error('statistic date axis');
      }
      return {days,bars,segments:svg.querySelectorAll('polyline[data-band-line="400"]').length};
    })()`);
    assert(Object.keys(result.bars).length>5,JSON.stringify(result));
    assert(!result.bars['2026-10-09']&&!result.bars['2026-10-23']&&!result.bars['2026-11-14']);
    if(range==='all')assert(result.segments>=2,'missing weeks must break lines');else assert.equal(result.days.length,3);
    evidence[code+'-'+range]=result;
    await screenshot(code+'-'+range);await record();
  }
  for(const code of ['2404','6488']){
    await evaluate("document.querySelector('#stockCode').value="+JSON.stringify(code));
    await click('#goStock');await click('[data-chart-range="recent"]');
    if(!(await evaluate("document.querySelector('#overlay').checked")))await click('#overlay');
    await readChart(code,'recent');await click('[data-chart-range="all"]');await readChart(code,'all');
    await click('[data-band="600"]');
    assert.equal(await evaluate("document.querySelectorAll('#combinedPlot svg g[data-bar]').length"),Object.keys(evidence[code+'-all'].bars).length);
    assert(await evaluate("!!document.querySelector('#combinedPlot [data-band-line=\"600\"]')"));
    await click('[data-band="600"]');
  }
  await change('#windowSelect','2026-10-30');
  assert.equal(await evaluate("document.querySelectorAll('#combinedPlot [data-bar]').length"),0);
  assert(await evaluate("!!document.querySelector('#combinedPlot [data-stat]') && document.querySelector('#combinedPlot').innerText.includes('截止時點')"));
  await screenshot('historical');console.log('B06 overlay',JSON.stringify({markets:report.snapshots.markets,ranges:Object.fromEntries(Object.entries(evidence).map(([k,v])=>[k,[v.days[0],v.days.at(-1),Object.keys(v.bars).length,v.segments]]))}));
}

async function main() {
  assert.equal(process.platform, 'win32');
  await launch(exePath);
  if(phase==='market-overlay'){await check(phase,overlayQA);assert.deepEqual(report.rendererErrors,[]);return;}
  if(phase.startsWith('pins-')){await check(phase,pinQA);assert.deepEqual(report.rendererErrors,[]);return;}
  if(phase.startsWith('live-')) {await check(phase,liveOfficialTest);assert.deepEqual(report.rendererErrors,[]);return;}
  if(phase.startsWith('pending-')) { await check(phase,pendingWeekTest); assert.deepEqual(report.rendererErrors,[]); console.log(phase,JSON.stringify(report.snapshots)); return; }
  if(phase==='weekly') { await check('weekly screen, stock and downloaded comparison CSV',verifyWeekly);console.log(phase,JSON.stringify(report.snapshots));assert.deepEqual(report.rendererErrors,[]);return; }
  if (phase.startsWith('revision-')) {
    if (phase === 'revision-seed') await check('two real mirror failures',seedMissedMirrors);
    if (phase === 'revision-recover') {
      await check('visible newest valid settings and snapshot',()=>verifyRevision(1));
      await check('save after recovery',()=>saveRevision(3));
    }
    if (phase === 'revision-reopen') await check('visible new values after restart',()=>verifyRevision(3));
    assert.deepEqual(report.rendererErrors,[]);
    console.log(phase,JSON.stringify(report.snapshots));
    return;
  }
  if (phase !== 'first' && phase !== 'moved') {
    if (phase === 'upgrade-source' || phase === 'seed') await check('save through UI',seedStorage);
    await check('read settings, scheme and stock data from screen',verifyStored);
    if(phase === 'write-failure') await check('failed writes preserve snapshot and settings',verifyWriteFailure);
    assert.deepEqual(report.rendererErrors,[]);
    console.log(phase,JSON.stringify(report.snapshots));
    return;
  }
  for (const route of routes) {
    await check(route, async () => {
      await nav(route);
      const title = await evaluate("document.querySelector('#page h1').textContent");
      assert(title.trim());
      report.snapshots[route] = {title};
      if (route === 'stock') {
        const text = await evaluate("document.querySelector('#page').innerText");
        assert(text.includes('漢唐') && text.includes('796,897') && text.includes('579,084'));
        const charts = await evaluate("Array.from(document.querySelectorAll('#page svg[role=img]'), s=>s.getAttribute('aria-label'))");
        assert(charts.some(x=>x?.includes('集保')) && charts.some(x=>x?.includes('成交量')));
        const delta = await evaluate("weeklySignal('2404',evaluation(DEFAULT)).deltaShares");
        assert.deepEqual(delta,[796897,579084]);
        report.snapshots[route] = {title,charts,delta};
      }
      await screenshot(route);
    });
  }
  await nav('settings');
  await click('#savePreset');
  assert(await evaluate("!!document.querySelector('dialog[open] input')"));
  await renderer.call('Input.dispatchKeyEvent', {type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await renderer.call('Input.dispatchKeyEvent', {type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor(()=>evaluate("!document.querySelector('dialog[open]')"),5000,'preset dialog cancel');
  assert.deepEqual(report.rendererErrors,[]);
  console.log(phase, JSON.stringify(report.snapshots));
}
main().catch(error=>{report.failure=error.stack||String(error);console.error(report.failure);process.exitCode=1;})
  .finally(async()=>{try{await stop();}finally{await record();}});
