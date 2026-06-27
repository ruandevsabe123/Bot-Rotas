import path from "path";
import { app, BrowserWindow, ipcMain } from "electron";
import { BotService } from "../bot/connection";
import {
  BotSnapshot,
  SaveCodesPayload,
  GeneralSettingsPayload,
  SaveGroupPayload,
  SaveMessageSettingsPayload,
  SaveTargetMessageSettingsPayload,
  SaveWarmupMessageSettingsPayload
} from "../shared/types";

app.commandLine.appendSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-gpu-compositing");
app.commandLine.appendSwitch("disable-features", "Vulkan,VulkanFromANGLE,DefaultANGLEVulkan");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.disableHardwareAcceleration();

let mainWindow: BrowserWindow | undefined;
let bot: BotService;
let isQuitting = false;

const isDev = !app.isPackaged;
const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  app.quit();
}

function createBot() {
  const dataDir = isDev ? process.cwd() : app.getPath("userData");

  bot = new BotService({
    authDir: path.join(dataDir, "auth_info"),
    configPath: path.join(dataDir, "config.json"),
    logStorePath: path.join(dataDir, "bot_logs.json"),
  });

  bot.on("snapshot", (snapshot: BotSnapshot) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send("bot:snapshot", snapshot);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    title: "Bot WhatsApp",
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL("http://127.0.0.1:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
}

function registerIpc() {
  ipcMain.handle("bot:getSnapshot", () => bot.getSnapshot());
  ipcMain.handle("bot:start", async () => {
    await bot.start();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:stop", async () => {
    await bot.stop();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:restart", async () => {
    await bot.restart();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:clearSession", async () => {
    await bot.clearSession();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:factoryReset", async () => {
    await bot.factoryReset();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:clearLogs", async () => {
    bot.clearLogs();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:refreshGroups", async () => {
    await bot.refreshGroups();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:enableMonitoring", async () => {
    try {
      await bot.enableMonitoring();
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:enableImageMonitoring", async () => {
    try {
      await bot.enableImageMonitoring();
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:enableNuclearMonitoring", async () => {
    try {
      await bot.enableNuclearMonitoring();
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:enableTestMonitoring", async () => {
    try {
      await bot.enableTestMonitoring();
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:disableMonitoring", async () => {
    try {
      bot.disableMonitoring();
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:simulateOpening", async () => {
    bot.simulateOpening();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:manualDispatch", async () => {
    await bot.manualDispatch();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:simulateTargetDispatch", async () => {
    await bot.simulateTargetDispatchOnTestGroup();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveGroup", async (_event, payload: SaveGroupPayload) => {
    await bot.saveGroup(payload.group, payload.groupId, payload.groupName);
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveTestGroup", async (_event, payload: SaveGroupPayload) => {
    await bot.saveTestGroup(payload.group, payload.groupId, payload.groupName);
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveWarmupMessageSettings", async (_event, payload: SaveWarmupMessageSettingsPayload) => {
    try {
      bot.setWarmupMessageSettings(payload.senderName, payload.codes, payload.messageCount, payload.intervalMs);
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveTargetMessageSettings", async (_event, payload: SaveTargetMessageSettingsPayload) => {
    try {
      bot.setMessageSettings(payload.senderName, payload.codes, payload.routes, payload.monitoredRoutes, payload.targetDispatchMode);
    } catch (err) {
      // ignore
    }
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:warmupGroups", async () => {
    await bot.warmupConnection();
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveCodes", async (_event, payload: SaveCodesPayload) => {
    bot.setMessageCodes(payload.codes);
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveMessageSettings", async (_event, payload: SaveMessageSettingsPayload) => {
    bot.setMessageSettings(
      payload.senderName,
      payload.codes,
      (payload as SaveTargetMessageSettingsPayload).routes,
      (payload as SaveTargetMessageSettingsPayload).monitoredRoutes,
      (payload as SaveTargetMessageSettingsPayload).targetDispatchMode
    );
    return bot.getSnapshot();
  });
  ipcMain.handle("bot:saveGeneralSettings", async (_event, payload: GeneralSettingsPayload) => {
    bot.setGeneralSettings(payload);
    return bot.getSnapshot();
  });
}

app.whenReady().then(() => {
  if (!singleInstanceLock) return;

  createBot();
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on("before-quit", async (event) => {
  if (!bot || isQuitting) return;
  isQuitting = true;
  event.preventDefault();
  try {
    await bot.shutdownAndClearSession();
  } finally {
    app.exit();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
