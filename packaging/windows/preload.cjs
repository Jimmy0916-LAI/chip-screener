'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if(location.href === 'radar://desktop/index.html') {
  contextBridge.exposeInMainWorld('marketFeed',{
    read:()=>ipcRenderer.sendSync('market:read'),
    subscribe:callback=>{ipcRenderer.on('market:changed',(_event,summary)=>callback(summary));},
    update:(venue,kind)=>ipcRenderer.invoke('market:update',venue,kind),
    history:(venue,code,start,end,refresh)=>ipcRenderer.invoke('market:history',venue,code,start,end,refresh)
  });
  contextBridge.exposeInMainWorld('officialFeed',{
    read:()=>ipcRenderer.sendSync('official:read'),
    update:()=>ipcRenderer.invoke('official:update')
  });
  contextBridge.exposeInMainWorld('desktopStore',{
    read: kind => ipcRenderer.sendSync('storage:read',kind),
    save: (kind,value) => ipcRenderer.sendSync('storage:save',kind,value)
  });
}
