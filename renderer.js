const { ipcRenderer } = require("electron");

// ── Close button ──────────────────────────────────────────────
document.getElementById("closeBtn").addEventListener("click", () => {
  ipcRenderer.send("app-close");
});

// ── Elements ──────────────────────────────────────────────────
const micBtn = document.getElementById("micBtn");
const statusText = document.getElementById("statusText");
const botElement = document.querySelector(".bot");

// ── WebSocket client ──────────────────────────────────────────
const socket = new WebSocket("ws://localhost:3000");

socket.onopen = () => {
  console.log("Connected to WebSocket server");
  statusText.textContent = "Ready to help";
};
socket.onerror = (err) => {
  console.error("WebSocket error:", err);
  statusText.textContent = "Connection error";
};

// Send a message via WebSocket
function sendMessage(text) {
  if (!text || socket.readyState !== WebSocket.OPEN) return;
  socket.send(text);
  statusText.textContent = "Thinking...";
}

// ── Microphone logic ──────────────────────────────────────────
micBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎤";
    statusText.textContent = "Processing...";
  } else {
    startRecording();
    micBtn.classList.add("recording");
    micBtn.textContent = "🔴";
    statusText.textContent = "Listening...";
  }
});

// ── ElevenLabs TTS playback ───────────────────────────────────
const audioCtx = new AudioContext();
let audioQueue = [];
let isPlaying = false;

async function playNextInQueue() {
  if (audioQueue.length === 0) {
    if (!isPlaying) {
      botElement.classList.remove("speaking");
      statusText.textContent = "Ready to help";
    }
    return;
  }
  
  if (isPlaying) return;

  isPlaying = true;
  botElement.classList.add("speaking");
  statusText.textContent = "Speaking...";
  
  const buffer = audioQueue.shift();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(buffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.onended = () => {
      isPlaying = false;
      playNextInQueue();
    };
    source.start(0);
  } catch (err) {
    console.error("TTS playback error:", err);
    isPlaying = false;
    playNextInQueue();
  }
}

ipcRenderer.on("tts-audio", async (_event, buffer) => {
  // Convert Node Buffer → ArrayBuffer
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
  
  audioQueue.push(arrayBuffer);
  playNextInQueue();
});

let mediaRecorder;
let audioChunks = [];

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      audioChunks = []; // Reset chunks for next recording
      sendToMain(audioBlob);
    };

    mediaRecorder.start();
  } catch (err) {
    console.error("Recording error:", err);
    statusText.textContent = "Mic error";
  }
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
}

function sendToMain(blob) {
  blob.arrayBuffer().then((arrayBuffer) => {
    // Send as Uint8Array (compatible with IPC and Buffer.from)
    ipcRenderer.send("audio-data", new Uint8Array(arrayBuffer));
  });
}

// Listen for transcription result from main
ipcRenderer.on("transcription-result", (_event, text) => {
  if (text) {
    console.log("Transcribed:", text);
    sendMessage(text); // Auto-send the transcribed text
  } else {
    statusText.textContent = "Didn't catch that";
    setTimeout(() => {
        if (!isPlaying) statusText.textContent = "Ready to help";
    }, 2000);
  }
});
