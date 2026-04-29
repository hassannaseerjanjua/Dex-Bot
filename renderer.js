const { ipcRenderer } = require("electron");

// ── Close button ──────────────────────────────────────────────
document.getElementById("closeBtn").addEventListener("click", () => {
  ipcRenderer.send("app-close");
});

// ── Elements ──────────────────────────────────────────────────
const micBtn = document.getElementById("micBtn");
const statusText = document.getElementById("statusText");

// ── App State ─────────────────────────────────────────────────
let appState = 'idle'; // 'idle', 'listening', 'speaking', 'processing'
let currentMicVolume = 0;
let currentBotVolume = 0;

// ── WebSocket client ──────────────────────────────────────────
const socket = new WebSocket("ws://localhost:3000");

socket.onopen = () => {
  console.log("Connected to WebSocket server");
  statusText.textContent = "Ready to help";
  appState = 'idle';
};
socket.onerror = (err) => {
  console.error("WebSocket error:", err);
  statusText.textContent = "Connection error";
  appState = 'idle';
};

// Send a message via WebSocket
function sendMessage(text) {
  if (!text || socket.readyState !== WebSocket.OPEN) return;
  socket.send(text);
  statusText.textContent = "Thinking...";
  appState = 'processing';
}

// ── Microphone logic ──────────────────────────────────────────
micBtn.addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state === "recording") {
    stopRecording();
    micBtn.classList.remove("recording");
    micBtn.textContent = "🎤";
    statusText.textContent = "Processing...";
    appState = 'processing';
  } else {
    startRecording();
    micBtn.classList.add("recording");
    micBtn.textContent = "🔴";
    statusText.textContent = "Listening...";
    appState = 'listening';
  }
});

// ── ElevenLabs TTS playback ───────────────────────────────────
const audioCtx = new AudioContext();
let audioQueue = [];
let isPlaying = false;

// Bot Analyser for speaking visual
const botAnalyser = audioCtx.createAnalyser();
botAnalyser.fftSize = 256;
const botDataArray = new Uint8Array(botAnalyser.frequencyBinCount);

function updateBotVolume() {
  if (!isPlaying) {
    currentBotVolume = 0;
    return;
  }
  botAnalyser.getByteTimeDomainData(botDataArray);
  let sumSquares = 0;
  for (let i = 0; i < botDataArray.length; i++) {
    const amplitude = (botDataArray[i] - 128) / 128;
    sumSquares += amplitude * amplitude;
  }
  currentBotVolume = Math.sqrt(sumSquares / botDataArray.length) * 100;
  requestAnimationFrame(updateBotVolume);
}

async function playNextInQueue() {
  if (audioQueue.length === 0) {
    if (!isPlaying) {
      statusText.textContent = "Ready to help";
      appState = 'idle';
    }
    return;
  }

  if (isPlaying) return;

  isPlaying = true;
  appState = 'speaking';
  statusText.textContent = "Speaking...";

  const buffer = audioQueue.shift();

  try {
    const audioBuffer = await audioCtx.decodeAudioData(buffer);
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(botAnalyser);
    botAnalyser.connect(audioCtx.destination);
    source.onended = () => {
      isPlaying = false;
      playNextInQueue();
    };
    source.start(0);
    updateBotVolume();
  } catch (err) {
    console.error("TTS playback error:", err);
    isPlaying = false;
    playNextInQueue();
  }
}

ipcRenderer.on("tts-audio", async (_event, buffer) => {
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

    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    let lastSoundTime = Date.now();
    const SILENCE_THRESHOLD = 5;
    const SILENCE_DURATION = 1500;

    function checkSilence() {
      if (!mediaRecorder || mediaRecorder.state !== "recording") return;

      analyser.getByteTimeDomainData(dataArray);
      let sumSquares = 0;
      for (let i = 0; i < bufferLength; i++) {
        const amplitude = (dataArray[i] - 128) / 128;
        sumSquares += amplitude * amplitude;
      }
      currentMicVolume = Math.sqrt(sumSquares / bufferLength) * 100;

      if (!window._lastLogTime || Date.now() - window._lastLogTime > 500) {
        console.log("Current Volume:", currentMicVolume.toFixed(2));
        window._lastLogTime = Date.now();
      }

      if (currentMicVolume > SILENCE_THRESHOLD) {
        lastSoundTime = Date.now();
      }

      if (Date.now() - lastSoundTime > SILENCE_DURATION) {
        console.log("Silence detected, auto-stopping...");
        if (mediaRecorder.state === "recording") micBtn.click();
        return;
      }

      requestAnimationFrame(checkSilence);
    }

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      source.disconnect();
      analyser.disconnect();
      currentMicVolume = 0;
      const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
      audioChunks = [];
      sendToMain(audioBlob);
    };

    mediaRecorder.start();
    checkSilence();
  } catch (err) {
    console.error("Recording error:", err);
    statusText.textContent = "Mic error";
    appState = 'idle';
  }
}

function stopRecording() {
  if (mediaRecorder) mediaRecorder.stop();
}

function sendToMain(blob) {
  blob.arrayBuffer().then((arrayBuffer) => {
    ipcRenderer.send("audio-data", new Uint8Array(arrayBuffer));
  });
}

