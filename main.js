const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const { app, BrowserWindow, ipcMain } = require("electron");
const WebSocket = require("ws");
const { ElevenLabsClient } = require("@elevenlabs/elevenlabs-js");
const { OpenRouter } = require("@openrouter/sdk");
const { exec, spawn } = require("child_process");

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
You are Dex, a desktop AI assistant.

You MUST respond in ONE of these formats:

1. To open Chrome:
ACTION: openChrome | URL

2. To open terminal:
ACTION: openTerminal

3. To open VS Code:
ACTION: openVscode

4. To open Spotify:
ACTION: openSpotify

5. To open Dukan:
ACTION: openDukaan

6. Otherwise:
CHAT: your normal response

DO NOT explain actions.
DO NOT write anything else.

User: "${msgStr}"
`;
      try {
        const stream = await ai.chat.send({
          chatRequest: {
            model: "openai/gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            stream: true,
          },
        });

        function openChrome(url) {
          console.log("Opening chrome with url: " + url);
          exec("start chrome " + url);
        }

        function openTerminal() {
          console.log("Opening terminal");
          exec("start cmd");
        }

        function openVscode() {
          console.log("Opening vscode");
          exec("start code");
        }

        function openSpotify() {
          console.log("Opening spotify");
          exec("start spotify");
        }

        function openDukaan() {
          console.log("Opening Dukaan");
          exec("start cmd");
          exec("start chrome " + "localhost:5173");
        }

        let sentenceBuffer = "";
        let fullResponse = "";

        for await (const chunk of stream) {
          const chunkText = chunk.choices[0]?.delta?.content || "";
          if (!chunkText) continue;

          fullResponse += chunkText;
          sentenceBuffer += chunkText;
          ws.send(chunkText);

          // For CHAT responses, stream the TTS
          if (
            !fullResponse.trim().startsWith("ACTION:") &&
            /[.!?\n]/.test(sentenceBuffer) &&
            sentenceBuffer.trim().length > 15
          ) {
            const speechText = sentenceBuffer.trim().replace(/^CHAT:\s*/i, "");
            if (speechText && mainWindow) {
              speakWithElevenLabs(mainWindow, speechText);
            }
            sentenceBuffer = "";
          }
        }

        const finalResponse = fullResponse.trim();
        console.log("Full AI Response:", finalResponse);

        // Process Actions after the stream is complete
        if (finalResponse.startsWith("ACTION: openChrome")) {
          const parts = finalResponse.split("|");
          const url = parts.length > 1 ? parts[1].trim() : "";
          openChrome(url);
        } else if (finalResponse.includes("ACTION: openTerminal")) {
          openTerminal();
        } else if (finalResponse.includes("ACTION: openVscode")) {
          openVscode();
        } else if (finalResponse.includes("ACTION: openSpotify")) {
          openSpotify();
        } else if (finalResponse.includes("ACTION: openDukaan")) {
          openDukaan();
        } else {
          // Final speech for CHAT or if no prefix was used
          const finalSpeech = sentenceBuffer.trim().replace(/^CHAT:\s*/i, "");
          if (finalSpeech && mainWindow) {
            speakWithElevenLabs(mainWindow, finalSpeech);
          }
        }
      } catch (err) {
        console.error("Streaming error:", err);
      }
    });

    ws.on("close", () => console.log("Connection closed"));
  });

  console.log("WebSocket server running on ws://localhost:3000");
}


let pythonProcess = null;

function startWakeWordProcess() {
  console.log("Starting wake word process...");
  pythonProcess = spawn("python", ["wake_word.py"], {
    cwd: __dirname,
    stdio: "inherit",
  });

  pythonProcess.on("error", (err) => {
    console.error("Failed to start wake word process:", err);
  });

  pythonProcess.on("close", (code) => {
    console.log(`Wake word process exited with code ${code}`);
  });
}

// ── Electron window ───────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 320,
    height: 540,
    icon: path.join(__dirname, "assets", "dex.ico"),
    frame: false,
    show: false,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
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
    const exePath = process.execPath;
    const appPath = path.resolve(app.getAppPath());
    // Directly setting the registry key is more reliable in dev environments 
    // to ensure arguments (the app path) are passed correctly.
    const regCommand = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "DexBot" /t REG_SZ /d "\\"${exePath}\\" \\"${appPath}\\"" /f`;
    
    exec(regCommand, (err) => {
      if (err) console.error("Failed to set Registry auto-start:", err);
    });

    // Remove the default Electron registration which is likely showing the welcome screen
    exec('reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "electron.app.Electron" /f');
  } catch (e) {
    console.warn("Failed to setup auto-start:", e.message);
  }
  createWindow();
  startWebSocketServer();
  startWakeWordProcess();
});

app.on("will-quit", () => {
  if (pythonProcess) {
    pythonProcess.kill();
  }
});

