'use strict';

/**
 * Electron Preload 橋接層
 * 僅在 radar://desktop/index.html 暴露受控的本機儲存與官方更新 API。
 */

const { contextBridge, ipcRenderer } = require('electron');

if (location.href === 'radar://desktop/index.html') {
  contextBridge.exposeInMainWorld('officialFeed', {
    read: () => ipcRenderer.sendSync('official:read'),
    update: () => ipcRenderer.invoke('official:update')
  });

  contextBridge.exposeInMainWorld('desktopStore', {
    read: kind => ipcRenderer.sendSync('storage:read', kind),
    save: (kind, value) => ipcRenderer.sendSync('storage:save', kind, value)
  });
}
