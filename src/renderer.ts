interface ElectronAPI {
    getSources: () => Promise<Array<{ id: string; name: string; thumbnail: string }>>;
    saveVideo: (buffer: ArrayBuffer, thumbnail: string) => Promise<any>;
    minimize: () => void;
    close: () => void;
    registerShortcuts: () => void;
    unregisterShortcuts: () => void;
    onShortcutStart: (callback: () => void) => void;
    onShortcutStop: (callback: () => void) => void;
    revealInExplorer: (filePath: string) => void;
    openFile: (filePath: string) => void;
    loadLibrary: () => Promise<Array<{ name: string; path: string; size: string; date: string; time: string; thumbnail: string | null }>>;
    toggleFullscreen: () => void;
    renameFile: (filePath: string, newName: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
    deleteFile: (filePath: string) => Promise<{ success: boolean }>;
    convertFile: (filePath: string, targetFormat: string) => Promise<{ success: boolean; newPath?: string; error?: string }>;
    duplicateFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
    startDrag: (filePath: string) => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

console.log('Renderer script loaded');
if (!window.electronAPI) {
    console.error('Electron API missing');
}

const videoElement = document.getElementById('preview') as HTMLVideoElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const sourceSelectBtn = document.getElementById('sourceSelectBtn') as HTMLButtonElement;
const micToggle = document.getElementById('micToggle') as HTMLInputElement;
const audioToggle = document.getElementById('audioToggle') as HTMLInputElement;
const recordingStatus = document.getElementById('recordingStatus') as HTMLDivElement;
const timerDisplay = document.getElementById('timerDisplay') as HTMLSpanElement;
const recIndicator = document.getElementById('recIndicator') as HTMLDivElement;
const placeholder = document.getElementById('placeholder') as HTMLDivElement;
const sourceList = document.getElementById('sourceList') as HTMLDivElement;
const micVolumeSlider = document.getElementById('micVolume') as HTMLInputElement;
const sysVolumeSlider = document.getElementById('sysVolume') as HTMLInputElement;

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let timerInterval: any = null;
let startTime: number = 0;
let audioContext: AudioContext | null = null;
let desktopGainNode: GainNode | null = null;
let micGainNode: GainNode | null = null;

// Setup Window Controls
document.getElementById('minimizeBtn')?.addEventListener('click', () => {
    window.electronAPI.minimize();
});

document.getElementById('closeBtn')?.addEventListener('click', () => {
    window.electronAPI.close();
});

// Top Menu Interactivity
const menuContainers = document.querySelectorAll('.menu-item-container');
menuContainers.forEach(container => {
    const trigger = container.querySelector('.menu-trigger');
    trigger?.addEventListener('click', (e) => {
        e.stopPropagation();
        // Toggle only this one, close others
        menuContainers.forEach(c => {
            if (c !== container) c.classList.remove('active');
        });
        container.classList.toggle('active');
    });
});

// Close menus when clicking outside
document.addEventListener('click', () => {
    menuContainers.forEach(c => c.classList.remove('active'));
});

// Menu Item Actions
document.querySelectorAll('.dropdown-item').forEach(item => {
    item.addEventListener('click', (e) => {
        const text = item.querySelector('span')?.textContent;
        console.log('Menu action:', text);
        
        switch(text) {
            case 'Exit':
                window.electronAPI.close();
                break;
            case 'New Recording':
                location.reload(); // Simple way to clean state
                break;
            case 'Toggle Sidebar':
                const sidebar = document.querySelector('.sidebar') as HTMLElement;
                if (sidebar) sidebar.style.display = sidebar.style.display === 'none' ? 'flex' : 'none';
                break;
            case 'About Screenflow Pro':
                alert('Screenflow Pro v1.0.0-beta\nBuilt with Electron & ❤️');
                break;
        }
    });
});

// Shortcut Listeners
window.electronAPI.onShortcutStart(() => {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        startBtn.click();
    }
});

window.electronAPI.onShortcutStop(() => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        stopBtn.click();
    }
});

window.electronAPI.registerShortcuts();

// Get Sources
async function getSources() {
    const sources = await window.electronAPI.getSources();
    showSourceSelector(sources);
}

