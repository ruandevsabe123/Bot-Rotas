import { contextBridge, ipcRenderer } from "electron";
import {
  BotSnapshot,
  DesktopApi,
  GeneralSettingsPayload,
  SaveCodesPayload,
  SaveGroupPayload,
  SaveMessageSettingsPayload,
  SaveWarmupMessageSettingsPayload,
  SaveTargetMessageSettingsPayload
} from "../shared/types";

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke("bot:getSnapshot"),
  startBot: () => ipcRenderer.invoke("bot:start"),
  stopBot: () => ipcRenderer.invoke("bot:stop"),
  startMonitoring: () => ipcRenderer.invoke("bot:enableMonitoring"),
  startImageMonitoring: () => ipcRenderer.invoke("bot:enableImageMonitoring"),
  startNuclearMonitoring: () => ipcRenderer.invoke("bot:enableNuclearMonitoring"),
  startTestMonitoring: () => ipcRenderer.invoke("bot:enableTestMonitoring"),
  stopMonitoring: () => ipcRenderer.invoke("bot:disableMonitoring"),
  simulateOpening: () => ipcRenderer.invoke("bot:simulateOpening"),
  manualDispatch: () => ipcRenderer.invoke("bot:manualDispatch"),
  simulateTargetDispatch: () => ipcRenderer.invoke("bot:simulateTargetDispatch"),
  latencyProbe: () => ipcRenderer.invoke("bot:latencyProbe"),
  restartBot: () => ipcRenderer.invoke("bot:restart"),
  clearSession: () => ipcRenderer.invoke("bot:clearSession"),
  requestPairingCode: (payload) => ipcRenderer.invoke("bot:requestPairingCode", payload),
  factoryReset: () => ipcRenderer.invoke("bot:factoryReset"),
  clearLogs: () => ipcRenderer.invoke("bot:clearLogs"),
  refreshGroups: () => ipcRenderer.invoke("bot:refreshGroups"),
  saveGroup: (payload: SaveGroupPayload) => ipcRenderer.invoke("bot:saveGroup", payload),
  saveTestGroup: (payload: SaveGroupPayload) => ipcRenderer.invoke("bot:saveTestGroup", payload),
  warmupGroups: () => ipcRenderer.invoke("bot:warmupGroups"),
  saveCodes: (payload: SaveCodesPayload) => ipcRenderer.invoke("bot:saveCodes", payload),
  saveMessageSettings: (payload: SaveMessageSettingsPayload) => ipcRenderer.invoke("bot:saveMessageSettings", payload),
  saveWarmupMessageSettings: (payload: SaveWarmupMessageSettingsPayload) =>
    ipcRenderer.invoke("bot:saveWarmupMessageSettings", payload),
  saveTargetMessageSettings: (payload: SaveTargetMessageSettingsPayload) =>
    ipcRenderer.invoke("bot:saveTargetMessageSettings", payload),
  saveRoutePreset: (payload) => ipcRenderer.invoke("bot:saveRoutePreset", payload),
  deleteRoutePreset: (payload) => ipcRenderer.invoke("bot:deleteRoutePreset", payload),
  saveGeneralSettings: (payload: GeneralSettingsPayload) => ipcRenderer.invoke("bot:saveGeneralSettings", payload),
  confirmOcrRoutes: (payload: { optionIds: string[] }) => ipcRenderer.invoke("bot:confirmOcrRoutes", payload),
  submitRouteIncident: (payload: { routeId: string; valid: boolean; reason: string }) =>
    ipcRenderer.invoke("bot:submitRouteIncident", payload),
  snoozeRouteIncident: (payload: { routeId: string }) => ipcRenderer.invoke("bot:snoozeRouteIncident", payload),
  onSnapshot: (callback: (snapshot: BotSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: BotSnapshot) => callback(snapshot);
    ipcRenderer.on("bot:snapshot", listener);
    return () => ipcRenderer.removeListener("bot:snapshot", listener);
  }
};

contextBridge.exposeInMainWorld("botApi", api);
