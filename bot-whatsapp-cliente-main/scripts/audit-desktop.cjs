// Runs the actual main/preload/renderer in a hidden window, using temporary data.
const assert = require("node:assert/strict");
const Module = require("node:module");
const electron = require("electron");
const directory = process.env.DESKTOP_AUDIT_DATA_DIR;
if (!directory) throw new Error("Use scripts/run-desktop-audit.cjs");
electron.app.setPath("userData", directory);
const timeout = setTimeout(() => { console.error("Desktop smoke timed out"); electron.app.exit(1); }, 30_000);
const actualLoad = Module._load;
const appProxy = new Proxy(electron.app, {
  get(target, property) {
    if (property === "isPackaged") return true;
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  }
});
const HiddenWindow = new Proxy(electron.BrowserWindow, {
  construct(target, args) { return new target({ ...args[0], show: false }); }
});
Module._load = function (name, ...args) {
  if (name === "electron") return { ...electron, app: appProxy, BrowserWindow: HiddenWindow };
  return actualLoad.call(this, name, ...args);
};
electron.app.on("browser-window-created", (_event, window) => {
  const failures = [];
  window.webContents.on("preload-error", (_event, _file, error) => failures.push(error.message));
  window.webContents.on("did-fail-load", (_event, code, description) => failures.push(`${code}: ${description}`));
  window.webContents.once("did-finish-load", async () => {
    try {
      const Database = require("better-sqlite3");
      const database = new Database(":memory:");
      assert.equal(database.prepare("SELECT 1 AS ok").get().ok, 1);
      database.close();
      const png = await require("sharp")({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
      assert.ok(png.length > 0);
      const result = await window.webContents.executeJavaScript(`(async () => {
        const snapshot = await window.botApi.getSnapshot();
        const romaneio = await window.botApi.getRomaneio();
        let rejected = false;
        try { await window.botApi.saveTargetMessageSettings({ senderName: "audit", codes: [null] }); } catch { rejected = true; }
        return { content: document.getElementById('root').textContent.length, styles: document.styleSheets.length, status: snapshot.status, loaded: romaneio.status.loaded, rejected };
      })()`);
      assert.ok(result.content > 100, "Renderer content missing");
      assert.ok(result.styles > 0, "Packaged styles did not load");
      assert.equal(result.status, "disconnected");
      assert.equal(result.loaded, false);
      assert.equal(result.rejected, true, "IPC swallowed an invalid settings error");
      assert.deepEqual(failures, []);
      console.log("PASS: hidden Electron main, preload, React/CSS, SQLite and romaneio IPC; invalid action rejected.");
      clearTimeout(timeout);
      electron.app.quit();
    } catch (error) {
      console.error(error.message);
      electron.app.exit(1);
    }
  });
});
require("../dist/desktop/main.js");
