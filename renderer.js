const { ipcRenderer } = require("electron");

// ── Close button ──────────────────────────────────────────────
document.getElementById("closeBtn").addEventListener("click", () => {
  ipcRenderer.send("app-close");
});

// ── WebSocket client ──────────────────────────────────────────
const socket = new WebSocket("ws://localhost:3000");

const chatLog = document.getElementById("chatLog");
const msgInput = document.getElementById("msgInput");
const sendBtn = document.getElementById("sendBtn");

let botBubble = null; // the current streaming bot bubble

// Append a message bubble to the chat log
function appendBubble(type, text = "") {
  const div = document.createElement("div");
  div.classList.add("msg", type);
  div.textContent = text;
  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;
  return div;
}

// Stream each incoming character into the active bot bubble
socket.onmessage = (event) => {
  if (!botBubble) {
    botBubble = appendBubble("bot");
  }
  botBubble.textContent += event.data;
  chatLog.scrollTop = chatLog.scrollHeight;
};

socket.onopen = () => console.log("Connected to WebSocket server");
socket.onerror = (err) => console.error("WebSocket error:", err);

// Send a message
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text || socket.readyState !== WebSocket.OPEN) return;

  appendBubble("user", text); // user bubble
  botBubble = null; // reset so next onmessage creates a fresh bot bubble

  socket.send(text);
  msgInput.value = "";
}

sendBtn.addEventListener("click", sendMessage);
msgInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage();
});

// ── ElevenLabs TTS playback ───────────────────────────────────
const audioCtx = new AudioContext();

ipcRenderer.on("tts-audio", async (_event, buffer) => {
  try {
    // buffer arrives as a Node Buffer (Uint8Array-like); decode as MP3
    const audioBuffer = await audioCtx.decodeAudioData(
      // Convert Node Buffer → ArrayBuffer
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    );

    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(audioCtx.destination);
    source.start(0);
  } catch (err) {
    console.error("TTS playback error:", err);
  }
});
