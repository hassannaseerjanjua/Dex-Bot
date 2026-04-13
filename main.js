const { app, BrowserWindow, ipcMain } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 300,
    height: 400,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile("index.html");
  // win.loadURL(
  //   "https://giftee.global/?gifttoken=gl_IXg8eGBpamxsa3Z4OXhgY2p2eCl4YGsn",
  // );

  ipcMain.on("app-close", () => {
    app.quit();
  });
}

app.whenReady().then(createWindow);
