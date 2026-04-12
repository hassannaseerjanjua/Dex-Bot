const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 300,
    height: 400,
    frame: false, // no border (like widget)
    alwaysOnTop: true, // stays above apps
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  win.loadFile("index.html");
}

app.whenReady().then(createWindow);
