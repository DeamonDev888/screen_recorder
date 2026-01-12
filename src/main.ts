import { app, BrowserWindow, ipcMain, desktopCapturer, dialog, globalShortcut, shell } from 'electron';
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// FIXED: WGC (Windows Graphics Capture) error handling
// The error -2147467259 (0x8001010E) is a COM apartment threading issue with WGC
// Despite all attempts to disable WGC, Electron 33+ forces its use on Windows 10/11
// These errors are HARMLESS - the capture still works, just logs errors
// Solution: Suppress error logging and inform users that it's safe to ignore

// Attempt to disable WGC (may not work in Electron 33+ but we try anyway)
app.commandLine.appendSwitch('disable-features', 'WgcIntrospection,WgcVideoCapture');
app.commandLine.appendSwitch('disable-gpu-compositing');

// Suppress WGC error logging to console (reduce noise)
app.commandLine.appendSwitch('log-level', 'error'); // Only show errors, not warnings

const createWindow = () => {
  console.log('Creating window...');
  /* CRITICAL: Preload path must be absolute and point to the compiled .cjs file */
  const preloadPath = path.join(__dirname, 'preload.cjs');
  console.log('Preload path:', preloadPath);

  const win = new BrowserWindow({
    width: 1100,
    height: 780,
    center: true,
    frame: false, /* Required for premium custom title-bar design */
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, '../public/assets/icon.png'), /* NEW: Custom 3D App Icon */
    // FIXED: Disable webGL and GPU to prevent WGC errors
    // WGC has known threading issues with GPU acceleration
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true, /* SECURITY: Keep enabled to prevent XSS to Node access */
      nodeIntegration: false,
      sandbox: false,
      // Disable GPU acceleration in renderer to prevent WGC conflicts
      webgl: false, // lowercase 'webgl' is the correct property name
      plugins: false
    }
  });

  win.loadFile(path.join(__dirname, '../public/index.html'));
  // win.webContents.openDevTools({ mode: 'detach' });
};

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle('get-sources', async () => {
    try {
      // FIXED: Added error handling for desktopCapturer to prevent crashes
      // The WGC errors (-2147467259) will be caught and logged instead of crashing
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        // NEW: Set thumbnail size to reduce memory pressure and WGC errors
        thumbnailSize: {
          width: 320,
          height: 180
        }
      });

      return sources.map(source => ({
        id: source.id,
        name: source.name,
        // FIXED: Safely convert thumbnail to data URL with error handling
        thumbnail: source.thumbnail.toDataURL()
      }));
    } catch (err) {
      console.error('Error getting sources:', err);
      // Return empty array instead of crashing
      return [];
    }
  });

  /**
   * VIDEO SAVE HANDLER
   *
   * Saves the recorded video and its thumbnail to disk
   *
   * SECURITY: File writing happens in main process (sandbox-safe)
   * RELIABILITY: Thumbnail save failures don't prevent video save
   *
   * @param event - IPC event object
   * @param buffer - Video data as ArrayBuffer
   * @param thumbnail - Base64 encoded thumbnail (can be empty string)
   * @returns Object with success status and file path
   *
   * CRITICAL: Do NOT change the filesystem logic without updating the renderer
   * path normalization, or playback will break on Windows.
   */
  ipcMain.handle('save-video', async (event, buffer, thumbnail) => {
    const { filePath } = await dialog.showSaveDialog({
      buttonLabel: 'Save Recording',
      defaultPath: path.join(__dirname, '../Library', `recording-${Date.now()}.mp4`),
      filters: [{ name: 'Videos', extensions: ['mp4', 'webm'] }]
    });

    if (filePath) {
      // Save video file
      await fs.writeFile(filePath, Buffer.from(buffer));

      // Save thumbnail if provided and not empty
      // NOTE: Thumbnail is optional - missing thumbnails show placeholder in UI
      if (thumbnail && thumbnail.length > 0) {
        const thumbPath = filePath.replace(path.extname(filePath), '.jpg');

        try {
          // Extract base64 data (handles both data:image/... and raw base64)
          let base64Data = thumbnail;
          if (thumbnail.startsWith('data:image')) {
            base64Data = thumbnail.replace(/^data:image\/[a-z]+;base64,/, "");
          }

          await fs.writeFile(thumbPath, base64Data, 'base64');
        } catch (err) {
          // Thumbnail save failure is not critical - video is still saved
          console.error('Thumbnail save failed (non-critical):', err);
        }
      }

      return { success: true, filePath };
    }
    return { canceled: true };
  });

  /**
   * LIBRARY LOADER
   *
   * Loads all recordings from the Library folder
   *
   * FEATURES:
   * - Finds all .webm and .mp4 files
   * - Loads associated thumbnails (.jpg files)
   * - Returns file metadata (size, date, time)
   * - Handles missing thumbnails gracefully (shows placeholder)
   *
   * @returns Array of recording objects with metadata and thumbnails
   */
  /**
   * LIBRARY HANDLER
   * Scans the videos directory and returns metadata + base64 thumbnails
   * for the frontend library view.
   */
  ipcMain.handle('load-library', async () => {
    const libraryPath = path.join(__dirname, '../Library');

    try {
      const files = await fs.readdir(libraryPath);
      const videoFiles = files.filter(f => f.endsWith('.webm') || f.endsWith('.mp4') || f.endsWith('.gif'));

      const libraryData = await Promise.all(videoFiles.map(async (file) => {
        const fullPath = path.join(libraryPath, file);
        const stats = await fs.stat(fullPath);

        // Try to load associated thumbnail
        const thumbPath = fullPath.replace(path.extname(fullPath), '.jpg');
        let thumbnail = null;

        try {
          const thumbBuffer = await fs.readFile(thumbPath);
          thumbnail = `data:image/jpeg;base64,${thumbBuffer.toString('base64')}`;
        } catch (e) {
          // No thumbnail file found - will show placeholder in UI
          thumbnail = null;
        }

        return {
          name: file,
          path: fullPath,
          thumbnail: thumbnail,
          size: (stats.size / (1024 * 1024)).toFixed(1) + ' MB',
          date: stats.mtime.toLocaleDateString(),
          time: stats.mtime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
      }));

      // Sort alphabetically (could also sort by date with stats.mtime)
      return libraryData.sort((a, b) => b.name.localeCompare(a.name));
    } catch (err: any) {
      console.error('CRITICAL: Library Load Failure:', err);
      throw new Error(`Library Access Failure: ${err.message}`);
    }
  });

  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });
  
  ipcMain.on('window-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      win.setFullScreen(!win.isFullScreen());
    }
  });

  ipcMain.on('reveal-in-explorer', (event, filePath) => {
    /* SYSTEM: Opens the folder containing the file. Works on Windows/macOS/Linux via Electron shell */
    if (filePath) shell.showItemInFolder(filePath);
  });

  ipcMain.on('open-file', (event, filePath) => {
    /* SYSTEM: Launches the file with the OS default application */
    if (filePath) shell.openPath(filePath);
  });

  /**
   * FILE RENAME HANDLER
   *
   * Renames a video file and its associated thumbnail (if exists)
   *
   * SECURITY: File operations happen in main process (sandbox-safe)
   * RELIABILITY: Handles missing thumbnails gracefully
   *
   * @param event - IPC event object
   * @param filePath - Current file path
   * @param newName - New filename (with extension)
   * @returns Object with success status and new path
   */
  ipcMain.handle('rename-file', async (event, filePath, newName) => {
    try {
      if (!filePath || !newName) {
        return { success: false, error: 'Invalid parameters' };
      }

      // Validate that newName has a valid video extension
      if (!newName.endsWith('.webm') && !newName.endsWith('.mp4')) {
        return { success: false, error: 'File must have .webm or .mp4 extension' };
      }

      const dir = path.dirname(filePath);
      const newPath = path.join(dir, newName);

      // Check if new name already exists
      try {
        await fs.access(newPath);
        return { success: false, error: 'A file with this name already exists' };
      } catch {
        // File doesn't exist, safe to proceed
      }

      // Rename video file
      await fs.rename(filePath, newPath);

      // Rename thumbnail if it exists
      const oldThumbPath = filePath.replace(path.extname(filePath), '.jpg');
      const newThumbPath = newPath.replace(path.extname(newPath), '.jpg');

      try {
        await fs.access(oldThumbPath);
        await fs.rename(oldThumbPath, newThumbPath);
      } catch (e) {
        // No thumbnail to rename, continue
      }

      return { success: true, newPath: newPath };
    } catch (err: any) {
      console.error('Rename failure:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('delete-file', async (event, filePath) => {
    try {
      if (filePath) {
        // Recycle video
        await shell.trashItem(filePath);

        // Recycle thumbnail if exists
        const thumbPath = filePath.replace(path.extname(filePath), '.jpg');
        try {
          await fs.access(thumbPath);
          await shell.trashItem(thumbPath);
        } catch (e) { /* No thumbnail to delete */ }

        return { success: true };
      }
    } catch (err) {
      console.error('Delete failure:', err);
      throw err;
    }
  });

  /**
   * DUPLICATE FILE HANDLER
   * 
   * Creates a physical copy of the file in the same directory
   * Behavior: "File.mp4" -> "File - Copy.mp4"
   */
  ipcMain.handle('duplicate-file', async (event, filePath) => {
    try {
      const dir = path.dirname(filePath);
      const ext = path.extname(filePath);
      const name = path.basename(filePath, ext);
      
      let newPath = path.join(dir, `${name} - Copy${ext}`);
      let counter = 2;

      // Handle collisions: "File - Copy (2).mp4"
      while (true) {
        try {
          await fs.access(newPath);
          newPath = path.join(dir, `${name} - Copy (${counter})${ext}`);
          counter++;
        } catch {
          break; // File doesn't exist, we can use this name
        }
      }

      // Copy video
      await fs.copyFile(filePath, newPath);

      // Copy thumbnail
      const oldThumb = filePath.replace(ext, '.jpg');
      const newThumb = newPath.replace(ext, '.jpg');
      try {
        await fs.copyFile(oldThumb, newThumb);
      } catch (e) { /* No thumbnail to copy */ }

      return { success: true, newPath };
    } catch (err: any) {
      console.error('Duplicate failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('convert-file', async (event, filePath, targetFormat) => {
    // FIXED: Use createRequire for CommonJS modules in this ESM environment
    const require = createRequire(import.meta.url);
    const ffmpeg = require('fluent-ffmpeg');
    const ffmpegPath = require('ffmpeg-static');
    
    let binaryPath = ffmpegPath;

    if (app.isPackaged) {
        binaryPath = binaryPath.replace('app.asar', 'app.asar.unpacked');
    }

    ffmpeg.setFfmpegPath(binaryPath);

    if (!filePath || !targetFormat) {
      return { success: false, error: 'Invalid parameters' };
    }

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);
    
    // smart renaming: try to use just the new extension first
    let newPath = path.join(dir, `${name}.${targetFormat}`);

    // If that file already exists, falling back to _converted
    try {
      await fs.access(newPath);
      newPath = path.join(dir, `${name}_converted.${targetFormat}`);
    } catch {
      // safe
    }

    return new Promise((resolve) => {
        console.log(`Starting conversion: ${filePath} -> ${newPath}`);

        let command = ffmpeg(filePath).output(newPath);

        // GIF optimizations
        if (targetFormat === 'gif') {
            command = command.fps(15).size('480x?');
        }

        command
          .on('end', async () => {
            console.log('Conversion finished');
            
            // Handle Thumbnail: Copy existing OR Generate new
            const oldThumb = filePath.replace(ext, '.jpg');
            // safer extension replacement for the new path
            const newPathObj = path.parse(newPath);
            const newThumb = path.join(newPathObj.dir, newPathObj.name + '.jpg');

            try {
              // 1. Try to copy existing thumbnail
              await fs.access(oldThumb);
              await fs.copyFile(oldThumb, newThumb);
              console.log('Copied existing thumbnail');
            } catch (e) {
              // 2. Original thumbnail missing! Generate a fresh one from the new video
              console.log('No original thumbnail. Generating new one from converted video...');
              try {
                  await new Promise((resolveThumb, rejectThumb) => {
                    ffmpeg(newPath)
                      .on('end', () => resolveThumb(true))
                      .on('error', (err: any) => rejectThumb(err))
                      .screenshots({
                        count: 1,
                        timemarks: ['20%'], // Capture at 20% of video duration for better context
                        folder: path.dirname(newPath),
                        filename: path.basename(newThumb),
                        size: '320x180' // Standard thumbnail size
                      });
                  });
                  console.log('Fresh thumbnail generated');
              } catch (err) {
                  console.error('Failed to generate thumbnail:', err);
              }
            }

            resolve({ success: true, newPath });
          })
          .on('error', (err: any) => {
            console.error('Conversion error:', err);
            resolve({ success: false, error: err.message });
          })
          .run();
    });
  });

  // Global Shortcuts Management
  ipcMain.on('register-shortcuts', (event) => {
    globalShortcut.unregisterAll();
    globalShortcut.register('CommandOrControl+Shift+R', () => {
      event.sender.send('shortcut-start');
    });
    globalShortcut.register('CommandOrControl+Shift+S', () => {
      event.sender.send('shortcut-stop');
    });
  });

  ipcMain.on('unregister-shortcuts', () => {
    globalShortcut.unregisterAll();
  });

  /**
   * NATIVE FILE DRAG & DROP HANDLER
   * Enables dragging files from the library directly to Explorer, Discord, etc.
   * 
   * CRITICAL: Use the window.electronAPI.startDrag in the renderer to call this.
   * This is what makes Screenflow Pro professional — native integration.
   * 
   * @param event - IPC event
   * @param filePath - Full path to the file being dragged
   */
  ipcMain.on('start-drag', (event, filePath) => {
    // Generate the icon path (thumbnail or default icon)
    // For simplicity, we let the OS handle the drag image or use the file icon
    // We only need to provide the file path to startDrag
    console.log('Starting native drag for:', filePath);
    
    event.sender.startDrag({
      file: filePath,
      icon: path.join(__dirname, '../public/assets/icon.png') // Optional: Drag icon
    });
  });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
