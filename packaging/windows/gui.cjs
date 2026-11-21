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

async function main() {
  assert.equal(process.platform, 'win32');
  await launch(exePath);
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
        const delta = await evaluate("calculate('2404','400',windows(2).at(-1),DEFAULT).deltaShares");
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
