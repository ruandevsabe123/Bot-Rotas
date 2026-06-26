import {
  AdminRoutesSnapshot,
  AdminMonitorSnapshot,
  AdminSupportMessagesSnapshot,
  AdminUserDetail,
  AdminUsersSnapshot,
  BotSnapshot,
  DesktopApi,
  GeneralSettingsPayload,
  PanelUser,
  PanelUserRole,
  SaveCodesPayload,
  SaveGroupPayload,
  SaveMessageSettingsPayload,
  SaveTargetMessageSettingsPayload,
  SaveWarmupMessageSettingsPayload
} from "../../shared/types";

const AUTH_ERROR_MESSAGES = [
  "Senha do painel obrigatória.",
  "Login obrigatório.",
  "Email ou senha inválidos.",
  "Email ou senha invalidos.",
  "Usuário bloqueado pelo administrador.",
  "Acesso bloqueado. Fale com o suporte para liberar sua conta."
];

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

export function getPanelUserRole(): PanelUserRole {
  return window.localStorage.getItem("panelUserRole") === "admin" ? "admin" : "client";
}

export function setPanelUserRole(role: PanelUserRole | "") {
  if (role) {
    window.localStorage.setItem("panelUserRole", role);
  } else {
    window.localStorage.removeItem("panelUserRole");
  }
}

export function isAuthError(error: unknown) {
  return error instanceof Error && AUTH_ERROR_MESSAGES.includes(error.message);
}

export async function panelLogin(email: string, password: string) {
  const response = await fetchJson<{ token: string; user: PanelUser }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  setPanelToken(response.token);
  setPanelUserEmail(response.user.email);
  setPanelUserRole(response.user.role);
  setPanelPassword("");
  return response.user;
}

export async function getPanelMe() {
  const user = await fetchJson<PanelUser>("/api/me");
  setPanelUserEmail(user.email);
  setPanelUserRole(user.role);
  return user;
}

export function getAdminRoutes() {
  return fetchJson<AdminRoutesSnapshot>("/api/admin/routes");
}

export function getAdminMonitor() {
  return fetchJson<AdminMonitorSnapshot>("/api/admin/monitor");
}

export function subscribeAdminMonitor(callback: (snapshot: AdminMonitorSnapshot) => void, onError?: () => void) {
  const token = getPanelToken();
  if (!token) return () => undefined;

  const source = new EventSource(`/api/admin/events?token=${encodeURIComponent(token)}`);
  source.onmessage = (event) => {
    try {
      callback(JSON.parse(event.data) as AdminMonitorSnapshot);
    } catch {
      // Ignora pacote inválido e mantém a conexão viva.
    }
  };
  source.onerror = () => {
    onError?.();
  };

  return () => source.close();
}

export function validateAdminRoute(routeId: string) {
  return fetchJson<AdminRoutesSnapshot>(`/api/admin/routes/${encodeURIComponent(routeId)}/validate`, {
    method: "PATCH",
    body: JSON.stringify({})
  });
}

export function rejectAdminRoute(routeId: string) {
  return fetchJson<AdminRoutesSnapshot>(`/api/admin/routes/${encodeURIComponent(routeId)}/reject`, {
    method: "PATCH",
    body: JSON.stringify({})
  });
}

export function getAdminUsers() {
  return fetchJson<AdminUsersSnapshot>("/api/admin/users");
}

export function getAdminUserDetail(email: string) {
  return fetchJson<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(email)}`);
}

export function saveAdminUser(payload: {
  originalEmail?: string;
  email: string;
  password?: string;
  role: PanelUserRole;
  blocked: boolean;
  color: string;
}) {
  const isEdit = Boolean(payload.originalEmail);
  return fetchJson<AdminUsersSnapshot>(
    isEdit ? `/api/admin/users/${encodeURIComponent(payload.originalEmail || "")}` : "/api/admin/users",
    {
      method: isEdit ? "PATCH" : "POST",
      body: JSON.stringify(payload)
    }
  );
}

export function sendSupportMessage(payload: { email: string; message: string }) {
  return fetchJson<{ ok: boolean }>("/api/support/messages", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function getAdminSupportMessages() {
  return fetchJson<AdminSupportMessagesSnapshot>("/api/admin/support/messages");
}

export function markSupportMessageRead(id: string) {
  return fetchJson<AdminSupportMessagesSnapshot>(`/api/admin/support/messages/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({})
  });
}

export function clearAdminMaintenance(payload: { target: "logs" | "routes" | "support" | "all"; clientEmail?: string }) {
  return fetchJson<AdminMonitorSnapshot>("/api/admin/maintenance/clear", {
    method: "POST",
    body: JSON.stringify(payload)
  });
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
    startBot: () => action("start"),
    stopBot: () => action("stop"),
    restartBot: () => action("restart"),
    clearSession: () => action("clear-session"),
    factoryReset: () => action("factory-reset"),
    clearLogs: () => action("clear-logs"),
    refreshGroups: () => action("refresh-groups"),
    startMonitoring: () => action("start-monitoring"),
    startNuclearMonitoring: () => action("start-nuclear-monitoring"),
    startTestMonitoring: () => action("start-test-monitoring"),
    stopMonitoring: () => action("stop-monitoring"),
    simulateOpening: () => action("simulate-opening"),
    manualDispatch: () => action("manual-dispatch"),
    simulateTargetDispatch: () => action("simulate-target-dispatch"),
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
      const token = getPanelToken();
      if (token && "EventSource" in window) {
        const source = new EventSource(`/events?token=${encodeURIComponent(token)}`);
        source.onmessage = (event) => {
          try {
            callback(JSON.parse(event.data) as BotSnapshot);
          } catch {
            // Mantém o canal aberto se vier algum pacote inválido.
          }
        };
        source.onerror = () => undefined;
        return () => source.close();
      }

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
