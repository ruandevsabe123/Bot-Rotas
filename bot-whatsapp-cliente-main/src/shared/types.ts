export type BotStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "waiting_qr"
  | "reconnecting"
  | "error";

export type BotGroupState = "unknown" | "open" | "closed";

export type LogLevel = "info" | "success" | "warning" | "error";

export type BotLog = {
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
};

export type BotGroup = {
  id: string;
  name: string;
};

export type BotReadinessCheck = {
  id: string;
  label: string;
  ok: boolean;
};

export type BotConfig = {
  grupoAlvoJid: string;
  grupoAlvoNome: string;
  grupoTesteJid: string;
  grupoTesteNome: string;
  nomeEnvio: string;
  nuclearMode: boolean;
  // mensagens específicas para o uso do bot
  // mensagens enviadas no grupo alvo
  codigosMensagensAlvo: string[];
  // mensagens enviadas durante o aquecimento (grupo de teste)
  codigosMensagensTeste: string[];
};

export type BotSnapshot = {
  status: BotStatus;
  groupState: BotGroupState;
  qrCode: string;
  pairingCode?: string;
  config: BotConfig;
  groups: BotGroup[];
  readinessChecks: BotReadinessCheck[];
  logs: BotLog[];
  error?: string;
  monitoringEnabled?: boolean;
  monitoringMode?: "target" | "test";
  warmupCompleted?: boolean;
  warmupMessagesSent?: number;
  warmupRequiredMessages?: number;
  routeDispatches?: RouteDispatch[];
};

export type PanelUserRole = "client" | "admin";

export type PanelUser = {
  email: string;
  role: PanelUserRole;
  blocked?: boolean;
};

export type LoginEvent = {
  id: string;
  timestamp: string;
  ip: string;
  userAgent: string;
};

export type AdminUserSummary = {
  email: string;
  role: PanelUserRole;
  blocked: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastSeenAt?: string;
  totalUsageMs: number;
  loginCount: number;
};

export type AdminUserDetail = AdminUserSummary & {
  config: BotConfig;
  groups: BotGroup[];
  botStatus: BotStatus;
  monitoringEnabled?: boolean;
  monitoringMode?: "target" | "test";
  lastWhatsAppConnectionAt?: string;
  logs: BotLog[];
  routes: RouteDispatch[];
  loginHistory: LoginEvent[];
};

export type AdminUsersSnapshot = {
  users: AdminUserSummary[];
};

export type SupportMessage = {
  id: string;
  email: string;
  message: string;
  createdAt: string;
  read: boolean;
  readAt?: string;
  userAgent?: string;
};

export type AdminSupportMessagesSnapshot = {
  messages: SupportMessage[];
  unread: number;
};

export type RouteReaction = {
  id: string;
  timestamp: string;
  emoji: string;
  senderJid: string;
  senderPhone: string;
  isAdmin: boolean;
};

export type RouteDispatch = {
  id: string;
  clientEmail: string;
  groupJid: string;
  groupName: string;
  mode: "target" | "test";
  messages: string[];
  sentMessageIds: string[];
  confirmedCount: number;
  totalCount: number;
  status: "sending" | "sent" | "partial" | "failed";
  createdAt: string;
  updatedAt: string;
  validated: boolean;
  validatedAt?: string;
  validatedBy?: string;
  reactions: RouteReaction[];
};

export type AdminRoutesSnapshot = {
  routes: RouteDispatch[];
  totals: {
    routes: number;
    validated: number;
    reactions: number;
    clients: number;
  };
};

export type SaveGroupPayload = {
  group: string;
  groupId?: string;
  groupName?: string;
};

export type SaveCodesPayload = {
  codes: string[];
};

export type SaveMessageSettingsPayload = {
  senderName: string;
  codes: string[];
};

export type SaveWarmupMessageSettingsPayload = {
  senderName: string;
  codes: string[];
};

export type SaveTargetMessageSettingsPayload = {
  senderName: string;
  codes: string[];
};

export type GeneralSettingsPayload = {
  nuclearMode: boolean;
};

export type StartBotPayload = {
  pairingPhoneNumber?: string;
};

export type DesktopApi = {
  getSnapshot: () => Promise<BotSnapshot>;
  startBot: (payload?: StartBotPayload) => Promise<BotSnapshot>;
  stopBot: () => Promise<BotSnapshot>;
  restartBot: () => Promise<BotSnapshot>;
  clearSession: () => Promise<BotSnapshot>;
  factoryReset: () => Promise<BotSnapshot>;
  clearLogs: () => Promise<BotSnapshot>;
  refreshGroups: () => Promise<BotSnapshot>;
  startMonitoring: () => Promise<BotSnapshot>;
  startNuclearMonitoring: () => Promise<BotSnapshot>;
  startTestMonitoring: () => Promise<BotSnapshot>;
  stopMonitoring: () => Promise<BotSnapshot>;
  simulateOpening: () => Promise<BotSnapshot>;
  saveGroup: (payload: SaveGroupPayload) => Promise<BotSnapshot>;
  saveTestGroup: (payload: SaveGroupPayload) => Promise<BotSnapshot>;
  warmupGroups: () => Promise<BotSnapshot>;
  saveCodes: (payload: SaveCodesPayload) => Promise<BotSnapshot>;
  saveMessageSettings: (payload: SaveMessageSettingsPayload) => Promise<BotSnapshot>;
  saveWarmupMessageSettings: (payload: SaveWarmupMessageSettingsPayload) => Promise<BotSnapshot>;
  saveTargetMessageSettings: (payload: SaveTargetMessageSettingsPayload) => Promise<BotSnapshot>;
  saveGeneralSettings: (payload: GeneralSettingsPayload) => Promise<BotSnapshot>;
  onSnapshot: (callback: (snapshot: BotSnapshot) => void) => () => void;
};