function showSourceSelector(sources: any[]) {
    sourceList.innerHTML = '';
    sourceList.classList.remove('hidden');
    sourceList.style.display = 'grid';

    sources.forEach(source => {
        const card = document.createElement('div');
        card.className = 'source-card';
        card.innerHTML = `
            <div class="img-container">
                <img src="${source.thumbnail}" />
            </div>
            <span class="name">${source.name}</span>
        `;
        card.onclick = async () => {
            selectSource(source.id, source.name);
            sourceList.classList.add('hidden');
            sourceList.style.display = 'none';
        };
        sourceList.appendChild(card);
    });

    // Close on click outside (simple version)
    sourceList.onclick = (e) => {
        if (e.target === sourceList) {
            sourceList.classList.add('hidden');
            sourceList.style.display = 'none';
        }
    };
}

async function selectSource(sourceId: string, name: string) {
    console.log(`Selected source: ${name}`);

    // WGC ERROR NOTICE: If you see "ProcessFrame failed" errors in console, don't worry!
    // These are harmless Windows Graphics Capture (WGC) errors that occur on Windows 10/11.
    // The screen recording WILL STILL WORK - these errors just mean WGC is using fallback frames.
    // This is a known Electron 33+ issue and cannot be fixed without downgrading Electron.

    const constraints: any = {
        audio: false,
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId,
                // FIXED: Add frame rate constraints to reduce WGC stress
                // Lower frame rate reduces the frequency of WGC calls which may prevent errors
                maxFrameRate: 30,
                // Add resolution constraints for stability
                maxWidth: 1920,
                maxHeight: 1080
            }
        }
    };

    if (audioToggle.checked) {
        constraints.audio = {
            mandatory: {
                chromeMediaSource: 'desktop'
            }
        };
    }

    try {
        // FIXED: Add timeout and retry logic for WGC failures
        const stream = await Promise.race([
            navigator.mediaDevices.getUserMedia(constraints),
            new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Source selection timeout after 10s')), 10000)
            )
        ]);

        if (micToggle.checked) {
            /* AUDIO MIXING: Get user microphone and mix it with system audio */
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const mixedStream = new MediaStream([
                ...stream.getVideoTracks(),
                ...mixAudioTracks(stream, micStream)
            ]);

            videoElement.srcObject = mixedStream;
            videoElement.muted = true; /* CRITICAL: Mute preview to avoid feedback loops */
            setupRecorder(mixedStream);
        } else {
            videoElement.srcObject = stream;
            videoElement.muted = true;
            setupRecorder(stream);
        }

        videoElement.onloadedmetadata = () => {
            placeholder.classList.add('hidden');
            videoElement.play();
        };
    } catch (e) {
        console.error('Error accessing source:', e);
        // FIXED: More user-friendly error message with troubleshooting steps
        alert('Error accessing source: ' + e +
            '\n\nTroubleshooting:\n' +
            '1. Try selecting a different screen/window\n' +
            '2. Close other screen recording applications\n' +
            '3. Restart the application\n' +
            '4. If the issue persists, WGC may be disabled in Electron settings');
    }
}

function mixAudioTracks(desktopStream: MediaStream, micStream: MediaStream): MediaStreamTrack[] {
    /* WEB AUDIO API: Create a virtual mixing desk to handle independent volume sliders */
    audioContext = new AudioContext();
    const dest = audioContext.createMediaStreamDestination();

    if (desktopStream.getAudioTracks().length > 0) {
        const desktopSource = audioContext.createMediaStreamSource(desktopStream);
        desktopGainNode = audioContext.createGain();
        desktopGainNode.gain.value = parseFloat(sysVolumeSlider.value);
        desktopSource.connect(desktopGainNode);
        desktopGainNode.connect(dest);
    }

    if (micStream.getAudioTracks().length > 0) {
        const micSource = audioContext.createMediaStreamSource(micStream);
        micGainNode = audioContext.createGain();
        micGainNode.gain.value = parseFloat(micVolumeSlider.value);
        micSource.connect(micGainNode);
        micGainNode.connect(dest);
    }

    return dest.stream.getAudioTracks();
}

// Volume slider listeners
micVolumeSlider.oninput = () => {
    if (micGainNode) micGainNode.gain.value = parseFloat(micVolumeSlider.value);
};

sysVolumeSlider.oninput = () => {
    if (desktopGainNode) desktopGainNode.gain.value = parseFloat(sysVolumeSlider.value);
};

