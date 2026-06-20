import {
  BotSnapshot,
  DesktopApi,
  GeneralSettingsPayload,
  SaveCodesPayload,
  SaveGroupPayload,
  SaveMessageSettingsPayload,
  SaveTargetMessageSettingsPayload,
  SaveWarmupMessageSettingsPayload,
  StartBotPayload
} from "../../shared/types";

const AUTH_ERROR_MESSAGES = ["Senha do painel obrigatória.", "Login obrigatório.", "Email ou senha inválidos."];

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

export function getPanelToken() {
  return window.localStorage.getItem("panelToken") || "";
}

export function setPanelToken(token: string) {
  if (token) {
    window.localStorage.setItem("panelToken", token);
  } else {
    window.localStorage.removeItem("panelToken");
  }
}

export function getPanelUserEmail() {
  return window.localStorage.getItem("panelUserEmail") || "";
}

export function setPanelUserEmail(email: string) {
  if (email) {
    window.localStorage.setItem("panelUserEmail", email);
  } else {
    window.localStorage.removeItem("panelUserEmail");
  }
}

export function isAuthError(error: unknown) {
  return error instanceof Error && AUTH_ERROR_MESSAGES.includes(error.message);
}

export async function panelLogin(email: string, password: string) {
  const response = await fetchJson<{ token: string; user: { email: string } }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  setPanelToken(response.token);
  setPanelUserEmail(response.user.email);
  setPanelPassword("");
  return response.user;
}

async function fetchJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");

  const token = getPanelToken();
  const password = getPanelPassword();
  if (token) headers.set("x-panel-token", token);
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
    startBot: (payload?: StartBotPayload) => action("start", payload),
    stopBot: () => action("stop"),
    restartBot: () => action("restart"),
    clearSession: () => action("clear-session"),
    clearLogs: () => action("clear-logs"),
    refreshGroups: () => action("refresh-groups"),
    startMonitoring: () => action("start-monitoring"),
    startNuclearMonitoring: () => action("start-nuclear-monitoring"),
    startTestMonitoring: () => action("start-test-monitoring"),
    stopMonitoring: () => action("stop-monitoring"),
    simulateOpening: () => action("simulate-opening"),
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
