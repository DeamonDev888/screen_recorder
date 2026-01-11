import { contextBridge, ipcRenderer, DesktopCapturerSource } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  saveVideo: (buffer: ArrayBuffer) => ipcRenderer.invoke('save-video', buffer),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  registerShortcuts: () => ipcRenderer.send('register-shortcuts'),
  unregisterShortcuts: () => ipcRenderer.send('unregister-shortcuts'),
  onShortcutStart: (callback: () => void) => ipcRenderer.on('shortcut-start', callback),
  onShortcutStop: (callback: () => void) => ipcRenderer.on('shortcut-stop', callback)
});