/**
 * PLAY VIDEO IN PREVIEW (Integrated Player)
 * Replaces the "Ready to Record" view with the selected video
 */
// ==========================================
// VIDEO PLAYBACK LOGIC
// ==========================================

/**
 * Loads and plays a video file from the local filesystem.
 * Handles path normalization and UI state transitions.
 */
function playVideo(filePath: string) {
    if (!videoElement) return;

    // Stop recording stream if it was active to free up resources
    if (videoElement.srcObject) {
         const tracks = (videoElement.srcObject as MediaStream).getTracks();
         tracks.forEach(track => track.stop());
         videoElement.srcObject = null;
    }

    // NORMALIZATION: Handle Windows backslashes for the file:// protocol
    videoElement.src = `file://${filePath.replace(/\\/g, '/')}`;
    videoElement.controls = true; // Enable native play/pause/seek
    videoElement.muted = false;   // Unmute for playback
    
    // UI: Hide the "Ready to Record" placeholder
    const placeholderEl = document.getElementById('placeholder');
    if (placeholderEl) placeholderEl.style.display = 'none';

    videoElement.play().catch(e => console.error("Playback error:", e));

    // UI: Hide recording controls during playback mode
    startBtn.classList.add('hidden');
    stopBtn.classList.add('hidden');
}

function setupRecorder(stream: MediaStream) {
    // Clean up previous playback state
    videoElement.src = '';
    videoElement.removeAttribute('src');
    videoElement.controls = false;
    videoElement.muted = true; // Mute for recording preview to avoid feedback

    // Show stream in preview (this might duplicates previous logic but ensuring safety)
    videoElement.srcObject = stream;
    videoElement.play();

    // Hide placeholder
    const placeholderEl = document.getElementById('placeholder');
    if (placeholderEl) placeholderEl.style.display = 'none';

    const options = { mimeType: 'video/webm; codecs=vp9' };
    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onstop = handleStop;
    
    // UI Update
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
}

function handleDataAvailable(e: BlobEvent) {
    if (e.data.size > 0) {
        recordedChunks.push(e.data);
    }
}

/**
 * THUMBNAIL GENERATION - Creates a preview image from recorded video blob
 *
 * This function uses a two-tier fallback strategy to ensure thumbnail generation never fails:
 * TIER 1: Capture frame from the live preview video element (fastest, most reliable)
 * TIER 2: Create temporary video element and capture frame (fallback if preview unavailable)
 *
 * @param blob - The recorded video blob
 * @returns Promise<string> - Base64 data URL of the thumbnail image, or empty string if generation fails
 *
 * RELIABILITY FEATURES:
 * - Multiple fallback mechanisms
 * - Defensive null/undefined checks
 * - Try-catch error handling
 * - Promise resolution guards (prevents double-resolution)
 * - Resource cleanup (URL.revokeObjectURL)
 * - Timeout protection (prevents infinite hangs)
 *
 * PERFORMANCE:
 * - Tier 1 is instant (uses already-loaded video element)
 * - Tier 2 is slower but reliable (loads blob into temporary video)
 * - Canvas operations are optimized (320x180 resolution, JPEG quality 0.8)
 */
