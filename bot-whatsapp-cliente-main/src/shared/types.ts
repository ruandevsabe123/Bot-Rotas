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
  targetDispatchMode: "manual" | "ocr";
  nuclearMode: boolean;
  // mensagens específicas para o uso do bot
  // mensagens enviadas no grupo alvo
  codigosMensagensAlvo: string[];
  // nomes de rotas procuradas nas imagens do grupo alvo
  rotasMonitoradas: string[];
  rotasMonitoradasDetalhadas: MonitoredRoute[];
  // mensagens enviadas durante o aquecimento (grupo de teste)
  codigosMensagensTeste: string[];
  testMessageCount: number;
  testMessageIntervalMs: number;
  fastMode: boolean;
  minSendDelayMs: number;
  alwaysWarmMode: boolean;
  keepAliveIntervalMs: number;
};

export type MonitoredRoute = {
  cidade: string;
  bairro: string;
};

export type BotPerformanceMetrics = {
  lastDispatchLatencyMs: number;
  averageDispatchLatencyMs: number;
  lastDispatchDurationMs: number;
  lastFirstRelayCallMs?: number;
  lastFirstAckMs?: number;
  lastDispatchTimeline?: RouteDispatchTimeline;
  averageMessageSendMs: number;
  dispatchCount: number;
  sentMessages: number;
  failedMessages: number;
  activeQueue: number;
  lastDispatchAt?: string;
  armedIdleMs?: number;
  lastKeepAliveAt?: string;
  lastKeepAliveDurationMs?: number;
  keepAliveCount?: number;
  telemetryCount?: number;
  averageFirstRelayMs?: number;
  p95FirstRelayMs?: number;
  averageFirstAckMs?: number;
  p95FirstAckMs?: number;
  notAcceptableCount?: number;
  lastNotAcceptableAt?: string;
  criticalWarmMode?: boolean;
};

export type RouteDispatchTimelineEvent = {
  id: string;
  label: string;
  at: string;
  offsetMs: number;
  level?: "info" | "success" | "warning" | "error";
  detail?: string;
};

export type RouteDispatchTimeline = {
  eventDetectedAt: string;
  sendStartedAt: string;
  firstRelayCalledAt?: string;
  firstAckAt?: string;
  finishedAt?: string;
  detectionDelayMs: number;
  firstRelayCallMs?: number;
  firstAckMs?: number;
  ackWaitMs?: number;
  totalDurationMs?: number;
  timeoutUsed: boolean;
  retryUsed: boolean;
  notAcceptableCount: number;
  mode: "normal" | "race";
  events: RouteDispatchTimelineEvent[];
};

export type BotTestStatus = {
  active: boolean;
  startedAt?: string;
  stoppedAt?: string;
  lastRunAt?: string;
  lastDurationMs?: number;
  lastSentCount: number;
  lastFailedCount: number;
  configuredMessageCount: number;
  intervalMs: number;
};

export type BotStatusEvent = {
  id: string;
  timestamp: string;
  type: "connected" | "disconnected" | "reconnecting" | "armed" | "disarmed" | "dispatch" | "error";
  message: string;
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
  testStatus?: BotTestStatus;
  performanceMetrics?: BotPerformanceMetrics;
  routeDispatches?: RouteDispatch[];
  statusEvents?: BotStatusEvent[];
};

export type PanelUserRole = "client" | "admin";

export type PanelUser = {
  email: string;
  role: PanelUserRole;
  blocked?: boolean;
  color?: string;
};

export type LeaderContact = {
  name: string;
  phone: string;
};

export type UserPresenceStatus = "online" | "recent" | "offline";

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
  color: string;
  presenceStatus: UserPresenceStatus;
  panelOnline: boolean;
  botOpen: boolean;
  botStatus?: BotStatus;
  monitoringEnabled?: boolean;
  performanceMetrics?: BotPerformanceMetrics;
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
  statusEvents?: BotStatusEvent[];
};