// Listen for transcription result from main
ipcRenderer.on("transcription-result", (_event, text) => {
  if (text) {
    console.log("Transcribed:", text);
    sendMessage(text);
  } else {
    statusText.textContent = "Didn't catch that";
    appState = 'idle';
    setTimeout(() => {
      if (!isPlaying) statusText.textContent = "Ready to help";
    }, 2000);
  }
});

// Listen for wake word from main
ipcRenderer.on("wake-word", () => {
  console.log("Wake word detected! Checking if we should trigger microphone...");
  if ((!mediaRecorder || mediaRecorder.state !== "recording") && !isPlaying) {
    micBtn.click();
  } else {
    console.log("Wake word ignored: recording in progress or bot is speaking.");
  }
});

// ── Orb UI Animation (Canvas) ─────────────────────────────────
const canvas = document.getElementById('orbCanvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
const canvasWidth = 260;
const canvasHeight = 260;
canvas.width = canvasWidth * dpr;
canvas.height = canvasHeight * dpr;
ctx.scale(dpr, dpr);

const dots = [];
const numRings = 12;
const innerRadius = 35;
const ringSpacing = 7;

for (let r = 0; r < numRings; r++) {
  const radius = innerRadius + r * ringSpacing;
  const circumference = 2 * Math.PI * radius;
  const dotSpacing = 7;
  const numDots = Math.max(1, Math.floor(circumference / dotSpacing));
  const angleOffset = (r % 2) * (Math.PI / numDots); // staggered rings

  for (let i = 0; i < numDots; i++) {
    const angle = (i / numDots) * Math.PI * 2 + angleOffset;
    
    // Smooth alpha curve for torus shape
    const normalizedR = r / (numRings - 1); 
    const alphaCurve = Math.sin(normalizedR * Math.PI); 
    
    dots.push({
      ring: r,
      angle: angle,
      baseRadius: radius,
      baseAlpha: alphaCurve * 0.7 + 0.1, // [0.1, 0.8]
      baseSize: (alphaCurve * 1.5) + 0.8  // [0.8, 2.3]
    });
  }
}

let ripples = [];
let time = 0;
let lastTime = performance.now();
let lastMicSpike = 0;

function drawOrb(currentTime) {
  const dt = (currentTime - lastTime) / 1000;
  lastTime = currentTime;
  time += dt;

  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  // Update ripples
  ripples.forEach(r => {
    r.radius += r.speed * dt;
    r.strength -= dt * 1.5;
  });
  ripples = ripples.filter(r => r.strength > 0);

  // State-specific behavior
  let globalScale = 1;
  let globalAlphaMod = 1;
  const targetColor = "216, 180, 254"; // Light purple #d8b4fe

  if (appState === 'idle') {
    // Slow opacity breathing
    globalAlphaMod = 0.7 + 0.3 * Math.sin(time * 2);
  } 
  else if (appState === 'processing') {
    // Subtle faster pulse
    globalAlphaMod = 0.8 + 0.2 * Math.sin(time * 4);
    globalScale = 1.05;
  }
  else if (appState === 'listening') {
    // Reacts live to mic volume
    const vol = Math.min(currentMicVolume / 50, 1);
    globalScale = 1 + vol * 0.15;
    globalAlphaMod = 0.8 + 0.2 * vol;
    
    // Spawn ripples on mic spikes
    if (currentMicVolume - lastMicSpike > 15) {
      ripples.push({ radius: innerRadius, speed: 100, strength: currentMicVolume / 30 });
    }
    lastMicSpike = currentMicVolume;
  } 
  else if (appState === 'speaking') {
    // Faster pulses and reacts to bot volume
    globalAlphaMod = 0.8 + 0.2 * Math.sin(time * 6);
    const vol = Math.min(currentBotVolume / 50, 1);
    globalScale = 1 + vol * 0.1;
    
    // Spawn ripples automatically + based on volume
    if (Math.random() > 0.9 && currentBotVolume > 10) {
      ripples.push({ radius: innerRadius, speed: 120, strength: currentBotVolume / 40 });
    }
  }

  const cx = canvasWidth / 2;
  const cy = canvasHeight / 2;

  dots.forEach(dot => {
    let r = dot.baseRadius;
    let size = dot.baseSize;
    let alpha = dot.baseAlpha * globalAlphaMod;

    // Apply ripples
    ripples.forEach(rip => {
      const dist = Math.abs(r - rip.radius);
      if (dist < 15) {
        const effect = (1 - dist / 15) * rip.strength;
        r += effect * 4; // subtle outward push
        size += effect * 1;
        alpha += effect * 0.5;
      }
    });

    // Mic volume radial distortion
    if (appState === 'listening') {
      const vol = Math.min(currentMicVolume / 50, 1);
      const distortion = Math.sin(dot.angle * 6 + time * 4) * vol * 4;
      r += distortion;
    }

    r *= globalScale;

    const x = cx + Math.cos(dot.angle) * r;
    const y = cy + Math.sin(dot.angle) * r;

    ctx.fillStyle = `rgba(${targetColor}, ${Math.min(alpha, 1)})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  });

  requestAnimationFrame(drawOrb);
}
requestAnimationFrame(drawOrb);
