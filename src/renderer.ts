interface ElectronAPI {
    getSources: () => Promise<Array<{ id: string; name: string; thumbnail: string }>>;
    saveVideo: (buffer: ArrayBuffer) => Promise<any>;
    minimize: () => void;
    close: () => void;
}

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}

const videoElement = document.getElementById('preview') as HTMLVideoElement;
const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
const sourceSelectBtn = document.getElementById('sourceSelectBtn') as HTMLButtonElement;
const sourceSelectLabel = document.getElementById('sourceSelectLabel') as HTMLSpanElement;
const micToggle = document.getElementById('micToggle') as HTMLInputElement;
const audioToggle = document.getElementById('audioToggle') as HTMLInputElement;
const recordingStatus = document.getElementById('recordingStatus') as HTMLDivElement;
const timerDisplay = document.getElementById('timerDisplay') as HTMLSpanElement;
const sourceList = document.getElementById('sourceList') as HTMLDivElement;

let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let timerInterval: any = null;
let startTime: number = 0;

// Setup Window Controls
document.getElementById('minimizeBtn')?.addEventListener('click', () => {
    window.electronAPI.minimize();
});

document.getElementById('closeBtn')?.addEventListener('click', () => {
    window.electronAPI.close();
});

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
            <img src="${source.thumbnail}" />
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
    sourceSelectLabel.innerText = `(${name})`;
    
    const constraints: any = {
        audio: false, 
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: sourceId
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
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        
        if (micToggle.checked) {
            const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            const mixedStream = new MediaStream([
                ...stream.getVideoTracks(),
                ...mixAudioTracks(stream, micStream)
            ]);
            
            videoElement.srcObject = mixedStream;
            videoElement.muted = true;
            setupRecorder(mixedStream);
        } else {
            videoElement.srcObject = stream;
            videoElement.muted = true;
            setupRecorder(stream);
        }
        
        videoElement.play();
    } catch (e) {
        console.error(e);
        alert('Error accessing source: ' + e);
    }
}

function mixAudioTracks(desktopStream: MediaStream, micStream: MediaStream): MediaStreamTrack[] {
    const ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();

    if (desktopStream.getAudioTracks().length > 0) {
        const desktopSource = ctx.createMediaStreamSource(desktopStream);
        desktopSource.connect(dest);
    }

    if (micStream.getAudioTracks().length > 0) {
        const micSource = ctx.createMediaStreamSource(micStream);
        micSource.connect(dest);
    }

    return dest.stream.getAudioTracks();
}

function setupRecorder(stream: MediaStream) {
    const options = { mimeType: 'video/webm; codecs=vp9' };
    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onstop = handleStop;
}

function handleDataAvailable(e: BlobEvent) {
    if (e.data.size > 0) {
        recordedChunks.push(e.data);
    }
}

async function handleStop() {
    const blob = new Blob(recordedChunks, {
        type: 'video/webm; codecs=vp9'
    });

    const buffer = await blob.arrayBuffer();
    const result = await window.electronAPI.saveVideo(buffer);
    
    if (result && result.filePath) {
        // Here we could add to history list dynamically if implemented
        console.log(`Saved to ${result.filePath}`);
    }
    
    recordedChunks = [];
}

function startTimer() {
    startTime = Date.now();
    recordingStatus.classList.remove('hidden');
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
    recordingStatus.classList.add('hidden');
    timerDisplay.innerText = "00:00:00";
}

function pad(val: number) {
    return val.toString().padStart(2, '0');
}

startBtn.onclick = () => {
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
    if (mediaRecorder) {
        mediaRecorder.stop();
        stopTimer();
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
    }
};

sourceSelectBtn.onclick = () => {
    getSources();
};