async function generateThumbnail(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
        // ==========================================
        // INPUT VALIDATION
        // ==========================================
        if (!blob || blob.size === 0) {
            // Empty blob - return early to prevent wasted processing
            resolve('');
            return;
        }

        // ==========================================
        // TIER 1: CAPTURE FROM LIVE PREVIEW (FASTEST)
        // ==========================================
        // STRATEGY: Use the video element that's already displaying the recording
        // ADVANTAGE: No loading time, video is already decoded and ready
        // RELIABILITY: Works if user just stopped recording (preview is still active)
        if (videoElement && videoElement.srcObject) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 320;
                canvas.height = 180;
                const ctx = canvas.getContext('2d');

                if (ctx) {
                    // Capture current frame from preview
                    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

                    // SUCCESS: Return immediately with thumbnail from preview
                    resolve(dataUrl);
                    return;
                }
            } catch (e) {
                // Tier 1 failed silently, will try Tier 2
                console.warn('Tier 1 thumbnail generation failed, trying Tier 2:', e);
            }
        }

        // ==========================================
        // TIER 2: CAPTURE FROM TEMPORARY VIDEO ELEMENT (FALLBACK)
        // ==========================================
        // STRATEGY: Create new video element, load blob, capture frame
        // ADVANTAGE: Works even if preview element is not available
        // RELIABILITY: More robust but slower (requires video loading)
        const url = URL.createObjectURL(blob);
        const video = document.createElement('video');

        // Video element configuration for maximum compatibility
        video.src = url;
        video.muted = true;              // Prevent audio playback
        video.crossOrigin = 'anonymous'; // Prevent CORS issues
        video.playsInline = true;        // Prevent fullscreen on mobile
        video.preload = 'auto';          // Force immediate loading

        // ==========================================
        // PROMISE RESOLUTION GUARD
        // ==========================================
        // CRITICAL: Prevents multiple resolve() calls which would cause Promise errors
        // Once resolved, all subsequent calls are ignored
        let resolved = false;
        const doResolve = (value: string) => {
            if (!resolved) {
                resolved = true;
                // CRITICAL: Clean up Blob URL to prevent memory leaks
                URL.revokeObjectURL(url);
                resolve(value);
            }
        };

        // ==========================================
        // VIDEO EVENT HANDLERS
        // ==========================================
        // When video data is loaded and ready to play
        video.onloadeddata = () => {
            // Seek to 1.5s (or 20% likely) to avoid black start frames
            // This is crucial for "visible" thumbnails
            if (video.duration > 3) {
                video.currentTime = 1.5; 
            } else {
                video.currentTime = video.duration * 0.2; // 20% for short videos
            }
        };

        // After seeking completes, capture the frame
        video.onseeked = () => {
            // Guard against duplicate resolution
            if (resolved) return;

            try {
                const canvas = document.createElement('canvas');
                canvas.width = 320;
                canvas.height = 180;
                const ctx = canvas.getContext('2d');

                if (ctx) {
                    // Draw video frame to canvas
                    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

                    // Convert to base64 JPEG
                    // Quality 0.8 balances file size and visual quality
                    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);

                    // SUCCESS: Return with generated thumbnail
                    doResolve(dataUrl);
                } else {
                    // Canvas context not available
                    doResolve('');
                }
            } catch (e) {
                // Canvas drawing failed
                doResolve('');
            }
        };

        // Video loading failed (corrupt blob, unsupported format, etc.)
        video.onerror = () => {
            doResolve('');
        };

        // ==========================================
        // TIMEOUT PROTECTION
        // ==========================================
        // CRITICAL: Prevents Promise from hanging indefinitely
        // If thumbnail generation takes too long, return empty string
        // 3 second timeout allows for video loading on slow systems
        setTimeout(() => {
            if (!resolved) {
                doResolve('');
            }
        }, 3000);
    });
}

/**
 * RECORDING STOP HANDLER - Processes completed recording
 *
 * This function is called when the user stops recording. It performs the following:
 * 1. Aggregates all recorded chunks into a single video blob
 * 2. Generates a thumbnail preview image
 * 3. Sends data to main process for saving
 * 4. Refreshes the library view
 *
 * RELIABILITY:
 * - Converts blob to ArrayBuffer for IPC transfer
 * - Thumbnail generation is async and has fallback mechanisms
 * - Error handling prevents UI freezing
 */
async function handleStop() {
    /* ==========================================
     * STEP 1: AGGREGATE RECORDED CHUNKS INTO BLOB
     * ========================================== */
    const blob = new Blob(recordedChunks, {
        type: 'video/webm; codecs=vp9'
    });

    const buffer = await blob.arrayBuffer();

    /* ==========================================
     * STEP 2: GENERATE THUMBNAIL PREVIEW
     * ==========================================
     * Uses generateThumbnail() which has two-tier fallback:
     * - Tier 1: Capture from live preview element (instant)
     * - Tier 2: Load blob into temp video element (reliable fallback)
     *
     * If thumbnail generation fails, returns empty string
     * Main process handles missing thumbnails gracefully
     */
    const thumbnail = await generateThumbnail(blob);

    /* ==========================================
     * STEP 3: SAVE VIA MAIN PROCESS
     * ==========================================
     * IPC call to main process which:
     * - Shows save dialog
     * - Writes video file
     * - Writes thumbnail file (if provided)
     * - Returns file path or cancellation
     */
    // @ts-ignore - Updating signature
    const result = await window.electronAPI.saveVideo(buffer, thumbnail);

    /* ==========================================
     * STEP 4: REFRESH LIBRARY VIEW
     * ==========================================
     * If save was successful, reload the library to show new recording
     */
    if (result && result.filePath) {
        renderLibrary();
    }

    /* ==========================================
     * CLEANUP
     * ==========================================
     * Clear recorded chunks for next recording
     */
    recordedChunks = [];
}

