require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const WebSocket = require("ws");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const path = require("path");

// ── ElevenLabs client ─────────────────────────────────────────
const elevenLabs = new ElevenLabsClient({
  apiKey: process.env.ELEVEN_LABS_KEY,
});

const VOICE_ID = process.env.ELEVEN_LABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // Rachel (default)

/**
 * Convert text to speech via ElevenLabs and send the raw audio
 * buffer to the renderer process via IPC so it can be played back.
 */
async function speakWithElevenLabs(win, text) {
  try {
    const { data: audioStream, rawResponse } = await elevenLabs.textToSpeech
      .convert(VOICE_ID, {
        text,
        modelId: "eleven_v3",
      })
      .withRawResponse();

    const charCost = rawResponse.headers.get("x-character-count");
    const requestId = rawResponse.headers.get("request-id");
    console.log(
      `[ElevenLabs] request-id: ${requestId} | chars used: ${charCost}`,
    );

    // Collect stream chunks into a single Buffer
    const chunks = [];
    for await (const chunk of audioStream) {
      chunks.push(chunk);
    }
    const audioBuffer = Buffer.concat(chunks);

    // Send raw MP3 bytes to renderer
    win.webContents.send("tts-audio", audioBuffer);
  } catch (err) {
    console.error("[ElevenLabs] TTS error:", err.message);
  }
}

// ── WebSocket server ──────────────────────────────────────────
let mainWindow = null;

function startWebSocketServer() {
  const wss = new WebSocket.Server({ port: 3000 });

  wss.on("connection", (ws) => {
    console.log("Client connected");

    ws.on("message", async (message) => {
      const text = message.toString();
      // 🔥 Simulated AI response (replace with real AI later)
      const reply = text;

      // Kick off TTS concurrently with text streaming
      const ttsPromise = mainWindow
        ? speakWithElevenLabs(mainWindow, reply)
        : Promise.resolve();

      // Stream reply character-by-character to the renderer
      for (let char of reply) {
        ws.send(char);
        await new Promise((r) => setTimeout(r, 20));
      }

      await ttsPromise;
    });

    ws.on("close", () => console.log("Client disconnected"));
  });

  console.log("WebSocket server running on ws://localhost:3000");
}

// ── Electron window ───────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 540,
    icon: path.join(__dirname, "/assets/dex.ico"),
    frame: false,
    show: false,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("index.html");
  mainWindow.on("closed", () => (mainWindow = null));
  // mainWindow.show();
}

ipcMain.on("app-close", () => {
  app.quit();
});

app.whenReady().then(() => {
  app.setLoginItemSettings({
    openAtLogin: true,
  });
  startWebSocketServer();
  createWindow();
});
