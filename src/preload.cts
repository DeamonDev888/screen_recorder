import { contextBridge, ipcRenderer } from 'electron';

console.log('Preload script running...');

contextBridge.exposeInMainWorld('electronAPI', {
  getSources: () => ipcRenderer.invoke('get-sources'),
  saveVideo: (buffer: ArrayBuffer, thumbnail: string) => ipcRenderer.invoke('save-video', buffer, thumbnail),
  minimize: () => ipcRenderer.send('window-minimize'),
  close: () => ipcRenderer.send('window-close'),
  registerShortcuts: () => ipcRenderer.send('register-shortcuts'),
  unregisterShortcuts: () => ipcRenderer.send('unregister-shortcuts'),
  onShortcutStart: (callback: () => void) => ipcRenderer.on('shortcut-start', callback),
  onShortcutStop: (callback: () => void) => ipcRenderer.on('shortcut-stop', callback),
  revealInExplorer: (filePath: string) => ipcRenderer.send('reveal-in-explorer', filePath),
  openFile: (filePath: string) => ipcRenderer.send('open-file', filePath),
  loadLibrary: () => ipcRenderer.invoke('load-library'),
  toggleFullscreen: () => ipcRenderer.send('window-fullscreen'),
  renameFile: (filePath: string, newName: string) => ipcRenderer.invoke('rename-file', filePath, newName),
  deleteFile: (filePath: string) => ipcRenderer.invoke('delete-file', filePath),
  convertFile: (filePath: string, targetFormat: string) => ipcRenderer.invoke('convert-file', filePath, targetFormat),
  duplicateFile: (filePath: string) => ipcRenderer.invoke('duplicate-file', filePath),
  startDrag: (filePath: string) => ipcRenderer.send('start-drag', filePath)
});
