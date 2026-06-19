import {
  BotSnapshot,
  DesktopApi,
  GeneralSettingsPayload,
  SaveCodesPayload,
  SaveGroupPayload,
  SaveMessageSettingsPayload,
  SaveTargetMessageSettingsPayload,
  SaveWarmupMessageSettingsPayload
} from "../../shared/types";

const AUTH_ERROR_MESSAGE = "Senha do painel obrigatória.";

export function getPanelPassword() {
  return window.localStorage.getItem("panelPassword") || "";
}

export function setPanelPassword(password: string) {
  if (password) {
    window.localStorage.setItem("panelPassword", password);
  } else {
    window.localStorage.removeItem("panelPassword");
  }
}

export function isAuthError(error: unknown) {
  return error instanceof Error && error.message === AUTH_ERROR_MESSAGE;
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  const password = getPanelPassword();
  if (password) headers.set("x-panel-password", password);

  const response = await fetch(url, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Falha ao conversar com o servidor.");
  }

  return data as T;
}

function action<TPayload = unknown>(name: string, payload?: TPayload) {
  return fetchJson<BotSnapshot>(`/api/action/${name}`, {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

function createWebApi(): DesktopApi {
  return {
    getSnapshot: () => fetchJson<BotSnapshot>("/api/snapshot"),
    startBot: () => action("start"),
    stopBot: () => action("stop"),
    restartBot: () => action("restart"),
    clearSession: () => action("clear-session"),
    clearLogs: () => action("clear-logs"),
    refreshGroups: () => action("refresh-groups"),
    startMonitoring: () => action("start-monitoring"),
    startNuclearMonitoring: () => action("start-nuclear-monitoring"),
    startTestMonitoring: () => action("start-test-monitoring"),
    stopMonitoring: () => action("stop-monitoring"),
    saveGroup: (payload: SaveGroupPayload) => action("save-group", payload),
    saveTestGroup: (payload: SaveGroupPayload) => action("save-test-group", payload),
    warmupGroups: () => action("warmup"),
    saveCodes: (payload: SaveCodesPayload) => action("save-codes", payload),
    saveMessageSettings: (payload: SaveMessageSettingsPayload) => action("save-message-settings", payload),
    saveWarmupMessageSettings: (payload: SaveWarmupMessageSettingsPayload) =>
      action("save-warmup-message-settings", payload),
    saveTargetMessageSettings: (payload: SaveTargetMessageSettingsPayload) =>
      action("save-target-message-settings", payload),
    saveGeneralSettings: (payload: GeneralSettingsPayload) => action("save-general-settings", payload),
    onSnapshot: (callback: (snapshot: BotSnapshot) => void) => {
      const interval = window.setInterval(() => {
        fetchJson<BotSnapshot>("/api/snapshot")
          .then(callback)
          .catch(() => undefined);
      }, 2000);

      return () => window.clearInterval(interval);
    }
  };
}

export const botApi: DesktopApi = window.botApi || createWebApi();