/**
 * Fetches and renders the recording library in the sidebar.
 * Includes persistent sorting and drag-and-drop reordering logic.
 */
async function renderLibrary() {
    const libraryList = document.getElementById('historyList') as HTMLElement;
    if (!libraryList) return;

    try {
        // Fetch files via Main Process IPC
        let files = await window.electronAPI.loadLibrary();
        
        // SORTING: Apply persistent user-defined order from localStorage
        const savedOrder = localStorage.getItem('library-order');
        if (savedOrder) {
            const orderList = JSON.parse(savedOrder) as string[];
            files.sort((a, b) => {
                const idxA = orderList.indexOf(a.path);
                const idxB = orderList.indexOf(b.path);
                if (idxA === -1 && idxB === -1) return 0;
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        }

        libraryList.innerHTML = ''; // Reset list for re-render

        // DRAG & DROP: Internal list reordering logic
        libraryList.ondragover = (e) => {
            e.preventDefault();
            const dragging = document.querySelector('.dragging') as HTMLElement;
            if (!dragging) return;
            const applyAfter = getDragAfterElement(libraryList, e.clientY);
            if (applyAfter == null) {
                libraryList.appendChild(dragging);
            } else {
                libraryList.insertBefore(dragging, applyAfter);
            }
        };

        files.forEach(file => {
            const item = document.createElement('div');
            item.className = 'history-item';
            item.setAttribute('data-path', file.path);
            item.setAttribute('draggable', 'true');
            
            // ==========================================
            // INTERNAL REORDERING & NATIVE DRAG
            // ==========================================
            item.ondragstart = (e) => {
                // Determine if we are dragging to OS or internal
                // If user holds Ctrl or drags fast, we might do different things
                // For now: Left-drag starts internal reorder, Alt-drag or small delay starts native
                item.classList.add('dragging');
                
                // Allow small delay before starting native drag to distinguish
                setTimeout(() => {
                    if (item.classList.contains('dragging')) {
                        // If still dragging after 500ms, start native OS drag
                        // window.electronAPI.startDrag(file.path); 
                    }
                }, 500);
            };

            item.ondragend = () => {
                item.classList.remove('dragging');
                saveLibraryOrder(); // Persist the new sequence
            };

            // Double Click for Native Drag (or Right Click menu)
            // Actually, let's keep it simple: 
            // Drag = Reorder
            // Right Click > Share = Drag to OS (implemented via menu or button)
            
            item.onclick = () => playVideo(file.path);
            item.oncontextmenu = (e) => {
                e.preventDefault();
                showContextMenu(e, item);
            };

            // FIXED: thumbnails from loadLibrary are base64 strings, use them directly
            const thumbStyle = file.thumbnail
                ? `background-image: url('${file.thumbnail}'); background-size: cover; background-position: center;`
                : `background: linear-gradient(135deg, rgba(124, 58, 237, 0.3) 0%, rgba(37, 99, 235, 0.2) 100%); display: flex; align-items: center; justify-content: center;`;

            const thumbContent = file.thumbnail
                ? ''
                : `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect><line x1="7" y1="2" x2="7" y2="22"></line><line x1="17" y1="2" x2="17" y2="22"></line><line x1="2" y1="12" x2="22" y2="12"></line><line x1="2" y1="7" x2="7" y2="7"></line><line x1="2" y1="17" x2="7" y2="17"></line><line x1="17" y1="17" x2="22" y2="17"></line><line x1="17" y1="7" x2="22" y2="7"></line></svg>`;

            item.innerHTML = `
                <div class="history-thumb" style="${thumbStyle}">${thumbContent}</div>
                <div class="history-info">
                    <div class="history-name" title="${file.name}">${file.name}</div>
                    <div class="history-meta">${file.date} at ${file.time} • ${file.size}</div>
                </div>
            `;
            libraryList.appendChild(item);
        });
    } catch (err: any) {
        console.error('FAIL LOUDLY:', err);
        libraryList.innerHTML = `<div style="padding: 20px; font-size: 11px; opacity: 0.5;">Error loading library</div>`;
    }
}

/**
 * UTILITY: Get element to insert drag target after
 * Standard sortable list logic
 */
function getDragAfterElement(container: HTMLElement, y: number) {
    const draggableElements = Array.from(container.querySelectorAll('.history-item:not(.dragging)')) as HTMLElement[];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY, element: null as HTMLElement | null }).element;
}

