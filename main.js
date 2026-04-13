const { app, BrowserWindow } = require("electron");

function createWindow() {
  const win = new BrowserWindow({
    width: 300,
    height: 400,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
    },
  });

  win.loadFile("index.html");
  // win.loadURL(
  //   "https://giftee.global/?gifttoken=gl_IXg8eGBpamxsa3Z4OXhgY2p2eCl4YGsn",
  // );
}

app.whenReady().then(createWindow);
