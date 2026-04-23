require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const WebSocket = require("ws");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const path = require("path");
const { OpenRouter } = require("@openrouter/sdk");

const ai = new OpenRouter({ apiKey: process.env.OPEN_ROUTER_API_KEY });

const elevenLabs = new ElevenLabsClient({
  apiKey: process.env.ELEVEN_LABS_KEY,
});

const VOICE_ID = process.env.ELEVEN_LABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb";

async function speakWithElevenLabs(win, text) {
  try {
    const audioStream = await elevenLabs.textToSpeech.convert(VOICE_ID, {
      text,
      modelId: "eleven_turbo_v2_5",
    });

    const chunks = [];
    if (audioStream[Symbol.asyncIterator]) {
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
    } else if (audioStream.getReader) {
      const reader = audioStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
    } else {
      throw new Error("unsupported stream type");
    }
    const audioBuffer = Buffer.concat(chunks);

    win.webContents.send("tts-audio", audioBuffer);
    win.webContents.openDevTools();
  } catch (err) {
    console.error("[ElevenLabs] TTS error:", err.message);
  }
}

let mainWindow = null;

function startWebSocketServer() {
  const wss = new WebSocket.Server({ port: 3000 });

  wss.on("connection", (ws) => {
    console.log("New connection established");

    ws.on("message", async (message) => {
      const msgStr = message.toString();
      
      // Try to parse as JSON for wake word events
      try {
        const data = JSON.parse(msgStr);
        if (data.event === "wake_word") {
          console.log("🔥 Wake word received from Python");
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("wake-word");
          }
          return;
        }
      } catch (e) {
        // Not JSON, continue to treat as plain text if it's from the renderer
      }

      console.log("Processing message as chat prompt:", msgStr);
      const prompt = `
You are a desktop assistant.
- Be short
- Help with tasks
- Speak like a human
- Your name is dex
User: ${msgStr}
`;
      try {
        const stream = await ai.chat.send({
          chatRequest: {
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            stream: true,
          },
        });

        let sentenceBuffer = "";

        for await (const chunk of stream) {
          const chunkText = chunk.choices[0]?.delta?.content || "";
          if (!chunkText) continue;

          sentenceBuffer += chunkText;

          ws.send(chunkText);

          if (
            /[.!?\n]/.test(sentenceBuffer) &&
            sentenceBuffer.trim().length > 15
          ) {
            if (mainWindow) {
              speakWithElevenLabs(mainWindow, sentenceBuffer.trim());
            }
            sentenceBuffer = "";
          }
        }

        if (sentenceBuffer.trim().length > 0 && mainWindow) {
          speakWithElevenLabs(mainWindow, sentenceBuffer.trim());
        }
      } catch (err) {
        console.error("Streaming error:", err);
      }
    });

    ws.on("close", () => console.log("Connection closed"));
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
  mainWindow.show();
}

ipcMain.on("app-close", () => {
  app.quit();
});

const axios = require("axios");
const FormData = require("form-data");

ipcMain.on("audio-data", async (event, data) => {
  try {
    const buffer = Buffer.from(data);

    const formData = new FormData();
    formData.append("file", buffer, {
      filename: "audio.webm",
      contentType: "audio/webm",
    });
    formData.append("model_id", "scribe_v1");

    const response = await axios.post(
      "https://api.elevenlabs.io/v1/speech-to-text",
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          "xi-api-key": process.env.ELEVEN_LABS_KEY,
        },
      },
    );

    console.log("Transcription:", response.data);

    const text = response.data.text || response.data.transcription;
    if (text && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("transcription-result", text);
    }
  } catch (err) {
    if (err.response && err.response.data) {
      console.error(
        "STT Error Detail:",
        JSON.stringify(err.response.data, null, 2),
      );
    } else {
      console.error("STT Error:", err.message);
    }
  }
});

app.whenReady().then(() => {
  try {
    app.setLoginItemSettings({
      openAtLogin: true,
    });
  } catch (e) {
    console.warn("Failed to set login item settings:", e.message);
  }
  createWindow();
  startWebSocketServer();
});