export type AdminUsersSnapshot = {
  users: AdminUserSummary[];
};

export type SupportMessage = {
  id: string;
  email: string;
  clientColor?: string;
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
  senderIdentifiers?: string[];
  isAdmin: boolean;
  leaderName?: string;
};

export type RouteReactionHistoryEvent = {
  id: string;
  timestamp: string;
  action: "add" | "remove";
  emoji: string;
  senderJid: string;
  senderPhone: string;
  senderIdentifiers?: string[];
  isAdmin: boolean;
  leaderName?: string;
};

export type RouteReactionFinalState = {
  status: "none" | "active" | "removed";
  updatedAt?: string;
  emoji?: string;
  senderPhone?: string;
  leaderName?: string;
  isAdmin?: boolean;
};

export type RouteOcrInsight = {
  source: string;
  text?: string;
  line?: string;
  route?: string;
  cidade?: string;
  bairro?: string;
  code?: string;
  confidence?: number;
  processedAt: string;
  imagePreviewUrl?: string;
};

export type RomaneioPriority =
  | "menor_distancia"
  | "menos_paradas"
  | "menos_pacotes"
  | "maior_concentracao_bairro"
  | "equilibrio_geral";

export type RomaneioNeighborhoodSummary = {
  nome: string;
  pacotes: number;
  percentualNaRota: number;
};

export type RomaneioRoutePackage = {
  id?: string;
  endereco?: string;
  bairro?: string;
  cidade?: string;
  stop?: number;
};

export type RomaneioRouteSummary = {
  rota: string;
  gaiola: string;
  plannedAt?: string;
  cidade?: string;
  distanciaKm: number;
  pacotes: number;
  paradas: number;
  tempoEstimado?: string;
  bairros: RomaneioNeighborhoodSummary[];
  pacotesIds?: string[];
  pacotesDetalhes?: RomaneioRoutePackage[];
};

export type RomaneioSettings = {
  bairrosPreferidos: string[];
  distanciaMaxKm?: number;
  paradasMax?: number;
  pacotesMax?: number;
  prioridade: RomaneioPriority;
};

export type RomaneioStatus = {
  loaded: boolean;
  uploadedAt?: string;
  fileName?: string;
  sheetName?: string;
  totalRows: number;
  totalRoutes: number;
  totalPackages: number;
  columns: string[];
  error?: string;
};

export type RomaneioSnapshot = {
  status: RomaneioStatus;
  settings: RomaneioSettings;
  routes: RomaneioRouteSummary[];
};

export type RomaneioCandidate = {
  id: string;
  fileName: string;
  timestamp: string;
  sender?: string;
  groupJid?: string;
};

export type RomaneioLocateResult = {
  found: boolean;
  message: string;
  candidates: RomaneioCandidate[];
};

export type RomaneioDetectedInfo = {
  bairro?: string;
  rota?: string;
  gaiola?: string;
};

export type RomaneioRankedRoute = RomaneioRouteSummary & {
  score: number;
  bairroMatch?: RomaneioNeighborhoodSummary;
  passedFilters: boolean;
  reasons: string[];
};

export type RouteClientIncident = {
  required: boolean;
  kind: "leader_reaction_removed" | "message_deleted";
  createdAt: string;
  message: string;
  snoozedUntil?: string;
  snoozeCount?: number;
  lastSnoozedAt?: string;
  answeredAt?: string;
  valid?: boolean;
  reason?: string;
};

