require("dotenv").config();
const { app, BrowserWindow, ipcMain } = require("electron");
const WebSocket = require("ws");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const path = require("path");
const { OpenRouter } = require("@openrouter/sdk");

// The client gets the API key from the environment variable `GEMINI_API_KEY`.
const ai = new OpenRouter({ apiKey: process.env.OPEN_ROUTER_API_KEY });

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
    const audioStream = await elevenLabs.textToSpeech.convert(VOICE_ID, {
      text,
      modelId: "eleven_turbo_v2_5", // Much faster for real-time
    });

    // Collect stream chunks into a single Buffer
    const chunks = [];
    if (audioStream[Symbol.asyncIterator]) {
      for await (const chunk of audioStream) {
        chunks.push(chunk);
      }
    } else if (audioStream.getReader) {
      // Handle Web ReadableStream
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

    // Send raw MP3 bytes to renderer
    win.webContents.send("tts-audio", audioBuffer);
    win.webContents.openDevTools();
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
      const prompt = `
You are a desktop assistant.
- Be short
- Help with tasks
- Speak like a human
- Your name is dex
User: ${text}
`;
      try {
        // Use standard completions.create for best streaming support
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

          // Stream the text chunk to the UI immediately
          ws.send(chunkText);

          // If we find a sentence ending, kick off TTS for that sentence
          if (
            /[.!?\n]/.test(sentenceBuffer) &&
            sentenceBuffer.trim().length > 15
          ) {
            if (mainWindow) {
              speakWithElevenLabs(mainWindow, sentenceBuffer.trim());
            }
            sentenceBuffer = ""; // Reset buffer for next sentence
          }
        }

        // Speak any remaining text in the buffer
        if (sentenceBuffer.trim().length > 0 && mainWindow) {
          speakWithElevenLabs(mainWindow, sentenceBuffer.trim());
        }
      } catch (err) {
        console.error("Streaming error:", err);
      }
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
  mainWindow.show();
}

ipcMain.on("app-close", () => {
  app.quit();
});

const axios = require("axios");
const FormData = require("form-data");

ipcMain.on("audio-data", async (event, data) => {
  try {
    // Ensure data is a proper Node.js Buffer
    const buffer = Buffer.from(data);

    const formData = new FormData();
    formData.append("file", buffer, {
      filename: "audio.webm",
      contentType: "audio/webm",
    });
    formData.append("model_id", "scribe_v1"); // scribe_v1 is the correct ID

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

    // Send transcription back to renderer
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
