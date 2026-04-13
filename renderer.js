const { ipcRenderer } = require("electron");
document.getElementById("closeBtn").addEventListener("click", () => {
  ipcRenderer.send("app-close");
});
