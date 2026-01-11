import { app, BrowserWindow, ipcMain, desktopCapturer, dialog } from 'electron';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const createWindow = () => {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    frame: false,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '../index.html'));
};

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('get-sources', async () => {
    const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
    return sources.map(source => ({
      id: source.id,
      name: source.name,
      thumbnail: source.thumbnail.toDataURL()
    }));
  });

  ipcMain.handle('save-video', async (event, buffer) => {
    const { filePath } = await dialog.showSaveDialog({
      buttonLabel: 'Save Recording',
      defaultPath: `recording-${Date.now()}.webm`,
      filters: [{ name: 'WebM Video', extensions: ['webm'] }]
    });

    if (filePath) {
      await fs.writeFile(filePath, Buffer.from(buffer));
      return { success: true, filePath };
    }
    return { canceled: true };
  });

  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
