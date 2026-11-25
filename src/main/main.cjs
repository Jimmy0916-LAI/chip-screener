'use strict';

/**
 * Electron 主行程入口
 * 負責：單實例鎖定、radar:// 安全協定與 CSP、本機資料與官方更新 IPC 通道、主視窗生命週期。
 */

const { app, BrowserWindow, Menu, protocol, shell, ipcMain, dialog } = require('electron');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { LocalStore } = require('./storage.cjs');
const { OfficialFeed } = require('./official-feed.cjs');

const DASHBOARD_URL = 'radar://desktop/index.html';
const DASHBOARD_FILE = path.join(__dirname, '..', '..', 'build', 'dashboard.html');
const FEED_BASE_FILE = path.join(__dirname, '..', '..', 'data', 'feed-base.json');
const PRELOAD_FILE = path.join(__dirname, 'preload.cjs');

const OFFICIAL_LINKS = new Set([
  'https://www.tdcc.com.tw/portal/zh/smWeb/qryStock',
  'https://www.twse.com.tw/',
  'https://www.tpex.org.tw/'
]);

const CSP_HEADER = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'"
].join('; ');

protocol.registerSchemesAsPrivileged([
  { scheme: 'radar', privileges: { standard: true, secure: true } }
]);

app.setPath('userData', path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'ChipScreener'));
app.commandLine.appendSwitch('disable-background-networking');

function isTrustedSender(event) {
  return event.senderFrame === event.sender.mainFrame && event.senderFrame.url === DASHBOARD_URL;
}

function registerIpcHandlers(store, feed) {
  let pendingUpdate = null;

  ipcMain.on('official:read', event => {
    event.returnValue = isTrustedSender(event) ? feed.initial() : null;
  });

  ipcMain.handle('official:update', event => {
    if (!isTrustedSender(event)) throw Error('來源無效');
    pendingUpdate ||= feed.update().finally(() => {
      pendingUpdate = null;
    });
    return pendingUpdate;
  });

  ipcMain.on('storage:read', (event, kind) => {
    try {
      if (!isTrustedSender(event) || !['settings', 'snapshot'].includes(kind)) throw Error('來源無效');
      const { value, slot, damaged } = store.read(kind);
      event.returnValue = { ok: true, value, slot, damaged, version: app.getVersion() };
    } catch (error) {
      event.returnValue = { ok: false, error: error.message };
    }
  });

  ipcMain.on('storage:save', (event, kind, value) => {
    try {
      if (!isTrustedSender(event) || !['settings', 'snapshot'].includes(kind)) throw Error('來源無效');
      event.returnValue = { ok: true, ...store.save(kind, value) };
    } catch (error) {
      event.returnValue = { ok: false, error: error.message };
    }
  });
}

function registerDashboardProtocol() {
  protocol.handle('radar', async request => {
    if (request.url !== DASHBOARD_URL) return new Response(null, { status: 404 });
    const html = await readFile(DASHBOARD_FILE);
    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': CSP_HEADER
      }
    });
  });
}

async function openWindow() {
  const userDataDir = app.getPath('userData');
  const store = new LocalStore(path.join(userDataDir, 'store-v1'));
  const feed = new OfficialFeed(path.join(userDataDir, 'tdcc-v1'), require(FEED_BASE_FILE));

  registerIpcHandlers(store, feed);
  registerDashboardProtocol();
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    title: '台股籌碼雷達',
    width: 1360,
    height: 880,
    minWidth: 800,
    minHeight: 570,
    backgroundColor: '#0b0e14',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD_FILE
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (OFFICIAL_LINKS.has(url)) shell.openExternal(url).catch(console.error);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (url !== DASHBOARD_URL) event.preventDefault();
  });

  await win.loadURL(DASHBOARD_URL);
  win.show();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.on('window-all-closed', () => app.quit());

  app.whenReady().then(openWindow).catch(error => {
    dialog.showErrorBox('台股籌碼雷達無法開啟', String(error.message));
    app.exit(1);
  });
}