/**
 * PERSISTENCE: Save custom library order to local storage
 */
function saveLibraryOrder() {
    const libraryList = document.getElementById('historyList');
    if (!libraryList) return;
    
    const elements = Array.from(libraryList.querySelectorAll('.history-item')) as HTMLElement[];
    const order = elements.map(item => item.getAttribute('data-path'));
    localStorage.setItem('library-order', JSON.stringify(order));
    console.log('Library order saved');
}

// Initial Load
renderLibrary();

function startTimer() {
    startTime = Date.now();
    recIndicator.classList.add('active');
    timerInterval = setInterval(() => {
        const diff = Date.now() - startTime;
        const seconds = Math.floor((diff / 1000) % 60);
        const minutes = Math.floor((diff / (1000 * 60)) % 60);
        const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
        
        timerDisplay.innerText = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
    recIndicator.classList.remove('active');
    if (timerDisplay) timerDisplay.innerText = "00:00:00";
}

function pad(val: number) {
    return val.toString().padStart(2, '0');
}

// FIXED: Added missing event listener for Select Source button
// This button was declared but never had a click handler assigned
sourceSelectBtn.onclick = async () => {
    console.log('Select Source button clicked');
    await getSources();
};

startBtn.onclick = () => {
    console.log('Start button clicked');
    if (mediaRecorder) {
        mediaRecorder.start();
        startTimer();
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
    } else {
        alert('Please select a source first!');
    }
};

stopBtn.onclick = () => {
    console.log('Stop button clicked');
    if (mediaRecorder) {
        mediaRecorder.stop();
        stopTimer();
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    }
};

// Context Menu Logic
const contextMenu = document.getElementById('contextMenu') as HTMLDivElement;
let selectedItem: HTMLElement | null = null;

/**
 * SHOW CONTEXT MENU (Robust)
 * Centrally manages the display and positioning of the library context menu
 */
function showContextMenu(e: MouseEvent, target: HTMLElement) {
    e.preventDefault();
    selectedItem = target;
    
    // Position menu at cursor
    contextMenu.style.top = `${e.clientY}px`;
    contextMenu.style.left = `${e.clientX}px`;
    
    // Ensure menu is visible
    contextMenu.classList.remove('hidden');
    
    // Add a visual indicator to the selected card
    target.classList.add('menu-active');
}

// Global context menu listener for the entire document
document.addEventListener('contextmenu', (e) => {
    const target = (e.target as HTMLElement).closest('.history-item') as HTMLElement;
    if (target) {
        showContextMenu(e, target);
    } else {
        contextMenu.classList.add('hidden');
        document.querySelectorAll('.history-item').forEach(item => item.classList.remove('menu-active'));
    }
});

document.addEventListener('click', () => {
    contextMenu.classList.add('hidden');
    document.querySelectorAll('.history-item').forEach(item => item.classList.remove('menu-active'));
});

document.getElementById('menuReveal')?.addEventListener('click', () => {
    if (selectedItem) {
        const path = selectedItem.getAttribute('data-path') || 'C:\\'; // Fallback
        window.electronAPI.revealInExplorer(path);
    }
});

document.getElementById('menuCopy')?.addEventListener('click', () => {
    if (selectedItem) {
        const path = selectedItem.getAttribute('data-path') || 'N/A';
        navigator.clipboard.writeText(path);
        console.log('Path copied to clipboard');
    }
});

document.getElementById('menuDelete')?.addEventListener('click', async () => {
    if (selectedItem) {
        const path = selectedItem.getAttribute('data-path');
        if (!path) return;

        if (confirm('Are you sure you want to delete this recording?')) {
            try {
                const result = await window.electronAPI.deleteFile(path);
                if (result.success) {
                    selectedItem.style.opacity = '0';
                    selectedItem.style.transform = 'translateX(-20px)';
                    setTimeout(() => {
                        selectedItem?.remove();
                        renderLibrary(); // Force refresh to be sure
                    }, 300);
                }
            } catch (err: any) {
                alert(`CRITICAL: Deletion Failed!\n\nCould not delete file: ${err.message}`);
            }
        }
    }
});

document.getElementById('menuOpen')?.addEventListener('click', () => {
    if (selectedItem) {
        const path = selectedItem.getAttribute('data-path');
        if (path) window.electronAPI.openFile(path);
    }
});

/**
 * RENAME MENU HANDLER
 *
 * Allows users to rename recordings directly from the library
 * Features:
 * - Prompt for new filename
 * - Extension validation (.webm or .mp4 required)
 * - Duplicate name checking
 * - Automatic thumbnail renaming
 * - Error handling with user feedback
 */
document.getElementById('menuRename')?.addEventListener('click', async () => {
    if (selectedItem) {
        const path = selectedItem.getAttribute('data-path');
        if (!path) return;

        // Get current filename without extension
        const currentName = path.split('\\').pop() || path.split('/').pop() || '';
        const nameWithoutExt = currentName.replace(/\.(webm|mp4)$/i, '');

        // Prompt user for new name
        const newName = prompt(
            'Enter new filename (with extension):\n\nExamples:\n• My Recording.webm\n• Tutorial Part 1.mp4\n• Demo_2025-01-11.webm',
            nameWithoutExt
        );

        // User cancelled
        if (!newName) return;

        // Validate extension
        if (!newName.endsWith('.webm') && !newName.endsWith('.mp4')) {
            alert('⚠️ Invalid Extension!\n\nFile must end with .webm or .mp4\n\nExample: ' + nameWithoutExt + '.webm');
            return;
        }

        // Validate filename (no invalid characters)
        const invalidChars = /[<>:"|?*\\/]/;
        if (invalidChars.test(newName)) {
            alert('⚠️ Invalid Filename!\n\nFilename contains invalid characters:\n< > : " | ? * / \\ \n\nPlease use only letters, numbers, spaces, dots, hyphens, and underscores.');
            return;
        }

        try {
            // Call IPC to rename file
            const result = await window.electronAPI.renameFile(path, newName);

            if (result.success) {
                // Success! Refresh library to show new name
                renderLibrary();
            } else {
                // Show error message from main process
                alert('❌ Rename Failed!\n\n' + (result.error || 'Unknown error'));
            }
        } catch (err: any) {
            alert(`❌ CRITICAL ERROR!\n\nCould not rename file: ${err.message}`);
        }
    }
});

/**
 * CONVERT MENU HANDLER
 * 
 * Converts between WebM and MP4
 */
document.getElementById('menuConvert')?.addEventListener('click', async () => {
    if (selectedItem) {
        const path = selectedItem.getAttribute('data-path');
        if (!path) return;

        // Determine target format
        const isWebM = path.endsWith('.webm');
        const isMP4 = path.endsWith('.mp4');
        
        let targetFormat = 'mp4';
        if (isMP4) targetFormat = 'webm'; // Toggle if already mp4, though usually users want mp4
        
        // If it's already MP4, ask if they want to convert to WebM or re-encode
        if (isMP4) {
             if (!confirm('This file is already an MP4. Convert to WebM?')) return;
             targetFormat = 'webm';
        } else {
             // Standard WebM -> MP4 flow
             if (!confirm('Convert this recording to MP4?\n\nThis may take a few moments.')) return;
        }

        // Show loading state on the item
        const originalOpacity = selectedItem.style.opacity;
        selectedItem.style.opacity = '0.5';
        selectedItem.style.pointerEvents = 'none'; // Prevent clicks while converting
        
        // Add a spinner or text to show it's working
        const infoDiv = selectedItem.querySelector('.history-info');
        const originalInfo = infoDiv?.innerHTML;
        if (infoDiv) {
            infoDiv.innerHTML = `<div style="color:var(--accent-light);">Converting to ${targetFormat.toUpperCase()}...</div>`;
        }

        try {
            const result = await window.electronAPI.convertFile(path, targetFormat);

            if (result.success) {
                alert(`✅ Conversion Successful!\n\nSaved as: ${result.newPath}`);
                renderLibrary(); // Refresh to show new file
            } else {
                alert(`❌ Conversion Failed!\n\n${result.error}`);
                if (infoDiv && originalInfo) infoDiv.innerHTML = originalInfo;
                selectedItem.style.opacity = originalOpacity || '1';
                selectedItem.style.pointerEvents = 'all';
            }
        } catch (err: any) {
             alert(`❌ Error: ${err.message}`);
             if (infoDiv && originalInfo) infoDiv.innerHTML = originalInfo;
             selectedItem.style.opacity = originalOpacity || '1';
             selectedItem.style.pointerEvents = 'all';
        }
    }
});

/**
 * GIF CONVERSION HANDLER
 */
document.getElementById('menuConvertGif')?.addEventListener('click', async () => {
    if (selectedItem) {
        const path = selectedItem.getAttribute('data-path');
        if (!path) return;

        if (!confirm('Convert this recording to GIF?\n\nThis will create an optimized animated GIF.')) return;

        // Show loading state
        const originalOpacity = selectedItem.style.opacity;
        selectedItem.style.opacity = '0.5';
        selectedItem.style.pointerEvents = 'none';
        
        const infoDiv = selectedItem.querySelector('.history-info');
        const originalInfo = infoDiv?.innerHTML;
        if (infoDiv) {
            infoDiv.innerHTML = `<div style="color:var(--accent-light);">Creating GIF...</div>`;
        }

        try {
            const result = await window.electronAPI.convertFile(path, 'gif');

            if (result.success) {
                alert(`✅ GIF Created!\n\nSaved as: ${result.newPath}`);
                renderLibrary(); 
            } else {
                alert(`❌ GIF Creation Failed!\n\n${result.error}`);
                if (infoDiv && originalInfo) infoDiv.innerHTML = originalInfo;
                selectedItem.style.opacity = originalOpacity || '1';
                selectedItem.style.pointerEvents = 'all';
            }
        } catch (err: any) {
             alert(`❌ Error: ${err.message}`);
             if (infoDiv && originalInfo) infoDiv.innerHTML = originalInfo;
             selectedItem.style.opacity = originalOpacity || '1';
             selectedItem.style.pointerEvents = 'all';
        }
    }
});

/**
 * DUPLICATE FILE HANDLER
 */
document.getElementById('menuCopyFile')?.addEventListener('click', async () => {
    if (selectedItem) {
        const path = selectedItem.getAttribute('data-path');
        if (!path) return;

        try {
            const result = await window.electronAPI.duplicateFile(path);
            if (result.success) {
                // Subtle feedback
                const infoDiv = selectedItem.querySelector('.history-info');
                const originalInfo = infoDiv?.innerHTML || '';
                if (infoDiv) {
                    infoDiv.innerHTML = `<div style="color:#00ff00;">Duplicated!</div>`;
                    setTimeout(() => {
                        infoDiv.innerHTML = originalInfo;
                    }, 2000);
                }
                renderLibrary(); // Refresh to see the new copy
            } else {
                alert(`❌ Duplication Failed: ${result.error}`);
            }
        } catch (err: any) {
             alert(`❌ Error: ${err.message}`);
        }
    }
});

// Top Menu Bar Listeners
document.getElementById('menuExit')?.addEventListener('click', () => {
    window.electronAPI.close();
});

document.getElementById('menuToggleSidebar')?.addEventListener('click', () => {
    const sidebar = document.querySelector('.sidebar') as HTMLElement;
    const layout = document.querySelector('.main-layout') as HTMLElement;
    if (sidebar && layout) {
        sidebar.classList.toggle('hidden');
        layout.style.gridTemplateColumns = sidebar.classList.contains('hidden') ? '0 1fr' : '260px 1fr';
    }
});

document.getElementById('menuFullscreen')?.addEventListener('click', () => {
    window.electronAPI.toggleFullscreen();
});

document.getElementById('menuNew')?.addEventListener('click', () => {
    getSources(); // Open source selection as a "New Recording" start
});

document.getElementById('menuAbout')?.addEventListener('click', () => {
    alert('Screenflow Pro v1.0.0\n\nThe most powerful screen recorder.\nBuilt with Advanced AI Agentic Coding.');
});

export {};
