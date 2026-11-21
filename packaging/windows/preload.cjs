'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if(location.href === 'radar://desktop/index.html') {
  contextBridge.exposeInMainWorld('desktopStore',{
    read: kind => ipcRenderer.sendSync('storage:read',kind),
    save: (kind,value) => ipcRenderer.sendSync('storage:save',kind,value)
  });
}
