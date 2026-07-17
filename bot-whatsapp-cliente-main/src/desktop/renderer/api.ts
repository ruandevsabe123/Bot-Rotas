import {
  AdminRoutesSnapshot,
  AdminMonitorSnapshot,
  AdminImageUsageSnapshot,
  AdminSupportMessagesSnapshot,
  AdminUserDetail,
  AdminUsersSnapshot,
  BotSnapshot,
  DesktopApi,
  GeneralSettingsPayload,
  LeaderContact,
  PanelUser,
  PanelUserRole,
  RomaneioLocateResult,
  RomaneioSettings,
  RomaneioSnapshot,
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

export function decideImageUsage(id: string, payload: { decision: "pending" | "billable" | "excluded"; amountCents?: number; note?: string }) {
  return fetchJson<AdminImageUsageSnapshot>(`/api/admin/image-usage/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
}

export function saveImagePricing(clientEmail: string, amountCents: number) {
  return fetchJson<AdminImageUsageSnapshot>(`/api/admin/image-pricing/${encodeURIComponent(clientEmail)}`, {
    method: "PATCH",
    body: JSON.stringify({ amountCents })
  });
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

export function rejectAdminRoute(routeId: string, reason?: string) {
  return fetchJson<AdminRoutesSnapshot>(`/api/admin/routes/${encodeURIComponent(routeId)}/reject`, {
    method: "PATCH",
    body: JSON.stringify({ reason })
  });
}

export function bulkDecideAdminRoutes(payload: { routeIds: string[]; decision: "validate" | "reject"; reason?: string }) {
  return fetchJson<AdminRoutesSnapshot & { changed: number }>("/api/admin/routes/bulk", {
    method: "POST",
    body: JSON.stringify(payload)
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

export function runAdminUserBotAction(email: string, actionName: string, payload: Record<string, unknown> = {}) {
  return fetchJson<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(email)}/action/${encodeURIComponent(actionName)}`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function saveAdminLeader(payload: LeaderContact) {
  return fetchJson<{ leaders: LeaderContact[] }>("/api/admin/leaders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function removeAdminLeader(phone: string) {
  return fetchJson<{ leaders: LeaderContact[] }>(`/api/admin/leaders/${encodeURIComponent(phone)}`, {
    method: "DELETE"
  });
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

export async function uploadRomaneio(file: File) {
  const formData = new FormData();
  formData.set("file", file);
  return fetchForm<RomaneioSnapshot>("/api/romaneio/upload", formData);
}

export function getRomaneio() {
  return fetchJson<RomaneioSnapshot>("/api/romaneio/routes");
}

export function saveRomaneioSettings(settings: RomaneioSettings) {
  return fetchJson<RomaneioSettings>("/api/romaneio/settings", {
    method: "POST",
    body: JSON.stringify(settings)
  });
}

export function locateRomaneio() {
  return fetchJson<RomaneioLocateResult>("/api/romaneio/locate", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function confirmRomaneio(candidateId: string) {
  return fetchJson<RomaneioSnapshot>("/api/romaneio/confirm", {
    method: "POST",
    body: JSON.stringify({ candidateId })
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

async function fetchForm<T>(url: string, body: FormData): Promise<T> {
  const headers = new Headers();
  const token = getPanelToken();
  const password = getPanelPassword();
  if (token) headers.set("x-panel-token", token);
  if (password) headers.set("x-panel-password", password);

  const response = await fetch(url, {
    method: "POST",
    headers,
    body
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Falha ao enviar arquivo.");
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
    startImageMonitoring: () => action("start-image-monitoring"),
    startNuclearMonitoring: () => action("start-nuclear-monitoring"),
    startTestMonitoring: () => action("start-test-monitoring"),
    stopMonitoring: () => action("stop-monitoring"),
    simulateOpening: () => action("simulate-opening"),
    manualDispatch: () => action("manual-dispatch"),
    simulateTargetDispatch: () => action("simulate-target-dispatch"),
    latencyProbe: () => action("latency-probe"),
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
    confirmOcrRoutes: (payload: { optionIds: string[] }) => action("confirm-ocr-routes", payload),
    submitRouteIncident: (payload: { routeId: string; valid: boolean; reason: string }) =>
      action("submit-route-incident", payload),
    snoozeRouteIncident: (payload: { routeId: string }) => action("snooze-route-incident", payload),
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
