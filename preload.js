const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wallApi', {
  reloadView: () => ipcRenderer.invoke('reload-view'),
  setBrightness: (percent) => ipcRenderer.invoke('set-brightness', percent),
  // Nur ANHEBEN, nie senken -- siehe control/lautstaerke.js. Der Warnton nuetzt nichts, wenn
  // das Geraet stumm an der Wand haengt.
  systemLautstaerkeAnheben: (prozent) => ipcRenderer.invoke('system-lautstaerke-anheben', prozent),
  // Windows-Hintergrund setzen -- sichtbar nur waehrend eines Updates, wenn die App weg ist.
  desktopHintergrundSetzen: (art) => ipcRenderer.invoke('desktop-hintergrund-setzen', art),
  // Panelsteuerung: Zustand abfragen, Zustandswechsel abonnieren, Pause ausloesen.
  getControlState: () => ipcRenderer.invoke('get-control-state'),
  pausePanelControl: (minutes) => ipcRenderer.invoke('pause-panel-control', minutes),
  onControlState: (callback) => {
    const handler = (event, state) => callback(state);
    ipcRenderer.on('control-state', handler);
    return () => ipcRenderer.removeListener('control-state', handler);
  }
});
