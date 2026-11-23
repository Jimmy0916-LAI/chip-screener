'use strict';
const { app, BrowserWindow, Menu, protocol, shell, ipcMain } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const dashboard = 'radar://desktop/index.html';
const officialLinks = new Set([
  'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock',
  'https://www.twse.com.tw/',
  'https://www.tpex.org.tw/'
]);
protocol.registerSchemesAsPrivileged([
  { scheme: 'radar', privileges: { standard: true, secure: true } }
]);
app.setPath('userData', path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'ChipScreener'));
app.commandLine.appendSwitch('disable-background-networking');

async function openWindow() {
  const { LocalStore } = require('./storage.cjs');
  const store = new LocalStore(path.join(app.getPath('userData'), 'store-v1'));
  const {OfficialFeed}=require('./official-feed.cjs');
  const feed=new OfficialFeed(path.join(app.getPath('userData'),'tdcc-v1'),require('./feed-base.json'));
  let update;
  const trusted=event=>event.senderFrame===event.sender.mainFrame && event.senderFrame.url===dashboard;
  ipcMain.on('official:read',event=>{event.returnValue=trusted(event)?feed.initial():null;});
  ipcMain.handle('official:update',event=>{
    if (!trusted(event)) throw Error('來源無效');
    update ||= feed.update().finally(()=>{update=null;});
    return update;
  });
  for (const action of ['read', 'save']) {
    ipcMain.on('storage:' + action, (event, kind, value) => {
      try {
        if (!trusted(event) || !['settings','snapshot','pins'].includes(kind)) throw Error('來源無效');
        if (action === 'save') {
          event.returnValue = {ok:true, ...store.save(kind, value)};
        } else {
          const {value: saved, slot, damaged} = store.read(kind);
          event.returnValue = {ok:true, value:saved, slot, damaged, version:app.getVersion()};
        }
      } catch (error) { event.returnValue = {ok:false,error:error.message}; }
    });
  }
  protocol.handle('radar', async request => {
    if (request.url !== dashboard) return new Response(null, { status: 404 });
    const html = await readFile(path.join(__dirname, 'dashboard.html'));
    return new Response(html, { headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
    } });
  });
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    title: '台股籌碼雷達', width: 1360, height: 880, minWidth: 800, minHeight: 570,
    backgroundColor: '#0c131f', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (officialLinks.has(url)) shell.openExternal(url).catch(console.error);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== dashboard) event.preventDefault();
  });
  await win.loadURL(dashboard);
  // Electron omits the browser's window.prompt; keep the existing save action.
  await win.webContents.executeJavaScript(await readFile(path.join(__dirname, 'preset-dialog.js'), 'utf8'));
  win.show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(openWindow).catch(error => {
    require('electron').dialog.showErrorBox('台股籌碼雷達無法開啟', String(error.message));
    app.exit(1);
  });
}