export type RouteDispatch = {
  id: string;
  clientEmail: string;
  clientColor?: string;
  groupJid: string;
  groupName: string;
  mode: "target" | "test";
  trigger?: "automatic" | "manual" | "warmup" | "target-simulation" | "simulation";
  messages: string[];
  sentMessageIds: string[];
  confirmedCount: number;
  totalCount: number;
  status: "sending" | "sent" | "partial" | "failed";
  createdAt: string;
  updatedAt: string;
  validated: boolean;
  decisionStatus?: "pending" | "validated" | "rejected";
  validatedAt?: string;
  validatedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  decisionReason?: string;
  reactions: RouteReaction[];
  reactionsHistory?: RouteReactionHistoryEvent[];
  lastReactionState?: RouteReactionFinalState;
  ocr?: RouteOcrInsight;
  clientIncident?: RouteClientIncident;
  deletedMessageIds?: string[];
  dispatchTimeline?: RouteDispatchTimeline;
};

export type AdminRoutesSnapshot = {
  routes: RouteDispatch[];
  pendingReactionRoutes: RouteDispatch[];
  totals: {
    routes: number;
    validated: number;
    rejected?: number;
    pending?: number;
    reactions: number;
    removedReactions?: number;
    clients: number;
  };
};

export type AdminLogEntry = BotLog & {
  clientEmail: string;
  clientColor?: string;
};

export type AdminMonitorSnapshot = {
  routes: AdminRoutesSnapshot;
  users: AdminUsersSnapshot;
  support: AdminSupportMessagesSnapshot;
  logs: AdminLogEntry[];
  leaders?: LeaderContact[];
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
  messageCount?: number;
  intervalMs?: number;
};

export type SaveTargetMessageSettingsPayload = {
  senderName: string;
  codes: string[];
  routes?: string[];
  monitoredRoutes?: MonitoredRoute[];
  targetDispatchMode?: "manual" | "ocr";
};

export type GeneralSettingsPayload = {
  nuclearMode: boolean;
  fastMode?: boolean;
  minSendDelayMs?: number;
  alwaysWarmMode?: boolean;
  keepAliveIntervalMs?: number;
};

export type DesktopApi = {
  getSnapshot: () => Promise<BotSnapshot>;
  startBot: () => Promise<BotSnapshot>;
  stopBot: () => Promise<BotSnapshot>;
  restartBot: () => Promise<BotSnapshot>;
  clearSession: () => Promise<BotSnapshot>;
  factoryReset: () => Promise<BotSnapshot>;
  clearLogs: () => Promise<BotSnapshot>;
  refreshGroups: () => Promise<BotSnapshot>;
  startMonitoring: () => Promise<BotSnapshot>;
  startImageMonitoring: () => Promise<BotSnapshot>;
  startNuclearMonitoring: () => Promise<BotSnapshot>;
  startTestMonitoring: () => Promise<BotSnapshot>;
  stopMonitoring: () => Promise<BotSnapshot>;
  simulateOpening: () => Promise<BotSnapshot>;
  manualDispatch: () => Promise<BotSnapshot>;
  simulateTargetDispatch: () => Promise<BotSnapshot>;
  latencyProbe: () => Promise<BotSnapshot>;
  saveGroup: (payload: SaveGroupPayload) => Promise<BotSnapshot>;
  saveTestGroup: (payload: SaveGroupPayload) => Promise<BotSnapshot>;
  warmupGroups: () => Promise<BotSnapshot>;
  saveCodes: (payload: SaveCodesPayload) => Promise<BotSnapshot>;
  saveMessageSettings: (payload: SaveMessageSettingsPayload) => Promise<BotSnapshot>;
  saveWarmupMessageSettings: (payload: SaveWarmupMessageSettingsPayload) => Promise<BotSnapshot>;
  saveTargetMessageSettings: (payload: SaveTargetMessageSettingsPayload) => Promise<BotSnapshot>;
  saveGeneralSettings: (payload: GeneralSettingsPayload) => Promise<BotSnapshot>;
  submitRouteIncident: (payload: { routeId: string; valid: boolean; reason: string }) => Promise<BotSnapshot>;
  snoozeRouteIncident: (payload: { routeId: string }) => Promise<BotSnapshot>;
  onSnapshot: (callback: (snapshot: BotSnapshot) => void) => () => void;
};
