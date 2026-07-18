import { Boom } from "@hapi/boom";
import P from "pino";
import fs from "fs";
import path from "path";
import os from "os";
import { webcrypto } from "crypto";
import { EventEmitter } from "events";
import { ConfigStore, DEFAULT_CONFIG } from "./config";
import { resolveGroup, normalizarTexto } from "./group";
import { BotLogger } from "./logger";
import { extractNeighborhoodAfterCity, findAllGaiolaCodesFromOcr, findNeighborhoodInOcrLine, readRouteImageOcr } from "./ocr";
import { DispatchQueueStore } from "./dispatchQueue";
import { RouteStore } from "./routeStore";
import { TelemetryStore } from "./telemetryStore";
import { RomaneioStore } from "../services/romaneio/romaneioStore";
import { BotConfig, BotGroup, BotGroupState, BotPerformanceMetrics, BotReadinessCheck, BotSnapshot, BotStatus, BotStatusEvent, BotTestStatus, LeaderContact, OcrRouteOption, OcrRouteSelectionState, RomaneioCandidate, RomaneioLocateResult, RomaneioRankedRoute, RomaneioSnapshot, RouteDispatch, RouteDispatchTimeline, RouteOcrInsight, RouteReaction } from "../shared/types";

const originalConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  if (String(args[0] || "").startsWith("Closing session:")) return;
  originalConsoleLog(...args);
};

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true
  });
}

let makeWASocket: any;
let DisconnectReason: any;
let fetchLatestBaileysVersion: any;
let useMultiFileAuthState: any;
let generateMessageIDV2: any;
let generateWAMessageFromContent: any;
let downloadMediaMessage: any;
let Browsers: any;
let baileysLoadPromise: Promise<void> | undefined;

function loadBaileys(): Promise<void> {
  if (baileysLoadPromise) return baileysLoadPromise;

  baileysLoadPromise = (async () => {
    const importModule = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<any>;
    const baileys = await importModule("@whiskeysockets/baileys");
    makeWASocket = baileys.default || baileys;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    generateMessageIDV2 = baileys.generateMessageIDV2;
    generateWAMessageFromContent = baileys.generateWAMessageFromContent;
    downloadMediaMessage = baileys.downloadMediaMessage;
    Browsers = baileys.Browsers;
  })();

  return baileysLoadPromise;
}

type BotServiceOptions = {
  authDir?: string;
  configPath?: string;
  routeStorePath?: string;
  dispatchQueuePath?: string;
  telemetryPath?: string;
  logStorePath?: string;
  romaneioDir?: string;
  clientEmail?: string;
  adminPhoneNumbers?: string[];
  leaderContacts?: LeaderContact[];
  terminalMode?: boolean;
  initialCodes?: string[];
  autoClearInvalidSession?: boolean;
};

type MonitoringMode = "target" | "test";

const MAX_RECONNECT_ATTEMPTS = 0;
const RECONNECT_DELAY_MS = 3500;
const MAX_RECONNECT_DELAY_MS = 30000;
const HEALTH_CHECK_INTERVAL_MS = 25000;
const DEFAULT_KEEP_ALIVE_INTERVAL_MS = 300000;
const RACE_KEEP_ALIVE_INTERVAL_MS = 10000;
const FULL_METADATA_KEEP_ALIVE_INTERVAL_MS = 60000;
const CRITICAL_KEEP_ALIVE_INTERVAL_MS = 5000;
const SOCKET_KEEP_ALIVE_INTERVAL_MS = 10000;
const SOCKET_CONNECT_TIMEOUT_MS = 15000;
const SOCKET_QUERY_TIMEOUT_MS = 15000;
const ROMANEIO_CANDIDATE_LIMIT = 20;
const TARGET_ACK_TIMEOUT_MS = 1200;
const TARGET_PARALLEL_STAGGER_MS = 0;
const MANUAL_ROUTE_SELECTION_STAGGER_MS = 0;
const MAX_OUTGOING_MESSAGES = 2;
const WARMUP_MESSAGE_COUNT = 15;
const PREPARED_RELAY_TTL_MS = 25000;
const CRITICAL_PREPARED_RELAY_TTL_MS = 5000;
const NOT_ACCEPTABLE_ALERT_THRESHOLD = 3;
const NOT_ACCEPTABLE_RETRY_DELAYS_MS = [25, 55, 90, 140, 220, 340, 520, 800, 1200, 1800, 2600, 3800];
const GENERIC_RETRY_DELAYS_MS = [80, 180, 360, 700, 1100];
const OPENING_TRIGGER_WORDS = [
  "abriu",
  "aberto",
  "liberado",
  "liberou",
  "pode mandar",
  "podem mandar",
  "grupo aberto"
].map((item) => normalizarTexto(item));

const CRITICAL_WINDOWS = [
  { start: "04:20", end: "08:00" },
  { start: "10:20", end: "14:00" }
];
export const DEFAULT_LEADER_CONTACTS: LeaderContact[] = [
  { name: "Gabriel Melo - Analista de Transporte", phone: "5511940670165" },
  { name: "André Bomfim", phone: "5521998970947" },
  { name: "Júlia Moura - Analista de Transporte", phone: "5522992143214" },
  { name: "Gabriel Melo", phone: "5522996189621" },
  { name: "Amanda - Analista De Transporte", phone: "5522997387295" },
  { name: "Flávia De Azevedo Barreto", phone: "5522998597005" },
  { name: "Henrique Nunes", phone: "5522999230394" },
  { name: "André Bomfim - Analista de Transporte", phone: "5511913591907" },
  { name: "Renato Balbino", phone: "5511945113460" },
  { name: "flávia barreto", phone: "5511992561962" },
  { name: "Thalles Lunga", phone: "5521967843028" },
  { name: "Renato Balbino", phone: "5522998677384" }
];

function triggerLabelForEvent(trigger: RouteDispatch["trigger"]) {
  if (trigger === "manual") return "Disparo manual";
  if (trigger === "warmup") return "Aquecimento";
  if (trigger === "target-simulation") return "Simulação do alvo";
  if (trigger === "simulation") return "Simulação de abertura";
  return "Disparo automático";
}

export class BotService extends EventEmitter {
  private sock: any;
  private status: BotStatus = "disconnected";
  private groupState: BotGroupState = "unknown";
  private qrCode = "";
  private pairingCode = "";
  private pairingCodeRequested = false;
  private error = "";
  private reconnectAttempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private healthCheckTimer?: NodeJS.Timeout;
  private warmKeepAliveTimer?: NodeJS.Timeout;
  private warmKeepAliveIntervalMs = 0;
  private stopping = false;
  private starting?: Promise<void>;
  private activeConnectionId = 0;
  private qrReceivedInCurrentConnection = false;
  private qrRefAttemptResets = 0;
  private unknownDisconnects = 0;
  private sendCycleId = 0;
  private activeSendCycle?: Promise<void>;
  private criticalDispatchInProgress = false;
  private pendingReactionBatch?: any[];
  private reactionProcessingScheduled = false;
  private monitoringEnabled = false;
  private monitoringMode: MonitoringMode = "target";
  private estadoInicialDoGrupoCapturado = false;
  private grupoJaFechouDepoisDoInicio = false;
  private diagnosedNotAcceptableCycles = new Set<number>();
  private codigosEscolhidos: string[] = [];
  private mensagensProntasAlvo: string[] = [];
  private mensagensProntasTeste: string[] = [];
  private preparedTargetJid = "";
  private preparedMessages: string[] = [];
  private preparedRelayMessages: any[] = []; // esse aqui
  private preparedRelaySignature = "";
  private preparedRelayBuiltAt = 0;
  private pendingOcrMessages: string[] = [];
  private lastOcrDispatchKey = "";
  private lastOcrInsight?: RouteOcrInsight;
  private ocrRouteSelection: OcrRouteSelectionState = { status: "idle", options: [] };
  private processingImageIds = new Set<string>();
  private latestRouteImageSequence = 0;
  private warmupMessagesSent = 0;
  private warmupCompleted = false;
  private activeTestRunId = 0;
  private testStatus: BotTestStatus = {
    active: false,
    lastSentCount: 0,
    lastFailedCount: 0,
    configuredMessageCount: WARMUP_MESSAGE_COUNT,
    intervalMs: 0
  };
  private performanceMetrics: BotPerformanceMetrics = {
    lastDispatchLatencyMs: 0,
    averageDispatchLatencyMs: 0,
    lastDispatchDurationMs: 0,
    averageMessageSendMs: 0,
    dispatchCount: 0,
    sentMessages: 0,
    failedMessages: 0,
    activeQueue: 0
  };
  private configStore: ConfigStore;
  private routeStore: RouteStore;
  private dispatchQueueStore: DispatchQueueStore;
  private telemetryStore: TelemetryStore;
  private romaneioStore?: RomaneioStore;
  private logger: BotLogger;
  private authDir: string;
  private statusEventsPath: string;
  private statusEvents: BotStatusEvent[] = [];
  private clientEmail = "";
  private adminPhoneNumbers = new Set<string>();
  private extraAdminPhoneNumbers: string[] = [];
  private leaderContacts = new Map<string, string>();
  private activeRouteByCycle = new Map<number, string>();
  private routeMessageIdsByCycle = new Map<number, string[]>();
  private dispatchQueueIdByCycle = new Map<number, string>();
  private pendingCredsSave?: NodeJS.Timeout;
  private saveCredsNow?: () => Promise<void> | void;
  private targetSimulationCycles = new Set<number>();
  private autoClearInvalidSession = false;
  private clearedInvalidSessionInCurrentRun = false;
  private groupMetadataCache = new Map<string, any>();
  private socketAllowedGroupJids = new Set<string>();
  private currentUserInTargetGroup = false;
  private groups: BotGroup[] = [];
  private armedAt?: number;
  private lastKeepAliveAt?: string;
  private lastKeepAliveDurationMs = 0;
  private keepAliveCount = 0;
  private lastFullMetadataWarmAt = 0;
  private adaptiveOpeningSettleMs = 0;
  private lastNotAcceptableAlertAt = 0;
  private romaneioDocumentCandidates = new Map<string, { candidate: RomaneioCandidate; message: any }>();
  private processingRomaneioCandidateIds = new Set<string>();
  private latestAutomaticRomaneioTimestamp = 0;

  constructor(options: BotServiceOptions = {}) {
    super();
    this.authDir = options.authDir || path.resolve(process.cwd(), "auth_info");
    this.configStore = new ConfigStore(options.configPath);
    this.routeStore = new RouteStore(options.routeStorePath || path.resolve(process.cwd(), "route_history.json"));
    this.dispatchQueueStore = new DispatchQueueStore(options.dispatchQueuePath || path.resolve(process.cwd(), "dispatch_queue.json"));
    this.telemetryStore = new TelemetryStore(options.telemetryPath || path.resolve(process.cwd(), "dispatch_telemetry.json"));
    this.romaneioStore = options.romaneioDir ? new RomaneioStore(options.romaneioDir) : undefined;
    this.logger = new BotLogger(() => this.emitSnapshot(), options.logStorePath || path.resolve(process.cwd(), "bot_logs.json"));
    this.statusEventsPath = path.join(path.dirname(options.routeStorePath || path.resolve(process.cwd(), "route_history.json")), "status_events.json");
    this.statusEvents = this.loadStatusEvents();
    this.clientEmail = options.clientEmail || "";
    const initialLeaders = options.leaderContacts?.length ? options.leaderContacts : DEFAULT_LEADER_CONTACTS;
    this.extraAdminPhoneNumbers = (options.adminPhoneNumbers || []).map((item) => this.normalizePhone(item)).filter(Boolean);
    this.leaderContacts = new Map(initialLeaders.map((item) => [this.normalizePhone(item.phone), item.name]));
    this.adminPhoneNumbers = new Set([
      ...initialLeaders.map((item) => this.normalizePhone(item.phone)),
      ...this.extraAdminPhoneNumbers
    ].filter(Boolean));
    this.autoClearInvalidSession = Boolean(options.autoClearInvalidSession);
    const config = this.configStore.load();
    this.refreshRuntimeSettings(config);
    this.refreshSocketJidFilterCache(config);
    this.codigosEscolhidos = options.initialCodes?.length ? options.initialCodes : [];
    this.montarMensagens();
    this.warmupMessagesSent = 0;
    this.warmupCompleted = false;
  }

  getSnapshot(): BotSnapshot {
    const telemetry = this.telemetryStore.summary();
    return {
      status: this.status,
      groupState: this.groupState,
      qrCode: this.qrCode,
      pairingCode: this.pairingCode || undefined,
      config: this.configStore.load(),
      groups: this.groups,
      readinessChecks: this.getReadinessChecks(),
      logs: this.logger.all(),
      error: this.error,
      monitoringEnabled: this.monitoringEnabled,
      monitoringMode: this.monitoringEnabled ? this.monitoringMode : undefined,
      warmupCompleted: this.warmupCompleted,
      warmupMessagesSent: this.warmupMessagesSent,
      warmupRequiredMessages: this.configStore.load().testMessageCount || WARMUP_MESSAGE_COUNT,
      testStatus: this.getTestStatus(),
      performanceMetrics: {
        ...this.performanceMetrics,
        armedIdleMs: this.monitoringEnabled && this.armedAt ? Date.now() - this.armedAt : 0,
        lastKeepAliveAt: this.lastKeepAliveAt,
        lastKeepAliveDurationMs: this.lastKeepAliveDurationMs,
        keepAliveCount: this.keepAliveCount,
        activeQueue: Math.max(this.performanceMetrics.activeQueue, this.dispatchQueueStore.pending().length),
        telemetryCount: telemetry.count,
        averageFirstRelayMs: telemetry.averageFirstRelayMs,
        p95FirstRelayMs: telemetry.p95FirstRelayMs,
        averageFirstAckMs: telemetry.averageFirstAckMs,
        p95FirstAckMs: telemetry.p95FirstAckMs,
        notAcceptableCount: telemetry.notAcceptableCount,
        lastNotAcceptableAt: telemetry.lastNotAcceptableAt,
        criticalWarmMode: this.isCriticalWarmWindow()
      },
      routeDispatches: this.getRoutes(),
      statusEvents: this.statusEvents,
      ocrRouteSelection: this.ocrRouteSelection
    };
  }

  getRoutes() {
    return this.routeStore.all();
  }

  private refreshRuntimeSettings(config = this.configStore.load()) {
    this.testStatus.configuredMessageCount = config.testMessageCount || WARMUP_MESSAGE_COUNT;
    this.testStatus.intervalMs = config.testMessageIntervalMs || 0;
  }

  private getTestStatus(): BotTestStatus {
    this.refreshRuntimeSettings();
    return { ...this.testStatus };
  }

  private recordDispatchMetrics(input: {
    eventDetectedAt: number;
    sendStartedAt: number;
    sendFinishedAt: number;
    confirmed: number;
    total: number;
    timeline?: RouteDispatchTimeline;
    trigger?: RouteDispatch["trigger"];
    mode?: MonitoringMode;
  }) {
    const latency = Math.max(0, input.sendStartedAt - input.eventDetectedAt);
    const duration = Math.max(0, input.sendFinishedAt - input.sendStartedAt);
    const perMessage = input.total ? duration / input.total : duration;
    const nextCount = this.performanceMetrics.dispatchCount + 1;
    const average = (current: number, next: number) => Math.round(((current * this.performanceMetrics.dispatchCount) + next) / nextCount);

    this.performanceMetrics = {
      ...this.performanceMetrics,
      lastDispatchLatencyMs: latency,
      averageDispatchLatencyMs: average(this.performanceMetrics.averageDispatchLatencyMs, latency),
      lastDispatchDurationMs: duration,
      lastFirstRelayCallMs: input.timeline?.firstRelayCallMs,
      lastFirstAckMs: input.timeline?.firstAckMs,
      lastDispatchTimeline: input.timeline,
      averageMessageSendMs: average(this.performanceMetrics.averageMessageSendMs, perMessage),
      dispatchCount: nextCount,
      sentMessages: this.performanceMetrics.sentMessages + input.confirmed,
      failedMessages: this.performanceMetrics.failedMessages + Math.max(0, input.total - input.confirmed),
      activeQueue: 0,
      lastDispatchAt: new Date(input.sendFinishedAt).toISOString()
    };

    const event = this.telemetryStore.record({
      clientEmail: this.clientEmail,
      trigger: input.trigger,
      mode: input.mode || this.monitoringMode,
      confirmed: input.confirmed,
      total: input.total,
      timeline: input.timeline
    });
    this.maybeAlertNotAcceptable(event.notAcceptableCount);
  }

  private createDispatchTimeline(eventDetectedAt: number, sendStartedAt: number, mode: RouteDispatchTimeline["mode"]): RouteDispatchTimeline {
    return {
      eventDetectedAt: new Date(eventDetectedAt).toISOString(),
      sendStartedAt: new Date(sendStartedAt).toISOString(),
      detectionDelayMs: Math.max(0, sendStartedAt - eventDetectedAt),
      timeoutUsed: false,
      retryUsed: false,
      notAcceptableCount: 0,
      mode,
      events: [
        {
          id: `event-${eventDetectedAt}`,
          label: "Evento detectado",
          at: new Date(eventDetectedAt).toISOString(),
          offsetMs: 0,
          level: "info"
        },
        {
          id: `start-${sendStartedAt}`,
          label: "Disparo iniciado",
          at: new Date(sendStartedAt).toISOString(),
          offsetMs: Math.max(0, sendStartedAt - eventDetectedAt),
          level: "info"
        }
      ]
    };
  }

  private addTimelineEvent(
    timeline: RouteDispatchTimeline,
    label: string,
    at = Date.now(),
    level: "info" | "success" | "warning" | "error" = "info",
    detail?: string
  ) {
    const base = new Date(timeline.eventDetectedAt).getTime();
    timeline.events.push({
      id: `${label}-${at}-${timeline.events.length}`,
      label,
      at: new Date(at).toISOString(),
      offsetMs: Math.max(0, at - base),
      level,
      detail
    });
  }

  private enqueueDispatch(cycleId: number, jid: string, mensagens: string[], trigger: RouteDispatch["trigger"]) {
    const item = this.dispatchQueueStore.enqueue({
      id: `${this.clientEmail || "local"}-${cycleId}`,
      cycleId,
      clientEmail: this.clientEmail,
      jid,
      messages: mensagens,
      trigger,
      mode: this.monitoringMode
    });
    this.dispatchQueueIdByCycle.set(cycleId, item.id);
    return item.id;
  }

  private markQueuedDispatchSending(cycleId: number, routeId?: string) {
    const queueId = this.dispatchQueueIdByCycle.get(cycleId);
    if (!queueId) return;
    this.dispatchQueueStore.incrementAttempts(queueId);
    this.dispatchQueueStore.markSending(queueId, routeId);
  }

  private markQueuedDispatchFinished(cycleId: number, confirmedCount: number, totalCount: number, error?: string) {
    const queueId = this.dispatchQueueIdByCycle.get(cycleId);
    if (!queueId) return;
    const status = confirmedCount === totalCount ? "sent" : confirmedCount > 0 ? "partial" : "failed";
    this.dispatchQueueStore.markFinished(queueId, status, confirmedCount, error);
    this.dispatchQueueIdByCycle.delete(cycleId);
  }

  private markQueuedDispatchAbandoned(cycleId: number, error: string) {
    const queueId = this.dispatchQueueIdByCycle.get(cycleId);
    if (!queueId) return;
    this.dispatchQueueStore.markAbandoned(queueId, error);
    this.dispatchQueueIdByCycle.delete(cycleId);
  }

  private reportPendingDispatchesAfterBoot() {
    const pending = this.dispatchQueueStore.pending();
    if (!pending.length) return;

    const recent = pending.filter((item) => Date.now() - new Date(item.updatedAt).getTime() < 1000 * 60 * 5);
    const stale = pending.filter((item) => !recent.includes(item));

    for (const item of stale) {
      this.dispatchQueueStore.markAbandoned(item.id, "Pendência antiga abandonada ao reiniciar para evitar disparo duplicado.");
    }

    if (recent.length) {
      this.logger.warning(
        `Fila encontrou ${recent.length} disparo(s) recente(s) pendente(s) após reinício. Mantive travado para evitar duplicidade; confira o histórico antes de reenviar.`
      );
    }
  }

  private scheduleCredsSave() {
    if (!this.saveCredsNow) return;
    if (this.pendingCredsSave) return;
    this.pendingCredsSave = setTimeout(() => {
      this.pendingCredsSave = undefined;
      void this.flushCreds();
    }, 300);
  }

  private async flushCreds() {
    if (this.pendingCredsSave) {
      clearTimeout(this.pendingCredsSave);
      this.pendingCredsSave = undefined;
    }
    if (!this.saveCredsNow) return;
    await this.saveCredsNow();
  }

  validateRoute(routeId: string, validatedBy: string) {
    const changed = this.routeStore.validate(routeId, validatedBy);
    if (changed) this.emitSnapshot();
    return changed;
  }

  rejectRoute(routeId: string, rejectedBy: string, reason?: string) {
    const changed = this.routeStore.reject(routeId, rejectedBy, reason);
    if (changed) this.emitSnapshot();
    return changed;
  }

  hasPendingClientIncident() {
    return this.getPendingClientIncidentRoutes().length > 0;
  }

  getPendingClientIncidentRoutes() {
    return this.getRoutes().filter((route) => RouteStore.isClientIncidentDue(route));
  }

  submitClientIncident(routeId: string, valid: boolean, reason: string) {
    if (!reason.trim()) {
      this.logger.warning("Informe o motivo antes de liberar o bot.");
      return false;
    }
    const changed = this.routeStore.answerClientIncident(routeId, { valid, reason });
    if (changed) {
      this.logger.success(`Cliente respondeu incidente da rota: ${valid ? "rota válida" : "rota não válida"} - ${reason.trim()}`);
      this.emitSnapshot();
    }
    return changed;
  }

  snoozeClientIncident(routeId: string) {
    const result = this.routeStore.snoozeClientIncident(routeId);
    if (result.ok) {
      this.logger.warning(`Cliente adiou a explicação do incidente por ${result.delayMinutes} minuto(s). Próxima cobrança: ${new Date(result.nextDueAt || Date.now()).toLocaleString("pt-BR")}.`);
      this.emitSnapshot();
      return true;
    }
    if (result.exhausted) {
      this.logger.warning("Cliente já usou todos os adiamentos do incidente. A resposta agora é obrigatória.");
    }
    return false;
  }

  setLeaderContacts(contacts: LeaderContact[]) {
    const normalized = contacts
      .map((item) => ({
        name: String(item.name || "").trim(),
        phone: this.normalizePhone(String(item.phone || ""))
      }))
      .filter((item) => item.name && item.phone);
    this.leaderContacts = new Map(normalized.map((item) => [item.phone, item.name]));
    this.adminPhoneNumbers = new Set([
      ...this.extraAdminPhoneNumbers,
      ...normalized.map((item) => item.phone)
    ].filter(Boolean));
    this.logger.success("Lista de líderes de reação atualizada.");
    this.emitSnapshot();
  }
  isMonitoringEnabled(): boolean {
    return this.monitoringEnabled;
  }

  async enableMonitoring(): Promise<boolean> {
    return this.enableTargetMonitoring(false, "manual");
  }

  async enableImageMonitoring(): Promise<boolean> {
    return this.enableTargetMonitoring(false, "ocr");
  }

  async enableNuclearMonitoring(): Promise<boolean> {
    return this.enableTargetMonitoring(true, "manual");
  }

  private async enableTargetMonitoring(useNuclearMode: boolean, targetDispatchMode: BotConfig["targetDispatchMode"]): Promise<boolean> {
    if (this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de ativar o monitoramento.");
      return false;
    }

    this.monitoringMode = "target";
    const modeLabel = targetDispatchMode === "ocr" ? "bot imagem" : useNuclearMode ? "modo nuclear" : "bot manual";
    const config = this.configStore.save({ nuclearMode: useNuclearMode, targetDispatchMode });
    this.refreshSocketJidFilterCache(config);
    this.pendingOcrMessages = [];
    this.resetOcrRouteSelection();
    this.lastOcrDispatchKey = "";
    this.latestRouteImageSequence += 1;
    this.logger.info(`Modo ${modeLabel} selecionado. Os outros modos ficarão desligados.`);

    if (!this.hasReadyMessages()) {
      this.monitoringEnabled = false;
      this.logger.error("Bot não armado: existe verificação pendente na checklist de prontidão.");
      this.emitSnapshot();
      return false;
    }

    if (!this.prepareSendPlan()) {
      this.monitoringEnabled = false;
      this.logger.error("Bot não armado: não consegui preparar o plano de disparo.");
      this.emitSnapshot();
      return false;
    }

    await this.captureInitialGroupState();
    this.monitoringEnabled = true;
    this.armedAt = Date.now();
    this.addStatusEvent("armed", `Bot armado em modo ${modeLabel}.`);
    this.startHealthCheck();
    this.startWarmKeepAlive();
    this.logger.success(targetDispatchMode === "ocr" ? "✅ BOT IMAGEM ARMADO. Aguardando foto da rota..." : useNuclearMode ? "✅ Bot NUCLEAR ARMADO. Aguardando abertura do grupo..." : "✅ Bot MANUAL ARMADO. Aguardando abertura do grupo...");
    this.emitSnapshot();
    return true;
  }

  async enableTestMonitoring(): Promise<boolean> {
    if (this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de ativar o monitoramento de teste.");
      return false;
    }

    const config = this.configStore.load();
    if (!config.grupoTesteJid && !config.grupoTesteNome) {
      this.logger.warning("Salve um grupo de teste antes de ativar o monitoramento de teste.");
      return false;
    }

    const testGroup = await this.resolveWarmupTarget(config);
    if (!testGroup?.jid) {
      this.logger.warning("Não foi possível resolver o grupo de teste para monitorar abertura e fechamento.");
      return false;
    }

    const nextConfig = testGroup.jid !== config.grupoTesteJid
      ? this.configStore.saveTestGroupById(testGroup.jid, config.grupoTesteNome || "Grupo teste")
      : config;

    this.monitoringMode = "test";
    this.refreshSocketJidFilterCache(this.configStore.save({ ...nextConfig, nuclearMode: false }));

    if (!this.hasReadyMessages("test")) {
      this.monitoringEnabled = false;
      this.logger.error("Monitoramento de teste não armado: salve as mensagens do grupo de teste.");
      this.emitSnapshot();
      return false;
    }

    if (!this.prepareSendPlan()) {
      this.monitoringEnabled = false;
      this.logger.error("Monitoramento de teste não armado: não consegui preparar as mensagens de teste.");
      this.emitSnapshot();
      return false;
    }

    await this.captureInitialGroupState();
    this.monitoringEnabled = true;
    this.armedAt = Date.now();
    this.addStatusEvent("armed", "Bot de teste armado.");
    this.startHealthCheck();
    this.startWarmKeepAlive();
    this.logger.success("✅ TESTE ARMADO - O grupo de teste será ouvido como grupo real.");
    this.emitSnapshot();
    return true;
  }

  disableMonitoring(): void {
    this.monitoringEnabled = false;
    this.monitoringMode = "target";
    this.refreshSocketJidFilterCache();
    this.armedAt = undefined;
    this.sendCycleId += 1;
    this.activeSendCycle = undefined;
    this.criticalDispatchInProgress = false;
    this.activeTestRunId += 1;
    if (this.testStatus.active) {
      this.testStatus = {
        ...this.getTestStatus(),
        active: false,
        startedAt: this.testStatus.startedAt,
        stoppedAt: new Date().toISOString(),
        lastRunAt: this.testStatus.lastRunAt,
        lastDurationMs: this.testStatus.startedAt ? Date.now() - new Date(this.testStatus.startedAt).getTime() : undefined,
        lastSentCount: this.warmupMessagesSent,
        lastFailedCount: Math.max(0, this.testStatus.configuredMessageCount - this.warmupMessagesSent)
      };
      this.logger.warning("Teste interrompido pelo painel do usuário.");
    }
    this.clearHealthCheckTimer();
    this.clearWarmKeepAliveTimer();
    this.logger.info("⏹️ Monitoramento desativado (Parou de escutar aberturas).");
    this.addStatusEvent("disarmed", "Monitoramento desativado pelo painel.");
    this.emitSnapshot();
  }

  simulateOpening(): boolean {
    if (this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de simular abertura.");
      this.emitSnapshot();
      return false;
    }

    this.monitoringMode = "target";
    this.refreshSocketJidFilterCache();

    if (!this.prepareSendPlan()) {
      this.logger.error("Simulação cancelada: não consegui preparar o plano de disparo.");
      this.emitSnapshot();
      return false;
    }

    const cycleId = ++this.sendCycleId;
    this.groupState = "open";
    this.grupoJaFechouDepoisDoInicio = false;
    this.logger.warning("Simulação de abertura acionada pelo painel.");
    this.enviarMensagensRapidas(cycleId, "simulation", Date.now());
    this.logger.info("⚡ Abertura simulada. Disparo acionado.");
    this.emitSnapshot();
    return true;
  }

  async manualDispatch(): Promise<boolean> {
    if (this.status !== "connected" || !this.sock) {
      this.logger.warning("Conecte o WhatsApp antes de disparar manualmente.");
      this.emitSnapshot();
      return false;
    }

    this.monitoringMode = "target";
    this.refreshSocketJidFilterCache();
    if (!this.configStore.load().grupoAlvoJid && this.configStore.load().grupoAlvoNome) {
      await this.resolveConfiguredGroup();
    }

    const config = this.configStore.load();
    const targetJid = config.grupoAlvoJid;

    if (!targetJid) {
      this.logger.error("Grupo alvo ainda não foi configurado.");
      this.emitSnapshot();
      return false;
    }

    try {
      const metadata = await this.refreshGroupMetadata(targetJid);
      this.groupState = metadata?.announce === false ? "open" : "closed";
    } catch (error) {
      this.logger.warning(`Não consegui confirmar o estado do grupo: ${this.getErrorMessage(error)}`);
    }

    if (this.groupState !== "open") {
      this.logger.error("Disparo manual bloqueado: o grupo ainda está fechado.");
      this.emitSnapshot();
      return false;
    }

    if (!this.prepareSendPlan()) {
      this.logger.error("Disparo manual cancelado: não consegui preparar as mensagens.");
      this.emitSnapshot();
      return false;
    }

    const cycleId = ++this.sendCycleId;
    this.grupoJaFechouDepoisDoInicio = false;
    this.enviarMensagensRapidas(cycleId, "manual", Date.now());
    this.logger.info("Disparo manual acionado pelo painel.");
    this.emitSnapshot();
    return true;
  }

  async simulateTargetDispatchOnTestGroup(): Promise<boolean> {
    if (!this.sock || this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de simular o disparo alvo.");
      return false;
    }

    const config = this.configStore.load();
    if (!config.grupoTesteJid && !config.grupoTesteNome) {
      this.logger.warning("Salve um grupo de teste antes de simular o disparo alvo.");
      return false;
    }

    this.syncMessagesFromConfig();
    let mensagens = [...this.mensagensProntasAlvo];
    if (!mensagens.length) {
      this.logger.warning("Configure as mensagens do grupo alvo antes de simular.");
      return false;
    }

    if (mensagens.length > MAX_OUTGOING_MESSAGES) {
      mensagens = mensagens.slice(0, MAX_OUTGOING_MESSAGES);
    }

    const testGroup = await this.resolveWarmupTarget(config);
    if (!testGroup?.jid) {
      this.logger.warning("Não foi possível resolver o grupo de teste para simular o alvo.");
      return false;
    }

    const cycleId = ++this.sendCycleId;
    this.targetSimulationCycles.add(cycleId);
    this.monitoringMode = "test";
    this.preparedTargetJid = testGroup.jid;
    this.preparedMessages = mensagens;
    this.rebuildPreparedRelayMessages(testGroup.jid, mensagens);
    this.registerRouteDispatch(cycleId, testGroup.jid, mensagens, "target-simulation");

    this.performanceMetrics.activeQueue = mensagens.length;
    const eventDetectedAt = Date.now();
    const sendCycle = this.sendFastSequence(testGroup.jid, mensagens, cycleId, eventDetectedAt, eventDetectedAt).finally(() => {
      this.targetSimulationCycles.delete(cycleId);
      if (cycleId === this.sendCycleId) this.activeSendCycle = undefined;
    });
    this.activeSendCycle = sendCycle;
    this.logger.info(`Simulação do alvo enviada no grupo de teste: ${mensagens.join(" | ")}`);
    this.emitSnapshot();
    return true;
  }

  async runLatencyProbeOnTestGroup(): Promise<boolean> {
    if (!this.sock || this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de medir latência.");
      return false;
    }

    const config = this.configStore.load();
    if (!config.grupoTesteJid && !config.grupoTesteNome) {
      this.logger.warning("Salve um grupo de teste antes de medir latência.");
      return false;
    }

    const testGroup = await this.resolveWarmupTarget(config);
    if (!testGroup?.jid) {
      this.logger.warning("Não foi possível resolver o grupo de teste para medir latência.");
      return false;
    }

    const previousMode = this.monitoringMode;
    const previousTargetJid = this.preparedTargetJid;
    const previousMessages = [...this.preparedMessages];
    const previousRelayMessages = [...this.preparedRelayMessages];
    const previousRelaySignature = this.preparedRelaySignature;
    const previousRelayBuiltAt = this.preparedRelayBuiltAt;

    const cycleId = ++this.sendCycleId;
    const eventDetectedAt = Date.now();
    const message = `Teste latencia ${new Date(eventDetectedAt).toLocaleTimeString("pt-BR", { hour12: false })}`;
    this.targetSimulationCycles.add(cycleId);
    this.monitoringMode = "test";
    this.refreshSocketJidFilterCache();
    this.preparedTargetJid = testGroup.jid;
    this.preparedMessages = [message];
    this.rebuildPreparedRelayMessages(testGroup.jid, [message]);
    this.enqueueDispatch(cycleId, testGroup.jid, [message], "simulation");
    const routeId = this.registerRouteDispatch(cycleId, testGroup.jid, [message], "simulation");
    this.markQueuedDispatchSending(cycleId, routeId);
    this.performanceMetrics.activeQueue = 1;

    const sendCycle = this.sendFastSequence(testGroup.jid, [message], cycleId, eventDetectedAt, eventDetectedAt, "simulation").finally(() => {
      this.targetSimulationCycles.delete(cycleId);
      if (cycleId === this.sendCycleId) this.activeSendCycle = undefined;
      this.monitoringMode = previousMode;
      this.refreshSocketJidFilterCache();
      this.preparedTargetJid = previousTargetJid;
      this.preparedMessages = previousMessages;
      this.preparedRelayMessages = previousRelayMessages;
      this.preparedRelaySignature = previousRelaySignature;
      this.preparedRelayBuiltAt = previousRelayBuiltAt;
    });

    this.activeSendCycle = sendCycle;
    this.logger.info(`Teste de latência enviado no grupo de teste: ${testGroup.jid}`);
    this.emitSnapshot();
    return true;
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.isRunning()) {
      this.logger.warning("WhatsApp já está em processo de conexão ou conectado.");
      return;
    }

    this.stopping = false;
    this.reconnectAttempts = 0;
    this.qrRefAttemptResets = 0;
    this.clearedInvalidSessionInCurrentRun = false;
    this.starting = this.connect();

    try {
      await this.starting;
    } catch (error) {
      this.error = this.getErrorMessage(error);
      this.setStatus("error");
      this.logger.error(this.error);
    } finally {
      this.starting = undefined;
    }
  }

  async stop() {
    this.monitoringEnabled = false;
    this.monitoringMode = "target";
    this.pairingCode = "";
    this.pairingCodeRequested = false;
    if (!this.isRunning()) {
      this.logger.warning("Não é possível parar: o bot ainda não foi iniciado.");
      return;
    }

    this.stopping = true;
    this.activeConnectionId += 1;
    this.clearReconnectTimer();
    this.clearHealthCheckTimer();
    this.clearWarmKeepAliveTimer();
    this.reconnectAttempts = 0;
    this.qrCode = "";

    await this.flushCreds().catch((error) => {
      this.logger.warning(`Não consegui salvar credenciais antes de parar: ${this.getErrorMessage(error)}`);
    });
    this.routeStore.flush();
    this.dispatchQueueStore.flush();
    this.telemetryStore.flush();

    if (this.sock) {
      try {
        this.sock.ev.removeAllListeners("connection.update");
        this.sock.ev.removeAllListeners("groups.update");
        this.sock.ev.removeAllListeners("messages.upsert");
        this.sock.ev.removeAllListeners("messaging-history.set");
        this.sock.end?.(undefined);
        this.sock.ws?.close?.();
      } catch (error) {
        this.logger.warning(`Falha ao encerrar conexão antiga: ${this.getErrorMessage(error)}`);
      }
    }

    this.sock = undefined;
    this.groupState = "unknown";
    this.currentUserInTargetGroup = false;
    this.criticalDispatchInProgress = false;
    this.pendingReactionBatch = undefined;
    this.reactionProcessingScheduled = false;
    this.pendingOcrMessages = [];
    this.resetOcrRouteSelection();
    this.processingImageIds.clear();
    this.latestRouteImageSequence += 1;
    this.dispatchQueueIdByCycle.clear();
    this.preparedTargetJid = "";
    this.preparedMessages = [];
    this.preparedRelayMessages = []; // esse aqui
    this.preparedRelaySignature = "";
    this.preparedRelayBuiltAt = 0;
    this.setStatus("disconnected");
    this.logger.info("Bot parado.");
  }

  async shutdownAndClearSession() {
    if (this.isRunning()) {
      await this.stop();
    } else {
      this.monitoringEnabled = false;
      this.clearReconnectTimer();
      this.clearHealthCheckTimer();
      this.clearWarmKeepAliveTimer();
      this.pairingCode = "";
      this.pairingCodeRequested = false;
    }

    this.qrCode = "";
    this.error = "";
    this.logger.info("Bot encerrado. Sessão/auth preservada para a próxima abertura.");
    this.emitSnapshot();
  }

  async restart() {
    if (!this.isRunning()) {
      this.logger.warning("Não há conexão ativa para reiniciar. Use Conectar WhatsApp.");
      return;
    }

    const shouldRestoreMonitoring = this.monitoringEnabled;
    this.logger.info("Reiniciando conexão...");
    await this.stop();
    this.monitoringEnabled = shouldRestoreMonitoring;
    await this.start();
  }

  async clearSession() {
    await this.logoutAndClearSession();
    this.qrCode = "";
    this.error = "";
    this.logger.warning("Sessão/auth apagada e logout solicitado. Gerando um novo QR Code.");
    this.emitSnapshot();
    await this.start();
  }

  async requestPairingCode(phoneNumber: string) {
    const digits = String(phoneNumber || "").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) {
      throw new Error("Informe o número completo com DDI e DDD. Exemplo: 5522999999999.");
    }
    if (this.status === "connected" || this.sock?.authState?.creds?.registered) {
      throw new Error("Já existe uma sessão salva. Use Limpar sessão antes de gerar um código para outro aparelho.");
    }
    if (!this.isRunning()) await this.start();
    if (!this.sock?.requestPairingCode) {
      throw new Error("A conexão ainda não está pronta. Aguarde o QR aparecer e tente novamente.");
    }

    this.pairingCodeRequested = true;
    try {
      const code = String(await this.sock.requestPairingCode(digits)).replace(/\D/g, "");
      if (!code) throw new Error("O WhatsApp não retornou um código de pareamento.");
      this.pairingCode = code.replace(/(.{4})/g, "$1 ").trim();
      this.logger.info(`Código de pareamento gerado para telefone terminado em ${digits.slice(-4)}.`);
      this.emitSnapshot();
    } catch (error) {
      this.pairingCodeRequested = false;
      this.pairingCode = "";
      throw new Error(`Não consegui gerar o código de pareamento: ${this.getErrorMessage(error)}`);
    }
  }

  async factoryReset() {
    this.logger.warning("Restaurando padrão de fábrica: limpando sessão, configurações e cache local.");

    if (this.isRunning()) {
      await this.stop();
    } else {
      this.monitoringEnabled = false;
      this.clearReconnectTimer();
      this.clearHealthCheckTimer();
      this.clearWarmKeepAliveTimer();
    }

    this.removeAuthDir();
    try {
      if (fs.existsSync(this.configStore.path)) {
        fs.rmSync(this.configStore.path, { force: true });
      }
    } catch (error) {
      this.logger.warning(`Falha ao apagar configuração: ${this.getErrorMessage(error)}`);
    }

    this.configStore.save(DEFAULT_CONFIG);
    this.refreshSocketJidFilterCache(DEFAULT_CONFIG);
    this.groupState = "unknown";
    this.qrCode = "";
    this.pairingCode = "";
    this.pairingCodeRequested = false;
    this.error = "";
    this.reconnectAttempts = 0;
    this.unknownDisconnects = 0;
    this.sendCycleId += 1;
    this.monitoringEnabled = false;
    this.criticalDispatchInProgress = false;
    this.pendingReactionBatch = undefined;
    this.reactionProcessingScheduled = false;
    this.pendingOcrMessages = [];
    this.resetOcrRouteSelection();
    this.lastOcrDispatchKey = "";
    this.processingImageIds.clear();
    this.latestRouteImageSequence += 1;
    this.estadoInicialDoGrupoCapturado = false;
    this.grupoJaFechouDepoisDoInicio = false;
    this.currentUserInTargetGroup = false;
    this.groups = [];
    this.groupMetadataCache.clear();
    this.dispatchQueueIdByCycle.clear();
    this.dispatchQueueStore.clear();
    this.preparedTargetJid = "";
    this.preparedMessages = [];
    this.preparedRelayMessages = [];
    this.preparedRelaySignature = "";
    this.preparedRelayBuiltAt = 0;
    this.resetWarmupState();
    this.codigosEscolhidos = [];
    this.montarMensagens();
    this.logger.success("Padrão de fábrica aplicado. Gerando novo QR Code.");
    this.emitSnapshot();
    await this.start();
  }

  async saveGroup(group: string, groupId?: string, groupName?: string) {
    const config = groupId
      ? this.configStore.saveGroupById(groupId, groupName || group)
      : this.configStore.saveGroup(group);
    this.refreshSocketJidFilterCache(config);
    this.groupState = "unknown";
    this.currentUserInTargetGroup = false;
    this.preparedTargetJid = "";
    this.preparedMessages = [];
    this.preparedRelayMessages = [];
    this.preparedRelaySignature = "";
    this.preparedRelayBuiltAt = 0;
    this.pendingOcrMessages = [];
    this.resetOcrRouteSelection();
    this.lastOcrDispatchKey = "";
    this.latestRouteImageSequence += 1;
    this.logger.success(`Grupo alterado para: ${config.grupoAlvoNome || config.grupoAlvoJid}`);

    if (this.sock && this.status === "connected") {
      await this.resolveConfiguredGroup();
    }

    this.emitSnapshot();
  }

  async saveTestGroup(group: string, groupId?: string, groupName?: string) {
    this.resetWarmupState();
    const config = groupId
      ? this.configStore.saveTestGroupById(groupId, groupName || group)
      : this.configStore.saveTestGroup(group);
    this.refreshSocketJidFilterCache(config);
    this.logger.success(`Grupo de teste salvo: ${config.grupoTesteNome || config.grupoTesteJid}`);
    this.emitSnapshot();
  }

  async warmupConnection(message?: string): Promise<boolean> {
    if (!this.sock || this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de aquecer o bot.");
      return false;
    }

    const config = this.configStore.load();
    this.refreshRuntimeSettings(config);
    if (!config.grupoTesteJid && !config.grupoTesteNome) {
      this.logger.warning("Salve um grupo de teste para aquecimento antes de iniciar.");
      return false;
    }

    if (message) this.logger.info(message);

    const warmupGroup = await this.resolveWarmupTarget(config);
    if (!warmupGroup) {
      this.logger.warning("Não foi possível resolver o grupo de teste para aquecimento.");
      return false;
    }

    // ensure warmup messages are loaded from config
    this.syncMessagesFromConfig();

    const warmupMessages = this.buildWarmupMessages();
    const testRunId = ++this.activeTestRunId;
    this.warmupMessagesSent = 0;
    this.warmupCompleted = false;
    this.testStatus = {
      ...this.getTestStatus(),
      active: true,
      startedAt: new Date().toISOString(),
      stoppedAt: undefined,
      lastRunAt: new Date().toISOString(),
      lastSentCount: 0,
      lastFailedCount: 0
    };
    const testStartedAt = Date.now();
    this.emitSnapshot();

    // send an initial marker message indicating the start of warmup with weekday, date and time
    try {
      const now = new Date();
      const timestamp = now.toLocaleString("pt-BR", {
        weekday: "long",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit"
      });
      const initialMsg = `INICIANDO AQUECIMENTO 🔽 ${timestamp}`;
      await this.relayTextMessage(this.sock, warmupGroup.jid, initialMsg);
      this.logger.info("Mensagem inicial de aquecimento enviada.");
    } catch (err) {
      this.logger.warning(`Falha ao enviar mensagem inicial de aquecimento: ${this.getErrorMessage(err)}`);
    }

    // send warmup messages as fast as possible using low-level relay messages
    const relayMessages = warmupMessages.map((mensagem) => this.buildRelayTextMessage(this.sock, warmupGroup.jid, mensagem));

    for (const [index, fullMessage] of relayMessages.entries()) {
      if (testRunId !== this.activeTestRunId) break;
      const messageNumber = index + 1;
      this.logger.info(`Enviando mensagem de teste ${messageNumber}/${warmupMessages.length} para o grupo de teste.`);
      try {
        await this.relayPreparedMessage(this.sock, warmupGroup.jid, fullMessage);
        this.warmupMessagesSent += 1;
        this.logger.success(`Teste ${messageNumber} enviado.`);
      } catch (err) {
        this.testStatus.lastFailedCount += 1;
        this.logger.warning(`Falha no envio de teste ${messageNumber}: ${this.getErrorMessage(err)}. Continuando...`);
      }

      this.testStatus.lastSentCount = this.warmupMessagesSent;
      if (config.testMessageIntervalMs > 0 && messageNumber < relayMessages.length && testRunId === this.activeTestRunId) {
        await this.delay(config.testMessageIntervalMs);
      }
    }

    if (config.grupoAlvoJid) {
      await this.refreshGroupMetadata(config.grupoAlvoJid);
    }

    const stoppedByUser = testRunId !== this.activeTestRunId;
    this.warmupCompleted = !stoppedByUser && this.warmupMessagesSent >= warmupMessages.length;
    this.testStatus = {
      ...this.getTestStatus(),
      active: false,
      startedAt: this.testStatus.startedAt,
      stoppedAt: new Date().toISOString(),
      lastRunAt: this.testStatus.lastRunAt,
      lastDurationMs: Date.now() - testStartedAt,
      lastSentCount: this.warmupMessagesSent,
      lastFailedCount: Math.max(0, warmupMessages.length - this.warmupMessagesSent)
    };
    if (this.warmupCompleted) {
      this.logger.success(`Teste concluído: ${this.warmupMessagesSent}/${warmupMessages.length} mensagens enviadas no grupo de teste.`);
    } else if (stoppedByUser) {
      this.logger.warning(`Teste parado: ${this.warmupMessagesSent}/${warmupMessages.length} mensagens enviadas.`);
    } else {
      this.logger.warning(`Teste incompleto: ${this.warmupMessagesSent}/${warmupMessages.length} mensagens enviadas.`);
    }

    this.emitSnapshot();
    return this.warmupCompleted;
  }

  private async resolveWarmupTarget(config: BotConfig) {
    try {
      const resolved = await resolveGroup(this.sock, {
        jid: config.grupoTesteJid,
        name: config.grupoTesteNome
      });

      if (resolved.jid) {
        return { jid: resolved.jid, label: "grupo de teste" };
      }
    } catch (error) {
      this.logger.warning(`Não consegui resolver o grupo de teste: ${this.getErrorMessage(error)}`);
    }

    return undefined;
  }

  private buildWarmupMessages() {
    const config = this.configStore.load();
    const count = config.testMessageCount || WARMUP_MESSAGE_COUNT;
    const baseMessages = this.mensagensProntasTeste.length
      ? this.mensagensProntasTeste
      : ["Aquecimento"].map((item) => item);

    return Array.from({ length: count }, (_, index) => {
      const message = baseMessages[index % baseMessages.length];
      return `${message} (aquecimento ${index + 1})`;
    });
  }

  private getActiveMonitoringGroup(config = this.configStore.load()) {
    if (this.monitoringMode === "test") {
      return {
        jid: config.grupoTesteJid,
        name: config.grupoTesteNome || config.grupoTesteJid,
        label: "grupo de teste"
      };
    }

    return {
      jid: config.grupoAlvoJid,
      name: config.grupoAlvoNome || config.grupoAlvoJid,
      label: "grupo alvo"
    };
  }

  private refreshSocketJidFilterCache(config = this.configStore.load()) {
    const activeGroup = this.getActiveMonitoringGroup(config).jid;
    this.socketAllowedGroupJids = new Set(
      [activeGroup, config.grupoAlvoJid, config.grupoTesteJid]
        .map((item) => String(item || ""))
        .filter(Boolean)
    );
  }

  private shouldIgnoreSocketJid(jid: string) {
    const normalized = String(jid || "");
    if (!normalized) return false;
    if (normalized === "status@broadcast" || normalized.endsWith("@newsletter")) return true;
    if (!normalized.endsWith("@g.us")) return false;

    return this.socketAllowedGroupJids.size > 0 && !this.socketAllowedGroupJids.has(normalized);
  }

  private async sendWarmupMessage(jid: string, mensagem: string, messageNumber: number) {
    const maxAttempts = 3;
    const delays = [75, 150, 250];

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.relayTextMessage(this.sock, jid, mensagem);
        this.logger.success(`Aquecimento ${messageNumber} enviado.`);
        return true;
      } catch (error) {
        const message = this.getErrorMessage(error);
        if (attempt === maxAttempts) {
          this.logger.error(`Falha no aquecimento ${messageNumber}: ${message}`);
          return false;
        }

        this.logger.warning(`Aquecimento ${messageNumber} falhou (${message}). Retentando...`);
        await this.delay(delays[attempt] || 150);
      }
    }

    return false;
  }

  private async prewarmGroup(jid: string, label: string) {
    const config = this.configStore.load();
    this.logger.info(`Aquecer ${label}: ${jid}`);

    const metadata = await this.refreshGroupMetadata(jid);
    if (!metadata) {
      throw new Error(`Não foi possível obter metadata do ${label}.`);
    }

    if (label === "grupo alvo") {
      const currentUserIds = this.getCurrentUserIds();
      const participant = metadata.participants?.find((item: any) => {
        const id = String(item.id || "");
        const number = id.split(":")[0].split("@")[0];
        return currentUserIds.includes(id) || currentUserIds.includes(`${number}@s.whatsapp.net`);
      });

      if (!participant) {
        this.currentUserInTargetGroup = false;
        this.logger.warning("A conta conectada não está no grupo alvo. Verifique a participação antes de enviar.");
      } else {
        this.currentUserInTargetGroup = true;
      }

      this.groupState = metadata.announce === true ? "closed" : "open";
    }

    this.logger.success(`Aquecimento concluído para ${label}: ${metadata.subject || jid}`);
    return true;
  }

  async refreshGroups() {
    if (!this.sock || this.status !== "connected") {
      this.logger.warning("Conecte o WhatsApp antes de carregar a lista de grupos.");
      this.emitSnapshot();
      return;
    }

    await this.loadGroups();
    this.emitSnapshot();
  }

  clearLogs(silent = false) {
    this.logger.clear();
    if (!silent) this.logger.info("Logs limpos.");
    this.emitSnapshot();
  }

  clearRouteHistory(silent = false) {
    this.routeStore.clear();
    this.activeRouteByCycle.clear();
    if (!silent) this.logger.info("Histórico de disparos limpo.");
    this.emitSnapshot();
  }

  setGeneralSettings(settings: { nuclearMode: boolean; fastMode?: boolean; minSendDelayMs?: number; alwaysWarmMode?: boolean; keepAliveIntervalMs?: number; ocrManualRouteSelection?: boolean }) {
    const currentConfig = this.configStore.load();
    const changingMode = Boolean(settings.nuclearMode) !== currentConfig.nuclearMode;
    if (this.monitoringEnabled && changingMode) {
      this.logger.warning("Pare o bot antes de trocar entre modo normal e modo nuclear.");
      this.emitSnapshot();
      return;
    }

    const nextSettings: Partial<BotConfig> = { nuclearMode: Boolean(settings.nuclearMode) };
    if (settings.fastMode !== undefined) nextSettings.fastMode = Boolean(settings.fastMode);
    if (settings.minSendDelayMs !== undefined) nextSettings.minSendDelayMs = settings.minSendDelayMs;
    if (settings.alwaysWarmMode !== undefined) nextSettings.alwaysWarmMode = Boolean(settings.alwaysWarmMode);
    if (settings.keepAliveIntervalMs !== undefined) nextSettings.keepAliveIntervalMs = settings.keepAliveIntervalMs;
    if (settings.ocrManualRouteSelection !== undefined) nextSettings.ocrManualRouteSelection = Boolean(settings.ocrManualRouteSelection);
    const config = this.configStore.save(nextSettings);
    this.refreshRuntimeSettings(config);
    this.prepareSendPlan();
    if (this.monitoringEnabled) this.startWarmKeepAlive();
    if (changingMode) {
      this.logger.success(config.nuclearMode ? "Modo nuclear ativado." : "Modo nuclear desativado.");
    }
    if (settings.ocrManualRouteSelection !== undefined) {
      this.logger.info(config.ocrManualRouteSelection
        ? "Bot imagem configurado para aprovação manual de rotas."
        : "Bot imagem configurado para escolher e enviar a melhor rota automaticamente.");
    }
    this.emitSnapshot();
  }

  setMessageCodes(codes: string[]) {
    // Set target (alvo) message codes. Do NOT reset warmup completion.
    this.codigosEscolhidos = codes.map((item) => item.trim().toUpperCase()).filter(Boolean);
    this.montarMensagens();
    this.configStore.save({ codigosMensagensAlvo: this.codigosEscolhidos });
    this.prepareSendPlan();
    this.logger.success("Mensagens do grupo alvo atualizadas.");
  }

  setMessageSettings(senderName: string, codes: string[], routes?: string[], monitoredRouteDetails?: { cidade: string; bairro: string }[], targetDispatchMode?: BotConfig["targetDispatchMode"]) {
    // Update target (alvo) message settings. Do NOT reset warmup completion.
    this.codigosEscolhidos = codes.map((item) => item.trim().toUpperCase()).filter(Boolean);
    const monitoredRoutes = (routes || codes).map((item) => item.trim()).filter(Boolean);
    const detailedRoutes = (monitoredRouteDetails || [])
      .map((item) => ({
        cidade: String(item?.cidade || "").trim(),
        bairro: String(item?.bairro || "").trim()
      }))
      .filter((item) => item.bairro);
    this.configStore.save({
      nomeEnvio: senderName.trim(),
      codigosMensagensAlvo: this.codigosEscolhidos,
      rotasMonitoradas: monitoredRoutes,
      rotasMonitoradasDetalhadas: detailedRoutes,
      ...(targetDispatchMode ? { targetDispatchMode } : {})
    });
    this.latestRouteImageSequence += 1;
    this.pendingOcrMessages = [];
    this.resetOcrRouteSelection();
    this.lastOcrDispatchKey = "";
    this.montarMensagens();
    this.prepareSendPlan();
    this.logger.success(targetDispatchMode === "ocr"
      ? `Bot imagem atualizado: ${detailedRoutes.length || monitoredRoutes.length} rota(s) monitorada(s).`
      : `Mensagens manuais atualizadas: ${this.codigosEscolhidos.length} código(s).`
    );
  }

  saveRoutePreset(name: string, routes: { cidade: string; bairro: string }[]) {
    const presetName = name.trim();
    const normalizedRoutes = routes
      .map((route) => ({ cidade: String(route?.cidade || "").trim(), bairro: String(route?.bairro || "").trim() }))
      .filter((route) => route.bairro);
    if (!presetName) throw new Error("Digite um nome para a configuração.");
    if (!normalizedRoutes.length) throw new Error("Adicione pelo menos um bairro antes de salvar a configuração.");
    const config = this.configStore.load();
    const now = new Date().toISOString();
    const existing = (config.routePresets || []).find((preset) => normalizarTexto(preset.name) === normalizarTexto(presetName));
    const preset = {
      id: existing?.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: presetName,
      routes: normalizedRoutes,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };
    const routePresets = [preset, ...(config.routePresets || []).filter((item) => item.id !== preset.id)].slice(0, 50);
    this.configStore.save({ routePresets });
    this.logger.success(`Configuração de bairros salva: ${presetName} (${normalizedRoutes.length} rota(s)).`);
    this.emitSnapshot();
  }

  deleteRoutePreset(id: string) {
    const config = this.configStore.load();
    const routePresets = (config.routePresets || []).filter((preset) => preset.id !== id);
    if (routePresets.length === (config.routePresets || []).length) throw new Error("Configuração salva não encontrada.");
    this.configStore.save({ routePresets });
    this.logger.info("Configuração de bairros excluída.");
    this.emitSnapshot();
  }

  // Save warmup (teste) message settings. This resets the warmup state.
  setWarmupMessageSettings(senderName: string, codes: string[], messageCount?: number, intervalMs?: number) {
    this.resetWarmupState();
    const nextCodes = codes.map((item) => item.trim().toUpperCase()).filter(Boolean);
    const nextSettings: Partial<BotConfig> = {
      nomeEnvio: senderName.trim(),
      codigosMensagensTeste: nextCodes
    };
    if (messageCount !== undefined) nextSettings.testMessageCount = messageCount;
    if (intervalMs !== undefined) nextSettings.testMessageIntervalMs = intervalMs;
    const config = this.configStore.save(nextSettings);
    this.refreshRuntimeSettings(config);
    this.montarMensagens();
    this.logger.success(`Teste atualizado: ${config.testMessageCount} mensagens, intervalo ${config.testMessageIntervalMs}ms.`);
  }

  locateRomaneioInGroup(): RomaneioLocateResult {
    if (!this.sock || this.status !== "connected") {
      return {
        found: false,
        message: "Conecte o WhatsApp antes de localizar o romaneio.",
        candidates: []
      };
    }

    const activeGroup = this.getActiveMonitoringGroup();
    if (!activeGroup.jid) {
      return {
        found: false,
        message: "Configure o grupo alvo antes de localizar o romaneio.",
        candidates: []
      };
    }

    this.purgeOldRomaneioCandidates();
    const candidates = Array.from(this.romaneioDocumentCandidates.values())
      .map((item) => item.candidate)
      .filter((candidate) => candidate.groupJid === activeGroup.jid)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    if (!candidates.length) {
      const persisted = this.romaneioStore?.all();
      if (persisted?.status.loaded && persisted.routes.length) {
        const uploadedAt = persisted.status.uploadedAt
          ? new Date(persisted.status.uploadedAt).toLocaleString("pt-BR")
          : "data não informada";
        this.logger.success(`[ROMANEIO] Romaneio persistido restaurado: ${persisted.status.fileName || "latest.xlsx"}, ${persisted.status.totalRoutes} rota(s).`);
        return {
          found: true,
          message: `Romaneio já carregado do armazenamento persistente: ${persisted.status.fileName || "latest.xlsx"} (${persisted.status.totalRoutes} rotas, salvo em ${uploadedAt}).`,
          candidates: []
        };
      }
      this.logger.warning("[ROMANEIO] Nenhum arquivo de hoje com nome romaneio foi encontrado no histórico recebido do grupo alvo.");
      return {
        found: false,
        message: "Não encontrei arquivo .xlsx de hoje com 'romaneio' no nome. Aguarde alguns segundos após conectar ou peça para reenviar o arquivo no grupo.",
        candidates: []
      };
    }

    const morningCount = candidates.filter((candidate) => candidate.periodo === "manha").length;
    const afternoonCount = candidates.filter((candidate) => candidate.periodo === "tarde").length;
    this.logger.info(`[ROMANEIO] ${candidates.length} candidato(s) encontrado(s) no grupo alvo. Manhã: ${morningCount}. Tarde: ${afternoonCount}.`);
    return {
      found: true,
      message: `Romaneio encontrado. Confirme o arquivo correto: ${morningCount} manhã, ${afternoonCount} tarde.`,
      candidates
    };
  }

  async confirmRomaneioCandidate(candidateId: string): Promise<RomaneioSnapshot> {
    if (!this.romaneioStore) throw new Error("Armazenamento de romaneio não configurado.");
    if (!downloadMediaMessage) throw new Error("WhatsApp ainda não está pronto para baixar mídia.");

    const item = this.romaneioDocumentCandidates.get(candidateId);
    if (!item) throw new Error("Arquivo de romaneio não encontrado. Clique em localizar novamente.");

    const buffer = await downloadMediaMessage(
      item.message,
      "buffer",
      {},
      {
        logger: P({ level: "silent" }),
        reuploadRequest: this.sock?.updateMediaMessage
      }
    );
    const snapshot = this.romaneioStore.saveUpload(item.candidate.fileName, buffer);
    this.logger.success(`[ROMANEIO] Arquivo confirmado e processado (${item.candidate.periodoLabel}): ${item.candidate.fileName}. Rotas: ${snapshot.status.totalRoutes}. Pacotes: ${snapshot.status.totalPackages}.`);
    return snapshot;
  }

  private async connect() {
    const connectionId = ++this.activeConnectionId;
    this.qrReceivedInCurrentConnection = false;
    this.pairingCode = "";
    this.pairingCodeRequested = false;
    this.estadoInicialDoGrupoCapturado = false;
    this.grupoJaFechouDepoisDoInicio = false;
    this.clearReconnectTimer();
    this.setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");
    this.error = "";
    this.logger.info(this.reconnectAttempts > 0 ? "Tentando reconectar..." : "Bot iniciado.");

    await loadBaileys();
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    this.saveCredsNow = saveCreds;
    const version = await this.getWhatsAppVersion();

    this.sock = makeWASocket({
      auth: state,
      version,
      logger: P({ level: "silent" }),
      connectTimeoutMs: SOCKET_CONNECT_TIMEOUT_MS,
      defaultQueryTimeoutMs: SOCKET_QUERY_TIMEOUT_MS,
      keepAliveIntervalMs: SOCKET_KEEP_ALIVE_INTERVAL_MS,
      emitOwnEvents: false,
      fireInitQueries: true,
      printQRInTerminal: false,
      markOnlineOnConnect: true,
      syncFullHistory: true,
      browser: Browsers?.ubuntu?.("Bot Rota Rapida") || ["Ubuntu", "Chrome", "1.0.0"],
      shouldIgnoreJid: (jid: string) => this.shouldIgnoreSocketJid(jid),
      cachedGroupMetadata: async (jid: string) => this.groupMetadataCache.get(jid)
    });

    this.sock.ev.on("creds.update", () => this.scheduleCredsSave());
    this.sock.ev.on("connection.update", (update: any) =>
      this.handleConnectionUpdate(update, connectionId)
    );
    this.sock.ev.on("groups.update", (updates: any[]) =>
      this.handleGroupsUpdate(updates, connectionId)
    );
    this.sock.ev.on("messages.upsert", ({ messages }: any) => {
      this.cacheRomaneioDocumentCandidates(messages, connectionId);
      void this.handleMessages(messages, connectionId);
    });
    this.sock.ev.on("messaging-history.set", ({ messages }: any) => {
      this.cacheRomaneioDocumentCandidates(messages || [], connectionId);
    });

  }

  private async handleConnectionUpdate(update: any, connectionId: number) {
    if (connectionId !== this.activeConnectionId) return;

    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.unknownDisconnects = 0;
      this.qrReceivedInCurrentConnection = true;
      this.qrCode = qr;
      this.setStatus("waiting_qr");
      this.logger.info("QR Code gerado.");
    }

    if (connection === "open") {
      this.unknownDisconnects = 0;
      this.reconnectAttempts = 0;
      this.qrCode = "";
      this.pairingCode = "";
      this.pairingCodeRequested = false;
      this.setStatus("connected");
      this.addStatusEvent("connected", "WhatsApp conectado.");
      this.logger.success("WhatsApp conectado.");

      try {
        this.reportPendingDispatchesAfterBoot();
        await this.loadGroups();
        await this.resolveConfiguredGroup();
        void this.prewarmConnection("Pré-aquecendo sessão após conexão...");
        if (this.monitoringEnabled) {
          await this.captureInitialGroupState();
          this.startHealthCheck();
          this.logger.success("Monitoramento restaurado após reconexão.");
        }
        this.logger.info("Aguardando abertura do grupo.");
      } catch (error) {
        this.error = this.getErrorMessage(error);
        this.setStatus("error");
        this.logger.error(this.error);
      }
    }

    if (connection === "close") {
      const closedSocket = this.sock;
      this.sock = undefined;
      this.clearHealthCheckTimer();
      this.clearWarmKeepAliveTimer();
      this.disposeSocket(closedSocket);
      if (this.stopping) return;

      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const errorMessage = this.getErrorMessage(lastDisconnect?.error);
      const disconnectDescription = this.getDisconnectDescription(statusCode, errorMessage);
      this.logger.warning(`Conexão fechada. Código: ${statusCode || "sem código"} | Erro: ${errorMessage}`);
      this.addStatusEvent("disconnected", `Conexão fechada: ${statusCode || "sem código"} ${errorMessage}`);
      console.log("WA CLOSE DEBUG:", {
        statusCode,
        errorMessage,
        lastDisconnect
      });

      if (this.isFatalRuntimeError(errorMessage)) {
        this.error = `Erro interno ao iniciar WhatsApp: ${errorMessage}`;
        this.setStatus("error");
        this.logger.error(this.error);
        return;
      }

      if (this.isRestartRequired(statusCode, errorMessage)) {
        this.reconnectAttempts = 0;
        this.unknownDisconnects = 0;
        this.logger.info("WhatsApp solicitou reinício da conexão. Credenciais preservadas; reconectando agora.");
        this.addStatusEvent("reconnecting", "WhatsApp solicitou reinício. Reconectando automaticamente.");
        this.scheduleReconnect(true);
        return;
      }

      if (this.isConnectionConflict(statusCode, errorMessage)) {
        this.logger.warning("Conflito de socket detectado. Sessão preservada; encerrando a conexão antiga antes de tentar novamente.");
        this.addStatusEvent("reconnecting", "Conflito de conexão resolvido sem apagar a sessão.");
        this.scheduleReconnect(false);
        return;
      }

      if (this.isQrRefAttemptLimit(statusCode, errorMessage)) {
        this.qrRefAttemptResets += 1;
        this.logger.warning(
          `QR Code expirou antes da leitura (${this.qrRefAttemptResets}x). Limpando tentativa parcial e gerando um QR novo.`
        );
        this.addStatusEvent("reconnecting", "QR Code expirou. Gerando um novo QR Code automaticamente.");
        this.resetPartialQrAuth();
        this.scheduleReconnect(true);
        return;
      }

      if (this.isInvalidSession(statusCode, errorMessage)) {
        if (this.autoClearInvalidSession && !this.clearedInvalidSessionInCurrentRun) {
          this.clearedInvalidSessionInCurrentRun = true;
          this.logger.warning(
            `Sessão inválida ou logout detectado (${statusCode || "sem código"}). Limpando auth_info e gerando QR novo.`
          );
          this.removeAuthDir();
          this.reconnectAttempts = 0;
          this.unknownDisconnects = 0;
          this.qrCode = "";
          this.pairingCode = "";
          this.pairingCodeRequested = false;
          this.scheduleReconnect(true);
          return;
        }

        this.failConnectionWithoutReconnect(
          `Sessão inválida ou logout detectado (${statusCode || "sem código"}). Parei para evitar loop de reconexão. Use Limpar sessão para gerar um novo QR Code/código de pareamento.`
        );
        return;
      }

      if (!statusCode) {
        this.unknownDisconnects += 1;

        if (
          this.hasAuthSession() &&
          !this.qrReceivedInCurrentConnection &&
          this.unknownDisconnects >= 2
        ) {
          this.failConnectionWithoutReconnect(
            "A sessão local fechou sem motivo claro antes de conectar. Parei para evitar loop de reconexão. Use Limpar sessão para gerar um novo QR Code/código de pareamento."
          );
          this.unknownDisconnects = 0;
          return;
        }
      }

      this.logger.warning(`WhatsApp desconectado. ${disconnectDescription}.`);
      this.scheduleReconnect(false);
    }
  }

  private failConnectionWithoutReconnect(message: string) {
    this.clearReconnectTimer();
    this.clearHealthCheckTimer();
    this.clearWarmKeepAliveTimer();
    this.reconnectAttempts = Math.max(this.reconnectAttempts, MAX_RECONNECT_ATTEMPTS);
    this.error = message;
    this.pairingCodeRequested = false;
    this.setStatus("error");
    this.logger.error(message);
  }

  private async resolveConfiguredGroup() {
    const config = this.configStore.load();
    const group = await this.resolveConfiguredTargetGroup(config);

    if (!group.jid) {
      this.logger.warning("Nenhum grupo configurado. Informe o nome ou ID na interface.");
      return;
    }

    const nextConfig: BotConfig = this.configStore.save({
      grupoAlvoJid: group.jid,
      grupoAlvoNome: group.name
    });

    await this.refreshGroupMetadata(nextConfig.grupoAlvoJid);
    this.prepareSendPlan();

    this.logger.success(`Grupo configurado: ${nextConfig.grupoAlvoNome}`);
  }

  private async resolveConfiguredTargetGroup(config: BotConfig) {
    if (config.grupoAlvoJid && this.groupMetadataCache.has(config.grupoAlvoJid)) {
      const metadata = this.groupMetadataCache.get(config.grupoAlvoJid);
      return {
        jid: config.grupoAlvoJid,
        name: String(metadata?.subject || config.grupoAlvoNome || "Grupo salvo")
      };
    }

    if (config.grupoAlvoNome) {
      const wanted = normalizarTexto(config.grupoAlvoNome);
      const foundByName = this.groups.find((group) => normalizarTexto(group.name) === wanted);

      if (foundByName) {
        this.logger.info("Grupo salvo por ID não foi encontrado. Revalidando pelo nome do grupo.");
        return {
          jid: foundByName.id,
          name: foundByName.name
        };
      }
    }

    if (config.grupoAlvoJid) {
      this.logger.warning(
        "O ID do grupo salvo não apareceu na lista atual do WhatsApp. Atualize a lista e salve o grupo novamente."
      );
      return {
        jid: "",
        name: config.grupoAlvoNome
      };
    }

    return resolveGroup(this.sock, {
      jid: config.grupoAlvoJid,
      name: config.grupoAlvoNome
    });
  }

  private async loadGroups() {
    const grupos = await this.sock.groupFetchAllParticipating();
    const listaGrupos = (Object.values(grupos) as any[])
      .map((grupo) => ({
        id: String(grupo.id || ""),
        name: String(grupo.subject || "Grupo sem nome")
      }))
      .filter((grupo) => grupo.id)
      .sort((a, b) => normalizarTexto(a.name).localeCompare(normalizarTexto(b.name)));

    this.groups = listaGrupos;

    for (const grupo of Object.values(grupos) as any[]) {
      if (grupo?.id) {
        this.groupMetadataCache.set(grupo.id, grupo);
      }
    }

    this.logger.success(`${this.groups.length} grupos carregados do WhatsApp.`);
  }

  private async captureInitialGroupState(): Promise<void> {
    try {
      const config = this.configStore.load();
      const activeGroup = this.getActiveMonitoringGroup(config);
      if (!activeGroup.jid || !this.sock) return;

      const metadata = await this.refreshGroupMetadata(activeGroup.jid);
      if (!metadata) return;

      const isGroupClosed = metadata.announce === true;
      this.groupState = isGroupClosed ? "closed" : "open";
      
      if (isGroupClosed) {
        this.estadoInicialDoGrupoCapturado = true;
        this.grupoJaFechouDepoisDoInicio = true;
        this.logger.info(`📌 Estado inicial do ${activeGroup.label}: FECHADO. Aguardando abertura...`);
      } else {
        this.estadoInicialDoGrupoCapturado = true;
        this.grupoJaFechouDepoisDoInicio = false;
        this.logger.info(`📌 Estado inicial do ${activeGroup.label}: ABERTO. Aguardando fechamento e reabertura...`);
      }
    } catch (error) {
      this.logger.warning(`Não foi possível capturar estado inicial do grupo: ${this.getErrorMessage(error)}`);
    }
  }

  private scheduleReconnect(forceNewQr: boolean) {
    this.clearReconnectTimer();

    if (MAX_RECONNECT_ATTEMPTS > 0 && this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.clearReconnectTimer();
      this.clearHealthCheckTimer();
      this.clearWarmKeepAliveTimer();
      this.error =
        "Limite de reconexão atingido. A internet pode estar instável ou a sessão pode estar inválida. Use Limpar sessão para gerar um novo QR Code.";
      this.setStatus("error");
      this.logger.error(this.error);
      return;
    }

    this.reconnectAttempts += 1;
    this.setStatus("reconnecting");
    this.addStatusEvent(
      "reconnecting",
      MAX_RECONNECT_ATTEMPTS > 0
        ? `Tentativa de reconexão ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}.`
        : `Tentativa de reconexão ${this.reconnectAttempts}.`
    );
    const backoffMs = forceNewQr
      ? 500
      : Math.min(MAX_RECONNECT_DELAY_MS, RECONNECT_DELAY_MS + Math.max(0, this.reconnectAttempts - 1) * 2500);
    this.reconnectTimer = setTimeout(() => {
      this.connect().catch((error) => {
        this.error = this.getErrorMessage(error);
        this.logger.warning(`Reconexão falhou: ${this.error}`);
        this.scheduleReconnect(false);
      });
    }, backoffMs);
  }

  private handleGroupsUpdate(updates: any[], connectionId: number) {
    if (connectionId !== this.activeConnectionId) return;
    if (!this.monitoringEnabled) return;

    const activeGroup = this.getActiveMonitoringGroup();
    if (!activeGroup.jid) return;

    for (const update of updates) {
      if (!update?.id || update.id !== activeGroup.jid) continue;

      if (update.announce === true) {
        this.groupState = "closed";
        this.grupoJaFechouDepoisDoInicio = true;
        this.sendCycleId += 1;
        this.activeSendCycle = undefined;
        this.criticalDispatchInProgress = false;
        this.logger.info(`🔒 ${activeGroup.label} FECHADO. Bot armado para próxima abertura.`);
        this.prepareSendPlan();
        this.logger.info("Plano de disparo preparado em memória para a próxima abertura.");
        return;
      }

      if (update.announce === false) {
        this.groupState = "open";
        if (!this.grupoJaFechouDepoisDoInicio) {
          this.logger.info(`⚠️ ${activeGroup.label} já estava aberto desde o início. Aguardando próximo ciclo de fechamento e reabertura...`);
          return;
        }

        const config = this.configStore.load();
        if (this.monitoringMode === "target" && config.targetDispatchMode === "ocr" && !this.pendingOcrMessages.length) {
          this.logger.info("Grupo abriu, mas o bot imagem ainda não tem rota segura lida da foto. Nenhuma mensagem enviada.");
          return;
        }

        const cycleId = ++this.sendCycleId;
        this.grupoJaFechouDepoisDoInicio = false;
        this.enviarMensagensRapidas(cycleId, this.monitoringMode === "test" ? "warmup" : "automatic", Date.now());
        this.logger.info(`⚡ ${activeGroup.label} ABRIU! Disparo acionado.`);
        return;
      }
    }
  }
  private async handleMessages(messages: any[], connectionId: number) {
    if (connectionId !== this.activeConnectionId) return;
    if (!this.monitoringEnabled) {
      this.scheduleReactionProcessing(messages);
      return;
    }

    const activeGroup = this.getActiveMonitoringGroup();
    if (!activeGroup.jid) {
      this.scheduleReactionProcessing(messages);
      return;
    }
    const config = this.configStore.load();

    for (const msg of messages || []) {
      if (!msg?.message || !msg.key?.remoteJid) continue;
      if (msg.key.remoteJid !== activeGroup.jid) continue;

      this.handleDeletedMessageNotice(msg);

      if (this.monitoringMode === "target" && config.targetDispatchMode === "ocr" && msg.message.imageMessage) {
        this.logger.info("Imagem recebida no grupo alvo. Iniciando análise OCR e cruzamento com romaneio.");
        this.scheduleRouteImageProcessing(msg, activeGroup.jid);
      }

      const texto =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        msg.message.videoMessage?.caption ||
        "";

      if (!texto) continue;

      const textoNormalizado = normalizarTexto(texto);

      const detectouAbertura = OPENING_TRIGGER_WORDS.some((palavra) => textoNormalizado.includes(palavra));

      if (detectouAbertura) {
        if (!this.grupoJaFechouDepoisDoInicio) {
          this.logger.info(
            "Palavra de abertura detectada, mas o grupo ainda não fechou após o bot iniciar. Nenhuma mensagem enviada."
          );
          this.scheduleReactionProcessing(messages);
          return;
        }

        if (this.monitoringMode === "target" && config.targetDispatchMode === "ocr" && !this.pendingOcrMessages.length) {
          this.logger.info("Palavra de abertura detectada, mas o bot imagem ainda não tem rota segura lida da foto. Nenhuma mensagem enviada.");
          this.scheduleReactionProcessing(messages);
          return;
        }

        const cycleId = ++this.sendCycleId;
        this.grupoJaFechouDepoisDoInicio = false;
        this.enviarMensagensRapidas(cycleId, this.monitoringMode === "test" ? "warmup" : "automatic", Date.now());
        this.logger.info("Palavra de abertura detectada. Rajada instantânea acionada.");
        this.scheduleReactionProcessing(messages);
        return;
      }
    }

    this.scheduleReactionProcessing(messages);
  }

  private scheduleReactionProcessing(messages: any[]) {
    const reactions = (messages || []).filter((msg) => msg?.message?.reactionMessage);
    if (!reactions.length) return;

    this.pendingReactionBatch = [...(this.pendingReactionBatch || []), ...reactions].slice(-100);
    if (this.reactionProcessingScheduled) return;

    this.reactionProcessingScheduled = true;
    setTimeout(() => {
      const batch = this.pendingReactionBatch || [];
      this.pendingReactionBatch = undefined;
      this.reactionProcessingScheduled = false;

      if (this.criticalDispatchInProgress) {
        this.scheduleReactionProcessing(batch);
        return;
      }

      void this.handleReactions(batch).catch((error) => {
        this.logger.warning(`Reações processadas fora do caminho crítico falharam: ${this.getErrorMessage(error)}`);
      });
    }, this.criticalDispatchInProgress ? 3000 : this.monitoringEnabled ? 5000 : 0);
  }

  private scheduleRouteImageProcessing(msg: any, groupJid: string) {
    const config = this.configStore.load();
    if (config.targetDispatchMode !== "ocr" || !downloadMediaMessage) return;

    const messageId = String(msg?.key?.id || "");
    if (!messageId || this.processingImageIds.has(messageId)) return;

    const sequence = ++this.latestRouteImageSequence;
    this.processingImageIds.add(messageId);
    setTimeout(() => {
      void this.processRouteImage(msg, groupJid, sequence).finally(() => {
        this.processingImageIds.delete(messageId);
      });
    }, this.criticalDispatchInProgress ? 3000 : 0);
  }

  private async processRouteImage(msg: any, groupJid: string, sequence: number) {
    const config = this.configStore.load();
    if (config.targetDispatchMode !== "ocr" || !this.sock) return;

    const messageId = String(msg?.key?.id || Date.now());
    const imagePath = path.join(os.tmpdir(), `bot-rota-${messageId.replace(/[^a-z0-9_-]/gi, "") || Date.now()}.jpg`);

    try {
      this.ocrRouteSelection = {
        status: "analyzing",
        options: [],
        processedAt: new Date().toISOString(),
        message: "Analisando imagem..."
      };
      this.pendingOcrMessages = [];
      this.emitSnapshot();

      const buffer = await downloadMediaMessage(
        msg,
        "buffer",
        {},
        {
          logger: P({ level: "silent" }),
          reuploadRequest: this.sock.updateMediaMessage
        }
      );

      await fs.promises.writeFile(imagePath, buffer);
      const ocr = await readRouteImageOcr(imagePath, {
        maxReadings: 1
      });
      if (sequence !== this.latestRouteImageSequence) {
        this.logger.info("OCR descartou uma imagem antiga porque uma foto mais recente já entrou na fila.");
        return;
      }
      const detectedRoutes = findAllGaiolaCodesFromOcr(ocr);
      const detected = detectedRoutes[0];
      if (!detected) {
        this.emit("image-analysis", {
          id: `${this.clientEmail}:${messageId}`,
          messageId,
          result: "unreadable"
        });
        const wanted = this.describeConfiguredOcrRoutes(config);
        this.logger.info(`OCR (${ocr.source}) leu ${ocr.lines.length} linha(s), mas não achou bairro na coluna correta com gaiola segura na mesma linha. Procurando: ${wanted}.`);
        const recognizedLines = ocr.variants
          ?.flatMap((variant) => variant.lines.map((line) => line.text.trim()).filter(Boolean))
          .filter((line, index, all) => all.indexOf(line) === index)
          .slice(0, 60)
          .join(" | ") || ocr.text.replace(/\s*\r?\n\s*/g, " | ").trim();
        this.logger.info(`OCR texto reconhecido: ${recognizedLines.slice(0, 3000) || "(vazio)"}`);
        this.ocrRouteSelection = {
          status: "error",
          options: [],
          source: ocr.source,
          processedAt: new Date().toISOString(),
          message: "Imagem analisada, mas nenhuma rota segura foi encontrada."
        };
        this.emitSnapshot();
        return;
      }

      const dispatchKey = `${groupJid}:${normalizarTexto(detected.route)}:${detected.code}`;
      if (this.lastOcrDispatchKey === dispatchKey) {
        this.logger.info(`OCR recebeu rota repetida: ${detected.route} ${detected.code}. Atualizando opções no painel.`);
      }

      this.lastOcrDispatchKey = dispatchKey;
      this.lastOcrInsight = {
        analysisId: `${this.clientEmail}:${messageId}`,
        source: ocr.source,
        text: ocr.text,
        line: detected.line,
        route: detected.route,
        cidade: detected.cidade,
        bairro: detected.bairro,
        code: detected.code,
        confidence: detected.confidence,
        processedAt: new Date().toISOString()
      };
      this.emit("image-analysis", {
        id: `${this.clientEmail}:${messageId}`,
        messageId,
        result: "detected",
        route: detected.route,
        bairro: detected.bairro,
        gaiola: detected.code,
        confidence: detected.confidence
      });

      const options = detectedRoutes
        .flatMap((route) => this.buildOcrRouteOptions(route))
        .filter((option, index, all) => all.findIndex((item) => item.id === option.id) === index)
        .sort((left, right) => this.compareOcrRouteOptions(left, right))
        .slice(0, 50)
        .map((option, index) => ({ ...option, rank: index + 1 }));
      if (!options.length) {
        this.ocrRouteSelection = {
          status: "error",
          detected: { rota: detected.route, bairro: detected.bairro, gaiola: detected.code },
          source: ocr.source,
          line: detected.line,
          processedAt: new Date().toISOString(),
          options: [],
          message: "Imagem analisada, mas não encontrei opções no romaneio. Confira se o romaneio correto foi confirmado."
        };
        this.logger.warning(`[ROMANEIO] OCR detectou ${detected.route} ${detected.code}, mas não há opções de romaneio para aprovação.`);
        this.emitSnapshot();
        return;
      }

      const readySelection = {
        status: "ready",
        detected: { rota: detected.route, bairro: detected.bairro, gaiola: detected.code },
        source: ocr.source,
        line: detected.line,
        processedAt: new Date().toISOString(),
        options,
        message: `Imagem analisada. ${detectedRoutes.length} rota(s) encontrada(s) na foto.`
      } as const;
      if (!config.ocrManualRouteSelection) {
        const bestEligibleOption = options.find((option) => option.passedFilters && option.romaneioMatch !== false);
        if (!bestEligibleOption) {
          this.ocrRouteSelection = {
            ...readySelection,
            message: "Rotas identificadas, mas nenhuma respeita todos os filtros configurados e possui correspondência no romaneio. Envio bloqueado."
          };
          this.logger.warning("[ROMANEIO] Envio automático bloqueado: nenhuma rota identificada passou por todos os filtros configurados.");
          this.emitSnapshot();
          return;
        }
        this.ocrRouteSelection = readySelection;
        this.applyOcrRouteSelection([bestEligibleOption], "automatic");
        this.logger.success(`[ROMANEIO] Imagem analisada. ${detectedRoutes.length} rota(s) detectada(s); melhor opção selecionada automaticamente.`);
        const sentImmediately = await this.dispatchPreparedOcrIfGroupOpen("automatic");
        if (!sentImmediately) {
          this.logger.info("[ROMANEIO] Melhor rota escolhida automaticamente e preparada para quando o grupo abrir.");
        }
      } else {
        this.ocrRouteSelection = readySelection;
        this.logger.success(`[ROMANEIO] Imagem analisada. ${detectedRoutes.length} rota(s) detectada(s) e ${options.length} opção(ões) disponível(is) para aprovação manual.`);
      }
      this.emitSnapshot();
    } catch (error) {
      if (sequence !== this.latestRouteImageSequence) return;
      this.emit("image-analysis", {
        id: `${this.clientEmail}:${messageId}`,
        messageId,
        result: "failed"
      });
      this.ocrRouteSelection = {
        status: "error",
        options: [],
        processedAt: new Date().toISOString(),
        message: `OCR da imagem falhou: ${this.getErrorMessage(error)}`
      };
      this.emitSnapshot();
      this.logger.warning(`OCR da imagem falhou: ${this.getErrorMessage(error)}`);
    } finally {
      try {
        fs.rmSync(imagePath, { force: true });
      } catch {
        // Arquivo temporário já pode ter sido removido.
      }
    }
  }

  confirmOcrRouteSelection(optionIds: string[]) {
    const selection = this.ocrRouteSelection;
    if (selection.status !== "ready" || !selection.options.length) {
      throw new Error("Nenhuma análise de imagem aguardando confirmação.");
    }

    const selected = optionIds
      .filter(Boolean)
      .slice(0, MAX_OUTGOING_MESSAGES)
      .map((id) => selection.options.find((option) => option.id === id))
      .filter(Boolean) as OcrRouteOption[];
    if (!selected.length) throw new Error("Selecione pelo menos uma rota.");
    if (selected.some((option) => !option.passedFilters || option.romaneioMatch === false)) {
      throw new Error("A rota selecionada não respeita todos os filtros ou não foi confirmada no romaneio.");
    }

    this.applyOcrRouteSelection(selected, "manual");
    void this.dispatchPreparedOcrIfGroupOpen("manual");
    this.emitSnapshot();
  }

  private async dispatchPreparedOcrIfGroupOpen(trigger: "manual" | "automatic") {
    const activeGroup = this.getActiveMonitoringGroup();
    if (!activeGroup.jid || !this.pendingOcrMessages.length) return false;

    let isOpen = this.groupState === "open";
    if (!isOpen) {
      try {
        const metadata = await this.refreshGroupMetadata(activeGroup.jid);
        if (metadata?.announce === false) {
          this.groupState = "open";
          isOpen = true;
        } else if (metadata?.announce === true) {
          this.groupState = "closed";
          isOpen = false;
        }
      } catch (error) {
        this.logger.warning(`[ROMANEIO] Não consegui atualizar o estado do grupo após a imagem: ${this.getErrorMessage(error)}. Usando estado em memória.`);
      }
    }

    if (!isOpen) return false;
    const cycleId = ++this.sendCycleId;
    this.grupoJaFechouDepoisDoInicio = false;
    this.enviarMensagensRapidas(cycleId, trigger, Date.now());
    this.logger.info(trigger === "automatic"
      ? "[ROMANEIO] Grupo já estava aberto: melhor rota enviada imediatamente após a imagem."
      : "[ROMANEIO] Grupo já estava aberto: rota confirmada enviada imediatamente.");
    this.emitSnapshot();
    return true;
  }

  private applyOcrRouteSelection(selected: OcrRouteOption[], mode: "manual" | "automatic") {
    const config = this.configStore.load();
    const messages = selected
      .map((option) => `${config.nomeEnvio} ${option.gaiola}`.trim())
      .filter(Boolean);
    if (!messages.length) throw new Error("Configure o nome de envio antes de confirmar a rota.");

    const activeGroup = this.getActiveMonitoringGroup(config);
    this.pendingOcrMessages = messages;
    this.preparedTargetJid = activeGroup.jid;
    this.preparedMessages = messages;
    if (activeGroup.jid) this.rebuildPreparedRelayMessages(activeGroup.jid, messages);

    this.ocrRouteSelection = {
      ...this.ocrRouteSelection,
      status: "confirmed",
      selectedOptionIds: selected.map((option) => option.id),
      preparedMessages: messages,
      message: mode === "manual"
        ? "Rotas confirmadas. O bot enviará quando o grupo abrir."
        : "Modo automático: melhor rota escolhida pelo bot."
    };
    this.logger.success(mode === "manual"
      ? `[ROMANEIO] Cliente confirmou ${selected.length} rota(s): ${messages.join(" | ")}.`
      : `[ROMANEIO] Bot escolheu automaticamente a melhor rota: ${messages.join(" | ")}.`);
  }

  private buildOcrRouteOptions(detected: { route?: string; bairro?: string; code?: string; line?: string; confidence?: number }): OcrRouteOption[] {
    if (!detected.code) return [];
    const fallback = () => [this.toOcrFallbackOption(detected)];
    if (!this.romaneioStore) return fallback();

    try {
      const exactGaiolaOptions = this.romaneioStore
        .rankForDetected({ gaiola: detected.code, bairro: detected.bairro })
        .filter((route) => this.ocrRouteLooksCompatible(route, detected));

      const matched = exactGaiolaOptions
        .slice(0, 8)
        .map((route, index) => {
          const imageBairro = findNeighborhoodInOcrLine(
            detected.line || "",
            route.bairros.map((bairro) => bairro.nome)
          ) || extractNeighborhoodAfterCity(detected.line || "", route.cidade) || detected.bairro;
          return this.toOcrRouteOption(route, index + 1, imageBairro);
        });
      return matched.length ? matched : fallback();
    } catch (error) {
      this.logger.warning(`[ROMANEIO] Falha ao cruzar OCR com romaneio: ${this.getErrorMessage(error)}`);
      return fallback();
    }
  }

  private toOcrFallbackOption(detected: { route?: string; bairro?: string; code?: string; confidence?: number }): OcrRouteOption {
    const bairro = detected.bairro || detected.route || "Rota identificada";
    return {
      id: `ocr-sem-romaneio::${bairro}::${detected.code}`,
      rank: 1,
      rota: detected.route || bairro,
      gaiola: detected.code || "",
      bairro,
      distanciaKm: 0,
      pacotes: 0,
      paradas: 0,
      passedFilters: false,
      reasons: ["Sem correspondência no romaneio; não foi possível validar os filtros."],
      score: detected.confidence || 0,
      romaneioMatch: false,
      observation: "Rota identificada na imagem, mas não encontrada ou não correspondente no romaneio."
    };
  }

  private ocrRouteLooksCompatible(route: RomaneioRankedRoute, detected: { route?: string; bairro?: string; code?: string }) {
    const wantedBairro = normalizarTexto(detected.bairro || "");
    const wantedRoute = normalizarTexto(detected.route || "");
    const routeText = normalizarTexto(route.rota || "");
    const routeMatches = !wantedRoute ||
      Boolean(wantedBairro && wantedRoute.includes(wantedBairro)) ||
      routeText.includes(wantedRoute) ||
      wantedRoute.includes(routeText);
    const bairroMatches = !wantedBairro || route.bairros.some((bairro) => {
      const name = normalizarTexto(bairro.nome || "");
      return name.includes(wantedBairro) || wantedBairro.includes(name);
    });
    const gaiolaMatches = Boolean(detected.code) && normalizarTexto(route.gaiola) === normalizarTexto(detected.code);
    return gaiolaMatches && bairroMatches && routeMatches;
  }

  private toOcrRouteOption(route: RomaneioRankedRoute, rank: number, configuredBairro?: string): OcrRouteOption {
    const matchedBairro = configuredBairro
      ? route.bairros.find((item) => normalizarTexto(item.nome) === normalizarTexto(configuredBairro))
      : undefined;
    const bairro = matchedBairro || (configuredBairro ? { nome: configuredBairro, percentualNaRota: 0 } : undefined) || route.bairroMatch || route.bairros[0];
    return {
      id: `${route.rota}::${route.gaiola}::${route.plannedAt || ""}`,
      rank,
      rota: route.rota,
      gaiola: route.gaiola,
      bairro: bairro?.nome || "Bairro não informado",
      bairroPercentual: bairro?.percentualNaRota,
      cidade: route.cidade,
      distanciaKm: route.distanciaKm,
      pacotes: route.pacotes,
      paradas: route.paradas,
      passedFilters: route.passedFilters,
      reasons: route.reasons,
      score: route.score,
      romaneioMatch: true,
      observation: configuredBairro && !matchedBairro
        ? "Bairro lido na imagem; a gaiola existe no romaneio, mas o bairro não consta na composição dessa rota."
        : undefined
    };
  }

  private compareOcrRouteOptions(left: OcrRouteOption, right: OcrRouteOption) {
    if (left.passedFilters !== right.passedFilters) return left.passedFilters ? -1 : 1;
    if (left.romaneioMatch !== right.romaneioMatch) return left.romaneioMatch === false ? 1 : -1;
    const priority = this.romaneioStore?.getSettings().prioridade;
    if (priority === "menor_distancia") return left.distanciaKm - right.distanciaKm;
    if (priority === "menos_paradas") return left.paradas - right.paradas;
    if (priority === "menos_pacotes") return left.pacotes - right.pacotes;
    if (priority === "maior_concentracao_bairro") return (right.bairroPercentual || 0) - (left.bairroPercentual || 0);
    return (left.distanciaKm + left.paradas + left.pacotes) - (right.distanciaKm + right.paradas + right.pacotes);
  }

  private resetOcrRouteSelection() {
    this.ocrRouteSelection = { status: "idle", options: [] };
  }

  private cacheRomaneioDocumentCandidates(messages: any[], connectionId: number) {
    if (connectionId !== this.activeConnectionId) return;
    const activeGroup = this.getActiveMonitoringGroup();
    if (!activeGroup.jid) return;

    for (const msg of messages || []) {
      if (msg?.key?.remoteJid !== activeGroup.jid) continue;
      const document = this.getDocumentMessage(msg);
      if (!document) continue;

      const fileName = String(document.fileName || "").trim();
      if (!this.isRomaneioFileName(fileName)) continue;
      if (!this.isMessageFromToday(msg)) continue;

      const id = String(msg?.key?.id || `${fileName}-${msg?.messageTimestamp || Date.now()}`);
      const timestampMs = this.getMessageTimestampMs(msg);
      const periodo = this.getRomaneioPeriod(timestampMs);
      this.romaneioDocumentCandidates.set(id, {
        candidate: {
          id,
          fileName,
          timestamp: new Date(timestampMs).toISOString(),
          periodo,
          periodoLabel: periodo === "manha" ? "Manhã" : "Tarde",
          sender: String(msg?.key?.participant || msg?.pushName || ""),
          groupJid: activeGroup.jid
        },
        message: msg
      });
      void this.persistRomaneioCandidateAutomatically(id);
    }

    this.purgeOldRomaneioCandidates();
  }

  private async persistRomaneioCandidateAutomatically(candidateId: string) {
    if (!this.romaneioStore || !downloadMediaMessage || this.processingRomaneioCandidateIds.has(candidateId)) return;
    const item = this.romaneioDocumentCandidates.get(candidateId);
    if (!item) return;
    const candidateTimestamp = new Date(item.candidate.timestamp).getTime();
    if (candidateTimestamp < this.latestAutomaticRomaneioTimestamp) return;

    this.processingRomaneioCandidateIds.add(candidateId);
    try {
      const buffer = await downloadMediaMessage(
        item.message,
        "buffer",
        {},
        {
          logger: P({ level: "silent" }),
          reuploadRequest: this.sock?.updateMediaMessage
        }
      );
      if (candidateTimestamp < this.latestAutomaticRomaneioTimestamp) return;
      const snapshot = this.romaneioStore.saveUpload(item.candidate.fileName, buffer);
      this.latestAutomaticRomaneioTimestamp = candidateTimestamp;
      this.logger.success(`[ROMANEIO] Arquivo recebido, processado e salvo automaticamente (${item.candidate.periodoLabel}): ${item.candidate.fileName}. Rotas: ${snapshot.status.totalRoutes}.`);
      this.emitSnapshot();
    } catch (error) {
      this.logger.warning(`[ROMANEIO] Não consegui persistir automaticamente ${item.candidate.fileName}: ${this.getErrorMessage(error)}.`);
    } finally {
      this.processingRomaneioCandidateIds.delete(candidateId);
    }
  }

  private getDocumentMessage(msg: any) {
    const message = msg?.message || {};
    return message.documentMessage ||
      message.documentWithCaptionMessage?.message?.documentMessage ||
      message.viewOnceMessage?.message?.documentMessage ||
      message.viewOnceMessageV2?.message?.documentMessage ||
      undefined;
  }

  private isRomaneioFileName(fileName: string) {
    const normalized = normalizarTexto(fileName);
    return normalized.includes("romaneio") && /\.xlsx$/i.test(fileName);
  }

  private isMessageFromToday(msg: any) {
    const date = new Date(this.getMessageTimestampMs(msg));
    const now = new Date();
    return date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
  }

  private getMessageTimestampMs(msg: any) {
    const raw = msg?.messageTimestamp;
    const value = typeof raw === "number" ? raw : Number(raw?.low || raw || 0);
    return value > 10_000_000_000 ? value : value * 1000 || Date.now();
  }

  private getRomaneioPeriod(timestampMs: number): RomaneioCandidate["periodo"] {
    const hour = new Date(timestampMs).getHours();
    return hour >= 4 && hour < 9 ? "manha" : "tarde";
  }

  private purgeOldRomaneioCandidates() {
    const entries = Array.from(this.romaneioDocumentCandidates.entries())
      .filter(([, item]) => this.isMessageFromToday(item.message))
      .sort(([, a], [, b]) => new Date(b.candidate.timestamp).getTime() - new Date(a.candidate.timestamp).getTime())
      .slice(0, ROMANEIO_CANDIDATE_LIMIT);
    this.romaneioDocumentCandidates = new Map(entries);
  }

  private async handleReactions(messages: any[]) {
    const batch = messages || [];
    for (let index = 0; index < batch.length; index += 1) {
      if (this.criticalDispatchInProgress) {
        this.scheduleReactionProcessing(batch.slice(index));
        return;
      }

      const msg = batch[index];
      const reaction = msg?.message?.reactionMessage;
      const reactedMessageId = reaction?.key?.id;
      if (!reaction || !reactedMessageId) continue;

      const senderIdentifiers = await this.getReactionSenderIdentifiers(msg, reaction);
      const senderJid = senderIdentifiers[0] || "";
      const senderPhone = senderIdentifiers.find((identifier) => /^55\d{10,13}$/.test(identifier)) || senderIdentifiers[0] || "";
      const emoji = String(reaction.text || "");
      const action = emoji ? "add" : "remove";
      const timestampMs = Number(reaction.senderTimestampMs || msg.messageTimestamp || Date.now());
      const timestamp = new Date(timestampMs > 9999999999 ? timestampMs : timestampMs * 1000).toISOString();
      const routeReaction: RouteReaction = {
        id: `${reactedMessageId}:${senderJid}:${emoji}:${timestamp}`,
        timestamp,
        emoji,
        senderJid,
        senderPhone,
        senderIdentifiers,
        isAdmin: senderIdentifiers.some((identifier) => this.isAdminPhoneIdentifier(identifier)),
        leaderName: this.getLeaderNameFromIdentifiers(senderIdentifiers)
      };

      if (this.routeStore.recordReactionEvent(String(reactedMessageId), routeReaction, action)) {
        this.logger.info(
          action === "remove"
            ? `Reação removida ${routeReaction.isAdmin ? `pelo líder ${routeReaction.leaderName || senderPhone}` : `por ${senderPhone || "remetente desconhecido"}`}. Mantive o evento para auditoria.`
            : routeReaction.isAdmin
            ? `Reação do líder ${routeReaction.leaderName || senderPhone} foi encontrada. Aguardando validação manual do admin.`
            : `Reação recebida em rota enviada (${senderPhone || "remetente desconhecido"}). IDs: ${senderIdentifiers.join(" / ") || "nenhum"}`
        );
        if (action === "remove" && routeReaction.isAdmin) {
          this.routeStore.requireClientIncident(String(reactedMessageId), {
            kind: "leader_reaction_removed",
            message: `O líder ${routeReaction.leaderName || senderPhone || "identificado"} reagiu e removeu a reação. Explique se a rota foi válida ou não para liberar o bot.`
          });
          this.logger.warning("Bot bloqueado para o cliente até explicar a reação removida pelo líder.");
        }
        this.emitSnapshot();
      }
    }
  }

  private handleDeletedMessageNotice(msg: any) {
    const protocol = msg?.message?.protocolMessage;
    const deletedMessageId = String(protocol?.key?.id || protocol?.messageKey?.id || "");
    if (!protocol || !deletedMessageId) return;
    const type = String(protocol?.type ?? protocol?.protocolMessageType ?? "").toLowerCase();
    const looksLikeDelete = type === "0" || type.includes("revoke") || type.includes("delete");
    if (!looksLikeDelete) return;
    if (this.routeStore.recordDeletedMessage(deletedMessageId)) {
      this.routeStore.requireClientIncident(deletedMessageId, {
        kind: "message_deleted",
        message: "Uma mensagem enviada pelo bot foi apagada no WhatsApp. Explique o que aconteceu para liberar o bot."
      });
      this.logger.warning("Mensagem enviada pelo bot foi apagada. Bot bloqueado até o cliente explicar o ocorrido.");
      this.emitSnapshot();
    }
  }

  private async getReactionSenderIdentifiers(msg: any, reaction: any) {
    const candidates = [
      msg?.key?.participant,
      msg?.key?.participantPn,
      msg?.key?.participantLid,
      msg?.key?.senderPn,
      msg?.key?.remoteJid,
      msg?.participant,
      msg?.sender,
      msg?.author,
      reaction?.key?.participant,
      reaction?.key?.participantPn,
      reaction?.key?.participantLid,
      reaction?.senderJid,
      reaction?.participant,
      ...this.collectReactionIdentifierCandidates(msg),
      ...this.collectReactionIdentifierCandidates(reaction)
    ];

    const identifiers = new Set<string>();

    for (const item of candidates) {
      const raw = String(item || "");
      const normalized = this.normalizePhone(raw);
      if (normalized) identifiers.add(normalized);

      const phoneFromLid = await this.resolvePhoneFromLid(raw);
      if (phoneFromLid) identifiers.add(phoneFromLid);
    }

    const groupPhone = await this.getReactionPhoneFromGroupMetadata(msg, reaction);
    if (groupPhone) identifiers.add(groupPhone);

    return Array.from(identifiers);
  }

  private async getReactionPhoneFromGroupMetadata(msg: any, reaction: any) {
    const groupJid = String(msg?.key?.remoteJid || reaction?.key?.remoteJid || "");
    const participantIds = [
      msg?.key?.participant,
      msg?.key?.participantLid,
      reaction?.key?.participant,
      reaction?.key?.participantLid,
      reaction?.senderJid,
      reaction?.participant
    ]
      .map((item) => String(item || ""))
      .filter(Boolean);

    if (!groupJid.endsWith("@g.us") || !participantIds.length) return "";

    try {
      const metadata = this.groupMetadataCache.get(groupJid) || (await this.refreshGroupMetadata(groupJid));
      const participants = Array.isArray(metadata?.participants) ? metadata.participants : [];

      for (const participant of participants) {
        const knownIds = [
          participant?.id,
          participant?.jid,
          participant?.lid,
          participant?.lidJid,
          participant?.phoneNumber,
          participant?.phone_number,
          participant?.pn
        ]
          .map((item) => String(item || ""))
          .filter(Boolean);

        const matches = participantIds.some((incomingId) => {
          const incomingPhone = this.normalizePhone(incomingId);
          return knownIds.some((knownId) => {
            const knownPhone = this.normalizePhone(knownId);
            return knownId === incomingId || Boolean(incomingPhone && knownPhone && incomingPhone === knownPhone);
          });
        });

        if (!matches) continue;

        const phone = [
          participant?.phoneNumber,
          participant?.phone_number,
          participant?.pn,
          participant?.jid,
          participant?.id
        ]
          .map((item) => this.normalizePhone(String(item || "")))
          .find((item) => item.startsWith("55") && item.length >= 12);

        if (phone) return phone;
      }
    } catch (error) {
      this.logger.warning(`Não consegui resolver telefone da reação pelo grupo: ${this.getErrorMessage(error)}`);
    }

    return "";
  }

  private async resolvePhoneFromLid(value: string) {
    if (!value || !value.includes("@lid")) return "";

    const lidJid = value.includes("@") ? value : `${this.normalizePhone(value)}@lid`;

    try {
      const mappedPhone = await this.sock?.signalRepository?.lidMapping?.getPNForLID?.(lidJid);
      return this.normalizePhoneFromUnknown(mappedPhone);
    } catch (error) {
      this.logger.warning(`Não consegui traduzir ID interno do WhatsApp para telefone: ${this.getErrorMessage(error)}`);
      return "";
    }
  }

  private collectReactionIdentifierCandidates(input: unknown, depth = 0): string[] {
    if (!input || depth > 3) return [];
    if (typeof input === "string") {
      const phone = this.normalizePhone(input);
      return input.includes("@") || phone.length >= 10 ? [input] : [];
    }
    if (typeof input !== "object") return [];

    const values: string[] = [];
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      if (/timestamp|ephemeral|messageStub/i.test(key)) continue;
      if (typeof value === "string") {
        const phone = this.normalizePhone(value);
        if (value.includes("@") || phone.length >= 10) values.push(value);
      } else if (value && typeof value === "object") {
        values.push(...this.collectReactionIdentifierCandidates(value, depth + 1));
      }
    }
    return values;
  }

  private isAdminPhoneIdentifier(value: string) {
    const phone = this.normalizePhone(value);
    if (!phone) return false;
    return Array.from(this.adminPhoneNumbers).some((adminPhone) => this.samePhone(phone, adminPhone));
  }

  private getLeaderNameFromIdentifiers(values: string[]) {
    for (const value of values) {
      const phone = this.normalizePhone(value);
      for (const [leaderPhone, leaderName] of this.leaderContacts.entries()) {
        if (this.samePhone(phone, leaderPhone)) return leaderName;
      }
    }
    return undefined;
  }

  private samePhone(left: string, right: string) {
    const a = this.normalizePhone(left);
    const b = this.normalizePhone(right);
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.startsWith("55") && a.slice(2) === b) return true;
    if (b.startsWith("55") && b.slice(2) === a) return true;
    const aTail = a.slice(-11);
    const bTail = b.slice(-11);
    return aTail.length >= 10 && bTail.length >= 10 && aTail === bTail;
  }

  private enviarMensagensRapidas(cycleId: number, trigger: RouteDispatch["trigger"] = this.monitoringMode === "test" ? "warmup" : "automatic", eventDetectedAt = Date.now()) {
    if (!this.preparedTargetJid || !this.preparedMessages.length) {
      this.prepareSendPlan();
    }

    if (!this.monitoringEnabled && trigger === "automatic") {
      this.logger.warning("Abertura ignorada: o bot está parado no painel do cliente.");
      return;
    }

    if (!this.preparedTargetJid) {
      this.logger.error("Grupo alvo ainda não foi configurado.");
      return;
    }

    if (!this.preparedMessages.length) {
      this.logger.error("Nenhuma mensagem está pronta.");
      return;
    }

    let mensagens = [...this.preparedMessages];

    if (this.monitoringMode === "target" && mensagens.length > MAX_OUTGOING_MESSAGES) {
      mensagens = mensagens.slice(0, MAX_OUTGOING_MESSAGES);
      this.logger.warning(
        `Limite máximo de ${MAX_OUTGOING_MESSAGES} mensagens ativo. Enviando apenas as duas primeiras.`
      );
    }

    if (this.activeSendCycle) {
      this.logger.warning("Já existe um disparo em andamento. Mantendo apenas o ciclo mais novo.");
    }

    const config = this.configStore.load();
    this.ensurePreparedRelayMessages(this.preparedTargetJid, mensagens);
    const sendStartedAt = Date.now();
    const timeline = this.createDispatchTimeline(
      eventDetectedAt,
      sendStartedAt,
      this.monitoringMode === "target" ? "race" : "normal"
    );
    this.performanceMetrics.activeQueue = mensagens.length;
    this.criticalDispatchInProgress = true;
    // Inicia o relay antes das gravações de auditoria. A primeira chamada ao
    // WhatsApp ocorre imediatamente; fila e histórico são persistidos ainda
    // neste mesmo ciclo, antes da Promise do relay concluir.
    const sendCycle =
      this.monitoringMode === "test"
        ? this.sendFastSequence(this.preparedTargetJid, mensagens, cycleId, eventDetectedAt, sendStartedAt, trigger)
        : config.nuclearMode
        ? this.sendNuclearTargetSequence(this.preparedTargetJid, mensagens, cycleId, eventDetectedAt, sendStartedAt, trigger, timeline)
        : this.sendAggressiveTargetSequence(this.preparedTargetJid, mensagens, cycleId, eventDetectedAt, sendStartedAt, trigger, timeline);
    this.enqueueDispatch(cycleId, this.preparedTargetJid, mensagens, trigger);
    const routeId = this.registerRouteDispatch(cycleId, this.preparedTargetJid, mensagens, trigger, timeline);
    this.markQueuedDispatchSending(cycleId, routeId);

    this.activeSendCycle = sendCycle.finally(() => {
      if (cycleId === this.sendCycleId) {
        this.activeSendCycle = undefined;
        this.criticalDispatchInProgress = false;
      }
    });

    this.logger.info(
      `${this.monitoringMode === "test" ? "Aquecimento real do teste" : config.nuclearMode ? "Modo nuclear máximo" : "Modo instantâneo agressivo"}: ${mensagens.length} mensagens preparadas: ${mensagens.join(" | ")}`
    );
  }

  private ensurePreparedRelayMessages(jid: string, mensagens: string[]) {
    if (!this.sock || !jid) return;
    const signature = this.getRelaySignature(jid, mensagens);
    if (
      this.preparedRelaySignature === signature &&
      this.preparedRelayMessages.length === mensagens.length &&
      !this.isPreparedRelayStale()
    ) {
      return;
    }
    this.rebuildPreparedRelayMessages(jid, mensagens);
  }

  private rebuildPreparedRelayMessages(jid: string, mensagens: string[]) {
    if (!this.sock || !jid) {
      this.preparedRelayMessages = [];
      this.preparedRelaySignature = "";
      this.preparedRelayBuiltAt = 0;
      return;
    }
    this.preparedRelayMessages = mensagens.map((mensagem) => this.buildRelayTextMessage(this.sock, jid, mensagem));
    this.preparedRelaySignature = this.getRelaySignature(jid, mensagens);
    this.preparedRelayBuiltAt = Date.now();
  }

  private getRelaySignature(jid: string, mensagens: string[]) {
    return `${jid}::${mensagens.join("\u001f")}`;
  }

  private isPreparedRelayStale() {
    return !this.preparedRelayBuiltAt || Date.now() - this.preparedRelayBuiltAt >= this.getPreparedRelayTtlMs();
  }

  private getPreparedRelayTtlMs() {
    return this.isCriticalWarmWindow() ? CRITICAL_PREPARED_RELAY_TTL_MS : PREPARED_RELAY_TTL_MS;
  }

  private registerRouteDispatch(
    cycleId: number,
    jid: string,
    mensagens: string[],
    trigger: RouteDispatch["trigger"] = this.monitoringMode === "test" ? "warmup" : "automatic",
    dispatchTimeline?: RouteDispatchTimeline
  ) {
    const config = this.configStore.load();
    const sentMessageIds = this.preparedRelayMessages.map((item) => String(item?.key?.id || "")).filter(Boolean);
    const route = this.routeStore.create({
      id: `${Date.now()}-${cycleId}`,
      clientEmail: this.clientEmail,
      groupJid: jid,
      groupName: this.monitoringMode === "test" ? config.grupoTesteNome || jid : config.grupoAlvoNome || jid,
      mode: this.monitoringMode,
      trigger,
      messages: mensagens,
      sentMessageIds,
      confirmedCount: 0,
      totalCount: mensagens.length,
      status: "sending",
      dispatchTimeline,
      ocr: this.monitoringMode === "target" && config.targetDispatchMode === "ocr" ? this.lastOcrInsight : undefined
    });
    this.activeRouteByCycle.set(cycleId, route.id);
    this.routeMessageIdsByCycle.set(cycleId, sentMessageIds);
    return route.id;
  }

  private updateRouteDispatch(cycleId: number, confirmedCount: number, totalCount: number, dispatchTimeline?: RouteDispatchTimeline, finalizeQueue = false) {
    const routeId = this.activeRouteByCycle.get(cycleId);
    if (!routeId) return;
    const patch: Parameters<RouteStore["update"]>[1] = {
      confirmedCount,
      status: confirmedCount === totalCount ? "sent" : confirmedCount > 0 ? "partial" : "failed"
    };
    const sentMessageIds = this.routeMessageIdsByCycle.get(cycleId);
    if (sentMessageIds?.length) patch.sentMessageIds = sentMessageIds;
    if (dispatchTimeline) patch.dispatchTimeline = dispatchTimeline;
    this.routeStore.update(routeId, patch);
    if (finalizeQueue) this.markQueuedDispatchFinished(cycleId, confirmedCount, totalCount);
    this.emitSnapshot();
  }

  private appendRouteMessageId(cycleId: number, messageId?: string) {
    if (!messageId) return;
    const current = this.routeMessageIdsByCycle.get(cycleId) || [];
    if (current.includes(messageId)) return;
    const next = [...current, messageId];
    this.routeMessageIdsByCycle.set(cycleId, next);
    const routeId = this.activeRouteByCycle.get(cycleId);
    if (routeId) {
      this.routeStore.update(routeId, { sentMessageIds: next });
    }
  }

  private async sendFastSequence(jid: string, mensagens: string[], cycleId: number, eventDetectedAt = Date.now(), sendStartedAt = Date.now(), trigger: RouteDispatch["trigger"] = "warmup") {
    try {
      const sock = this.sock;
      if (!sock) {
        this.logger.error("Não há conexão ativa no momento do disparo.");
        this.updateRouteDispatch(cycleId, 0, mensagens.length, undefined, true);
        this.recordDispatchMetrics({ eventDetectedAt, sendStartedAt, sendFinishedAt: Date.now(), confirmed: 0, total: mensagens.length, trigger, mode: this.monitoringMode });
        return;
      }

      if (mensagens.length === 1) {
        const sent = await this.sendSingleInstant(sock, jid, mensagens[0], cycleId);
        if (sent) {
          this.logger.success("Disparo concluído: 1/1 mensagem confirmada.");
        } else {
          this.logger.warning("Disparo terminou com atenção: 0/1 mensagem confirmada.");
        }
        this.updateRouteDispatch(cycleId, sent ? 1 : 0, 1, undefined, true);
        this.recordDispatchMetrics({ eventDetectedAt, sendStartedAt, sendFinishedAt: Date.now(), confirmed: sent ? 1 : 0, total: 1, trigger, mode: this.monitoringMode });
        return;
      }

      let confirmed = 0;

      for (const [index, mensagem] of mensagens.entries()) {
        const messageNumber = index + 1;
        if (cycleId !== this.sendCycleId || (!this.monitoringEnabled && trigger === "automatic")) break;

        try {
          await this.relayPreparedTextMessage(sock, jid, mensagem, index);
          this.logger.success(`Mensagem ${messageNumber} confirmada: ${mensagem}`);
          confirmed += 1;
        } catch (error) {
          const message = this.getErrorMessage(error);
          this.logger.warning(`Mensagem ${messageNumber} falhou no tiro instantâneo (${message}). Retentando...`);

          if (!this.isRetryableSendError(message)) {
            this.logger.error(`Erro ao enviar mensagem ${messageNumber}: ${message}`);
            break;
          }

          const retried = await this.sendMessageWithRetry(jid, mensagem, messageNumber, cycleId, true);
          if (!retried) {
            break;
          }

          confirmed += 1;
        }

        if (messageNumber === 1 && confirmed === 1 && mensagens.length > 1) {
          this.logger.info("Mensagem 1 confirmada. Enviando mensagem 2 imediatamente.");
        }
      }

      if (confirmed === mensagens.length) {
        this.logger.success(`Disparo concluído: ${confirmed}/${mensagens.length} mensagens confirmadas.`);
      } else {
        this.logger.warning(`Disparo terminou com atenção: ${confirmed}/${mensagens.length} mensagens confirmadas.`);
      }
      this.updateRouteDispatch(cycleId, confirmed, mensagens.length, undefined, true);
      this.recordDispatchMetrics({ eventDetectedAt, sendStartedAt, sendFinishedAt: Date.now(), confirmed, total: mensagens.length, trigger, mode: this.monitoringMode });
    } catch (error) {
      this.logger.error(`Erro inesperado no disparo turbo: ${this.getErrorMessage(error)}`);
      this.updateRouteDispatch(cycleId, 0, mensagens.length, undefined, true);
      this.recordDispatchMetrics({ eventDetectedAt, sendStartedAt, sendFinishedAt: Date.now(), confirmed: 0, total: mensagens.length, trigger, mode: this.monitoringMode });
    }
  }

  private async sendNuclearTargetSequence(
    jid: string,
    mensagens: string[],
    cycleId: number,
    eventDetectedAt = Date.now(),
    sendStartedAt = Date.now(),
    trigger: RouteDispatch["trigger"] = "automatic",
    timeline = this.createDispatchTimeline(eventDetectedAt, sendStartedAt, "race")
  ) {
    this.logger.info("☢️ Modo nuclear máximo: rajada paralela imediata após evento de abertura.");
    await this.sendAggressiveTargetSequence(jid, mensagens, cycleId, eventDetectedAt, sendStartedAt, trigger, timeline);
  }

  private async sendAggressiveTargetSequence(
    jid: string,
    mensagens: string[],
    cycleId: number,
    eventDetectedAt = Date.now(),
    sendStartedAt = Date.now(),
    trigger: RouteDispatch["trigger"] = "automatic",
    timeline = this.createDispatchTimeline(eventDetectedAt, sendStartedAt, "race")
  ) {
    try {
      const sock = this.sock;
      if (!sock) {
        this.logger.error("Não há conexão ativa no momento do disparo.");
        this.updateRouteDispatch(cycleId, 0, mensagens.length, timeline, true);
        this.recordDispatchMetrics({ eventDetectedAt, sendStartedAt, sendFinishedAt: Date.now(), confirmed: 0, total: mensagens.length, timeline, trigger, mode: this.monitoringMode });
        this.stopMonitoringAfterTargetDispatch(cycleId);
        return;
      }

      if (trigger === "automatic" && this.monitoringMode === "target" && this.adaptiveOpeningSettleMs > 0) {
        this.addTimelineEvent(timeline, "Micro-espera adaptativa", Date.now(), "info", `${this.adaptiveOpeningSettleMs}ms`);
        await this.delay(this.adaptiveOpeningSettleMs);
      }

      const relayMessages = this.preparedRelayMessages && this.preparedRelayMessages.length
        ? this.preparedRelayMessages
        : mensagens.map((m) => this.buildRelayTextMessage(sock, jid, m));

      const jobs = relayMessages.map((fullMessage, index) => {
        const messageNumber = index + 1;

        const firstAttempt = (async () => {
          if (cycleId !== this.sendCycleId || (trigger === "automatic" && !this.monitoringEnabled)) {
            throw new Error("Ciclo cancelado pelo painel ou por nova abertura.");
          }
          const baseStaggerMs = trigger === "manual" ? MANUAL_ROUTE_SELECTION_STAGGER_MS : TARGET_PARALLEL_STAGGER_MS;
          const staggerMs = index === 0 ? 0 : baseStaggerMs * index;
          if (staggerMs > 0) await this.delay(staggerMs);
          const calledAt = Date.now();
          if (!timeline.firstRelayCalledAt) {
            timeline.firstRelayCalledAt = new Date(calledAt).toISOString();
            timeline.firstRelayCallMs = Math.max(0, calledAt - sendStartedAt);
          }
          this.addTimelineEvent(timeline, `Relay ${messageNumber} chamado`, calledAt, "info", String(fullMessage?.key?.id || ""));
          await this.relayPreparedMessage(sock, jid, fullMessage);
          return String(fullMessage?.key?.id || "");
        })();

        const finalPromise = firstAttempt.catch((error) =>
          this.retryTargetMessageAfterFailure(jid, mensagens[index], messageNumber, cycleId, error, timeline)
        );

        const initialPromise = this.withTimeout(firstAttempt, TARGET_ACK_TIMEOUT_MS).then(
          () => ({ status: "acked" as const, messageNumber }),
          (error) => {
            const message = this.getErrorMessage(error);
            if (message === "ack-timeout") {
              timeline.timeoutUsed = true;
              this.addTimelineEvent(timeline, `ACK ${messageNumber} pendente`, Date.now(), "warning", `${TARGET_ACK_TIMEOUT_MS}ms sem confirmação`);
              return { status: "timeout" as const, messageNumber };
            }
            this.addTimelineEvent(timeline, `Falha rápida ${messageNumber}`, Date.now(), "warning", message);
            return { status: "failed" as const, messageNumber, error };
          }
        );

        return { initialPromise, finalPromise };
      });

      const initialResults = await Promise.all(jobs.map((job) => job.initialPromise));
      const quickConfirmed = initialResults.filter((result) => result.status === "acked").length;
      const pendingAck = initialResults.filter((result) => result.status === "timeout").length;
      const quickFailed = initialResults.filter((result) => result.status === "failed").length;

      this.logger.info(
        `Modo corrida: chamadas feitas em ${Date.now() - sendStartedAt}ms. ACK rápido ${quickConfirmed}/${mensagens.length}, pendente ${pendingAck}, falha rápida ${quickFailed}.`
      );
      this.performanceMetrics.activeQueue = pendingAck + quickFailed;
      this.addTimelineEvent(timeline, "Chamadas finalizadas", Date.now(), pendingAck ? "warning" : "success", `${quickConfirmed}/${mensagens.length} ACK rápido`);
      this.updateRouteDispatch(cycleId, quickConfirmed, mensagens.length, timeline);
      this.emitSnapshot();
      this.addStatusEvent("dispatch", `${triggerLabelForEvent(trigger)} chamado: ${quickConfirmed}/${mensagens.length} ACK rápido, ${pendingAck} pendente.`);
      this.stopMonitoringAfterTargetDispatch(cycleId);

      void this.finishTargetDispatchInBackground({
        jobs: jobs.map((job) => job.finalPromise),
        cycleId,
        total: mensagens.length,
        eventDetectedAt,
        sendStartedAt,
        trigger,
        timeline
      });
    } catch (error) {
      this.logger.error(`Erro inesperado no disparo agressivo: ${this.getErrorMessage(error)}`);
      this.addTimelineEvent(timeline, "Erro inesperado", Date.now(), "error", this.getErrorMessage(error));
      this.updateRouteDispatch(cycleId, 0, mensagens.length, timeline, true);
      this.updateAdaptiveOpeningSettle(timeline);
      this.recordDispatchMetrics({ eventDetectedAt, sendStartedAt, sendFinishedAt: Date.now(), confirmed: 0, total: mensagens.length, timeline, trigger, mode: this.monitoringMode });
      this.stopMonitoringAfterTargetDispatch(cycleId);
    }
  }

  private async finishTargetDispatchInBackground(input: {
    jobs: Promise<string | false>[];
    cycleId: number;
    total: number;
    eventDetectedAt: number;
    sendStartedAt: number;
    trigger: RouteDispatch["trigger"];
    timeline: RouteDispatchTimeline;
  }) {
    const results = await Promise.allSettled(input.jobs);
    let confirmed = 0;
    results.forEach((result, index) => {
      const messageNumber = index + 1;
      if (result.status === "fulfilled" && result.value) {
        confirmed += 1;
        const ackAt = Date.now();
        if (!input.timeline.firstAckAt) {
          input.timeline.firstAckAt = new Date(ackAt).toISOString();
          input.timeline.firstAckMs = Math.max(0, ackAt - input.sendStartedAt);
          input.timeline.ackWaitMs = Math.max(0, ackAt - new Date(input.timeline.firstRelayCalledAt || input.timeline.sendStartedAt).getTime());
        }
        this.appendRouteMessageId(input.cycleId, typeof result.value === "string" ? result.value : undefined);
        this.addTimelineEvent(input.timeline, `Mensagem ${messageNumber} confirmada`, ackAt, "success");
        this.logger.success(`Mensagem alvo ${messageNumber} confirmada pelo WhatsApp.`);
        return;
      }

      const message = result.status === "rejected" ? this.getErrorMessage(result.reason) : "Não confirmou após retry.";
      this.addTimelineEvent(input.timeline, `Mensagem ${messageNumber} falhou`, Date.now(), "error", message);
      this.logger.warning(`Mensagem alvo ${messageNumber} não confirmou no modo corrida: ${message}`);
    });

    const finishedAt = Date.now();
    input.timeline.finishedAt = new Date(finishedAt).toISOString();
    input.timeline.totalDurationMs = Math.max(0, finishedAt - input.sendStartedAt);

    if (confirmed === input.total) {
      this.logger.success(`Disparo modo corrida confirmado em ${input.timeline.totalDurationMs}ms: ${confirmed}/${input.total}.`);
    } else {
      this.logger.warning(`Disparo modo corrida terminou com atenção em ${input.timeline.totalDurationMs}ms: ${confirmed}/${input.total}.`);
    }

    this.updateRouteDispatch(input.cycleId, confirmed, input.total, input.timeline, true);
    this.updateAdaptiveOpeningSettle(input.timeline);
    this.recordDispatchMetrics({
      eventDetectedAt: input.eventDetectedAt,
      sendStartedAt: input.sendStartedAt,
      sendFinishedAt: finishedAt,
      confirmed,
      total: input.total,
      timeline: input.timeline,
      trigger: input.trigger,
      mode: this.monitoringMode
    });
    this.addStatusEvent("dispatch", `${triggerLabelForEvent(input.trigger)} confirmado: ${confirmed}/${input.total}.`);
    this.activeRouteByCycle.delete(input.cycleId);
    this.routeMessageIdsByCycle.delete(input.cycleId);
  }

  private async retryTargetMessageAfterFailure(
    jid: string,
    mensagem: string,
    messageNumber: number,
    cycleId: number,
    error: unknown,
    timeline: RouteDispatchTimeline
  ): Promise<string | false> {
    const firstMessage = this.getErrorMessage(error);
    if (!this.isRetryableSendError(firstMessage)) throw error;

    timeline.retryUsed = true;
    const firstNotAcceptable = this.isNotAcceptableError(firstMessage);
    if (firstNotAcceptable) {
      timeline.notAcceptableCount += 1;
      this.scheduleNotAcceptableDiagnosis(jid, cycleId);
    }

    const delays = firstNotAcceptable ? NOT_ACCEPTABLE_RETRY_DELAYS_MS : GENERIC_RETRY_DELAYS_MS;
    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (cycleId !== this.sendCycleId) return false;
      await this.delay(delays[attempt]);
      try {
        this.addTimelineEvent(timeline, `Retry ${messageNumber}.${attempt + 1}`, Date.now(), "info", firstMessage);
        if (!this.sock) throw new Error("Não há conexão ativa para retry.");
        const sent = await this.relayTextMessage(this.sock, jid, mensagem);
        const messageId = String(sent?.key?.id || "");
        this.appendRouteMessageId(cycleId, messageId);
        return messageId || false;
      } catch (nextError) {
        const nextMessage = this.getErrorMessage(nextError);
        if (this.isNotAcceptableError(nextMessage)) {
          timeline.notAcceptableCount += 1;
          this.scheduleNotAcceptableDiagnosis(jid, cycleId);
        }
        if (!this.isRetryableSendError(nextMessage) || attempt === delays.length - 1) {
          throw nextError;
        }
      }
    }

    return false;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ack-timeout")), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  private stopMonitoringAfterTargetDispatch(cycleId: number) {
    if (this.targetSimulationCycles.has(cycleId)) return;
    if (this.monitoringMode !== "target") return;
    if (!this.monitoringEnabled) return;

    this.monitoringEnabled = false;
    this.armedAt = undefined;
    this.clearHealthCheckTimer();
    this.clearWarmKeepAliveTimer();
    this.logger.warning("Disparo no grupo alvo finalizado. Bot parado automaticamente para evitar mensagens duplicadas.");
    this.emitSnapshot();
  }

  private async sendSingleInstant(sock: any, jid: string, mensagem: string, cycleId: number) {
    if (cycleId !== this.sendCycleId) return false;

    try {
      await this.relayPreparedTextMessage(sock, jid, mensagem, 0);
      this.logger.success(`Mensagem 1 confirmada: ${mensagem}`);
      return true;
    } catch (error) {
      const message = this.getErrorMessage(error);
      this.logger.warning(`Mensagem 1 falhou no tiro instantâneo (${message}). Retentando...`);

      if (!this.isRetryableSendError(message)) {
        this.logger.error(`Erro ao enviar mensagem 1: ${message}`);
        return false;
      }

      return this.sendMessageWithRetry(jid, mensagem, 1, cycleId, true);
    }
  }

  private async sendBurstMessage(
    jid: string,
    mensagem: string,
    messageNumber: number,
    cycleId: number,
    initialDelay: number
  ) {
    if (initialDelay > 0) {
      await this.delay(initialDelay);
    }

    if (cycleId !== this.sendCycleId) return false;

    const sent = await this.sendMessageWithRetry(jid, mensagem, messageNumber, cycleId);
    if (!sent) {
      this.logger.warning(
        `Mensagem ${messageNumber} não confirmou mesmo na rajada instantânea.`
      );
    }

    return sent;
  }

  private async relayTextMessage(sock: any, jid: string, mensagem: string) {
    const fullMessage = this.buildRelayTextMessage(sock, jid, mensagem);
    await this.relayPreparedMessage(sock, jid, fullMessage);
    return fullMessage;
  }

  private async relayPreparedTextMessage(sock: any, jid: string, mensagem: string, index: number) {
    const fullMessage = this.preparedRelayMessages[index] || this.buildRelayTextMessage(sock, jid, mensagem);
    await this.relayPreparedMessage(sock, jid, fullMessage);
    return fullMessage;
  }

  private buildRelayTextMessage(sock: any, jid: string, mensagem: string) {
    const messageId = generateMessageIDV2(sock.user?.id);
    return generateWAMessageFromContent(
      jid,
      { conversation: mensagem },
      {
        userJid: sock.user?.id,
        messageId,
        timestamp: new Date()
      }
    );
  }

  private async relayPreparedMessage(sock: any, jid: string, fullMessage: any) {
    await sock.relayMessage(jid, fullMessage.message, {
      messageId: fullMessage.key.id,
      useUserDevicesCache: true,
      useCachedGroupMetadata: true
    });
  }

  private montarMensagens() {
    const { nomeEnvio, codigosMensagensAlvo, codigosMensagensTeste } = this.configStore.load();
    this.mensagensProntasAlvo = (codigosMensagensAlvo || [])
      .map((codigo) => `${nomeEnvio} ${codigo}`)
      .filter(Boolean);
    this.mensagensProntasTeste = (codigosMensagensTeste || [])
      .map((codigo) => `${nomeEnvio} ${codigo}`)
      .filter(Boolean);
  }

  private syncMessagesFromConfig() {
    // reload messages from config for both alvo and teste
    this.montarMensagens();
  }

  private prepareSendPlan() {
    const config = this.configStore.load();
    this.syncMessagesFromConfig();
    const activeGroup = this.getActiveMonitoringGroup(config);

    this.preparedTargetJid = activeGroup.jid;
    this.preparedMessages = this.monitoringMode === "test"
      ? this.buildWarmupMessages()
      : config.targetDispatchMode === "ocr"
      ? this.pendingOcrMessages.length
      ? [...this.pendingOcrMessages]
      : []
      : [...this.mensagensProntasAlvo];

    if (this.monitoringMode === "target" && this.preparedMessages.length > MAX_OUTGOING_MESSAGES) {
      this.preparedMessages = this.preparedMessages.slice(0, MAX_OUTGOING_MESSAGES);
      this.logger.warning(
        `Limite máximo de ${MAX_OUTGOING_MESSAGES} mensagens ativo. As duas primeiras mensagens serão preparadas para envio.`
      );
    }

    if (this.sock && this.preparedTargetJid) {
      this.ensurePreparedRelayMessages(this.preparedTargetJid, this.preparedMessages);
    } else {
      this.preparedRelayMessages = [];
      this.preparedRelaySignature = "";
      this.preparedRelayBuiltAt = 0;
    }

    return Boolean(
      this.preparedTargetJid &&
      (this.preparedMessages.length || (this.monitoringMode === "target" && config.targetDispatchMode === "ocr"))
    );
  }

  private resetWarmupState() {
    this.warmupMessagesSent = 0;
    this.warmupCompleted = false;
    this.emitSnapshot();
  }

  private async sendMessageWithRetry(
    jid: string,
    mensagem: string,
    messageNumber: number,
    cycleId: number,
    skipInstantAttempt = false
  ) {
    const config = this.configStore.load();
    const minDelay = Math.max(0, config.minSendDelayMs || 0);
    let delays = [minDelay, 10, 20, 35, 55, 85, 130, 210, 320]
      .filter((delay, index, items) => delay > 0 || index === 0)
      .filter((delay, index, items) => items.indexOf(delay) === index);

    for (let attempt = skipInstantAttempt ? 1 : 0; attempt <= delays.length; attempt += 1) {
      if (cycleId !== this.sendCycleId) {
        this.logger.warning(`Mensagem ${messageNumber} cancelada porque começou outro ciclo de abertura.`);
        return false;
      }

      if (attempt > 0) {
        await this.delay(delays[attempt - 1]);
      }

      if (cycleId !== this.sendCycleId) {
        this.logger.warning(`Mensagem ${messageNumber} cancelada porque começou outro ciclo de abertura.`);
        return false;
      }

      try {
        if (attempt > 0) {
          this.logger.info(`Tentando novamente mensagem ${messageNumber} (${attempt + 1}/${delays.length + 1}).`);
        }

        await this.relayTextMessage(this.sock, jid, mensagem);
        this.logger.success(`Mensagem ${messageNumber} confirmada: ${mensagem}`);
        return true;
      } catch (error) {
        const message = this.getErrorMessage(error);

        if (!this.isRetryableSendError(message) || attempt === delays.length) {
          this.logger.error(`Erro ao enviar mensagem ${messageNumber}: ${message}`);
          if (this.isNotAcceptableError(message)) {
            this.scheduleNotAcceptableDiagnosis(jid, cycleId);
          }
          return false;
        }

        this.logger.warning(`WhatsApp ainda não aceitou mensagem ${messageNumber} (${message}). Retentando...`);
        if (this.isNotAcceptableError(message)) {
          delays = NOT_ACCEPTABLE_RETRY_DELAYS_MS;
          this.scheduleNotAcceptableDiagnosis(jid, cycleId);
        }
      }
    }

    return false;
  }

  private isRetryableSendError(errorMessage: string) {
    const normalizedMessage = errorMessage.toLowerCase();
    return (
      normalizedMessage.includes("not-acceptable") ||
      normalizedMessage.includes("timed out") ||
      normalizedMessage.includes("timeout") ||
      normalizedMessage.includes("temporarily")
    );
  }

  private isNotAcceptableError(errorMessage: string) {
    return errorMessage.toLowerCase().includes("not-acceptable");
  }

  private scheduleNotAcceptableDiagnosis(jid: string, cycleId: number) {
    if (this.diagnosedNotAcceptableCycles.has(cycleId)) return;
    setTimeout(() => {
      void this.diagnoseNotAcceptable(jid, cycleId);
    }, 2500);
  }

  private updateAdaptiveOpeningSettle(timeline?: RouteDispatchTimeline) {
    if (!timeline || this.monitoringMode !== "target") return;
    if (timeline.notAcceptableCount >= 2) {
      this.adaptiveOpeningSettleMs = Math.min(60, this.adaptiveOpeningSettleMs + 15);
      return;
    }
    if (timeline.notAcceptableCount === 0 && this.adaptiveOpeningSettleMs > 0) {
      this.adaptiveOpeningSettleMs = Math.max(0, this.adaptiveOpeningSettleMs - 15);
    }
  }

  private maybeAlertNotAcceptable(count: number) {
    if (count < NOT_ACCEPTABLE_ALERT_THRESHOLD) return;
    const now = Date.now();
    if (now - this.lastNotAcceptableAlertAt < 1000 * 60 * 5) return;
    this.lastNotAcceptableAlertAt = now;
    this.logger.warning(
      `Alerta de velocidade: WhatsApp recusou envio ${count} vez(es) como not-acceptable neste disparo. O bot ativou retry/adaptação automática.`
    );
    this.addStatusEvent("error", `not-acceptable alto: ${count} tentativa(s) recusadas pelo WhatsApp.`);
  }

  private startHealthCheck() {
    this.clearHealthCheckTimer();
    this.healthCheckTimer = setInterval(() => {
      void this.runHealthCheck();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  private startWarmKeepAlive() {
    this.clearWarmKeepAliveTimer();
    const config = this.configStore.load();
    if (!config.alwaysWarmMode) return;

    const intervalMs = this.getWarmKeepAliveIntervalMs(config);
    this.warmKeepAliveIntervalMs = intervalMs;
    this.warmKeepAliveTimer = setInterval(() => {
      void this.runWarmKeepAlive("timer");
    }, intervalMs);

    void this.runWarmKeepAlive("armado");
  }

  private async runWarmKeepAlive(reason: "timer" | "armado" = "timer") {
    const config = this.configStore.load();
    if (!config.alwaysWarmMode || !this.monitoringEnabled || this.status !== "connected" || !this.sock) return false;
    if (this.criticalDispatchInProgress || this.activeSendCycle) return false;
    const nextInterval = this.getWarmKeepAliveIntervalMs(config);
    if (this.warmKeepAliveIntervalMs && nextInterval !== this.warmKeepAliveIntervalMs) {
      this.startWarmKeepAlive();
      return true;
    }

    const startedAt = Date.now();
    try {
      const activeGroup = this.getActiveMonitoringGroup(config);
      if (!activeGroup.jid) return false;

      await this.prewarmActiveChat(activeGroup.jid);
      const shouldRefreshFullMetadata =
        reason === "armado" ||
        !this.groupMetadataCache.has(activeGroup.jid) ||
        Date.now() - this.lastFullMetadataWarmAt >= FULL_METADATA_KEEP_ALIVE_INTERVAL_MS;

      if (shouldRefreshFullMetadata) {
        await this.refreshGroupMetadata(activeGroup.jid);
        this.lastFullMetadataWarmAt = Date.now();
      }
      this.prepareSendPlan();
      this.lastKeepAliveAt = new Date().toISOString();
      this.lastKeepAliveDurationMs = Date.now() - startedAt;
      this.keepAliveCount += 1;
      if (reason === "timer") {
        this.logger.info(`Modo sempre quente: cache do ${activeGroup.label} renovado em ${this.lastKeepAliveDurationMs}ms.`);
      }
      this.emitSnapshot();
      return true;
    } catch (error) {
      this.lastKeepAliveDurationMs = Date.now() - startedAt;
      this.logger.warning(`Modo sempre quente falhou: ${this.getErrorMessage(error)}`);
      return false;
    }
  }

  private getWarmKeepAliveIntervalMs(config = this.configStore.load()) {
    const configuredInterval = Math.max(15000, config.keepAliveIntervalMs || DEFAULT_KEEP_ALIVE_INTERVAL_MS);
    if (this.monitoringMode !== "target") return Math.max(60000, configuredInterval);
    return Math.min(configuredInterval, this.isCriticalWarmWindow() ? CRITICAL_KEEP_ALIVE_INTERVAL_MS : RACE_KEEP_ALIVE_INTERVAL_MS);
  }

  private isCriticalWarmWindow(date = new Date()) {
    const parts = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Belem",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
    const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
    const current = hour * 60 + minute;

    return CRITICAL_WINDOWS.some((window) => {
      const start = this.timeToMinutes(window.start);
      const end = this.timeToMinutes(window.end);
      return current >= start && current <= end;
    });
  }

  private timeToMinutes(value: string) {
    const [hour, minute] = value.split(":").map((item) => Number(item || 0));
    return hour * 60 + minute;
  }

  private async runHealthCheck() {
    if (!this.monitoringEnabled || this.status !== "connected" || !this.sock) return;
    if (this.criticalDispatchInProgress || this.activeSendCycle) return;

    try {
      await this.prewarmConnection();
    } catch (error) {
      this.logger.warning(`Health check falhou: ${this.getErrorMessage(error)}. Reiniciando conexão.`);
      await this.restart();
    }
  }

  private async prewarmConnection(message?: string) {
    if (!this.sock || this.status !== "connected") return false;

    const config = this.configStore.load();
    const activeGroup = this.getActiveMonitoringGroup(config);
    if (!activeGroup.jid) return false;

    if (message) this.logger.info(message);

    this.syncMessagesFromConfig();
    const metadata = await this.refreshGroupMetadata(activeGroup.jid);
    if (metadata?.announce === true) {
      this.groupState = "closed";
    } else if (metadata?.announce === false) {
      this.groupState = "open";
    }
    const currentUserIds = this.getCurrentUserIds();
    const currentUserNumbers = currentUserIds.map((id) => id.split(":")[0].split("@")[0]).filter(Boolean);
    const participant = metadata?.participants?.find((item: any) => {
      const id = String(item.id || "");
      const number = id.split(":")[0].split("@")[0];
      return currentUserIds.includes(id) || currentUserNumbers.includes(number);
    });

    if (!participant) {
      this.currentUserInTargetGroup = false;
      this.logger.warning(`A conta conectada não apareceu na lista do ${activeGroup.label}. Verifique se ela ainda está no grupo.`);
      return false;
    }

    this.currentUserInTargetGroup = true;
    this.prepareSendPlan();
    await this.prewarmActiveChat(activeGroup.jid);
    return true;
  }

  private async prewarmActiveChat(jid: string) {
    if (!this.sock || !jid) return;

    const jobs = [
      this.sock.presenceSubscribe?.(jid),
      this.sock.sendPresenceUpdate?.("available")
    ].filter(Boolean);

    if (!jobs.length) return;

    await Promise.race([
      Promise.allSettled(jobs),
      this.delay(2500)
    ]).catch(() => undefined);
  }

  private getReadinessChecks(): BotReadinessCheck[] {
    const config = this.configStore.load();
    const activeGroup = this.getActiveMonitoringGroup(config);

    return [
      {
        id: "whatsapp",
        label: "WhatsApp conectado",
        ok: this.status === "connected"
      },
      {
        id: "test_group",
        label: "Grupo de teste configurado",
        ok: Boolean(config.grupoTesteJid || config.grupoTesteNome)
      },
      {
        id: "group",
        label: this.monitoringMode === "test" ? "Grupo monitorado: teste" : "Grupo monitorado: alvo",
        ok: Boolean(activeGroup.jid)
      },
      {
        id: "participant",
        label: "Conta confirmada no grupo",
        ok: this.currentUserInTargetGroup
      },
      {
        id: "messages",
        label: this.monitoringMode === "test" ? "Mensagens de teste prontas" : "Mensagens do alvo prontas",
        ok: this.hasReadyMessages(this.monitoringMode)
      },
      {
        id: "group_state",
        label: "Estado do grupo validado",
        ok: this.groupState !== "unknown"
      },
      {
        id: "armed",
        label: "Bot armado para disparar",
        ok: this.monitoringEnabled
      }
    ];
  }

  private hasReadyMessages(mode: MonitoringMode = this.monitoringMode) {
    const config = this.configStore.load();
    const codes = mode === "test" ? config.codigosMensagensTeste : config.codigosMensagensAlvo;
    if (mode === "target" && config.targetDispatchMode === "ocr") return true;
    if ((codes || []).some((item) => item.trim())) return true;
    return false;
  }

  private describeConfiguredOcrRoutes(config = this.configStore.load()) {
    const detailed = (config.rotasMonitoradasDetalhadas || [])
      .filter((item) => item.bairro?.trim())
      .map((item) => item.cidade?.trim() ? `${item.cidade} / ${item.bairro}` : item.bairro);
    if (detailed.length) return detailed.join(" | ");
    return (config.rotasMonitoradas || []).join(" | ") || "nenhuma rota configurada";
  }

  private async waitUntilGroupAcceptsMessages(jid: string, cycleId: number) {
    const checks = [0, 60, 90, 120, 180, 240, 320, 420, 560];

    for (const wait of checks) {
      if (cycleId !== this.sendCycleId) return false;
      if (wait > 0) await this.delay(wait);

      try {
        const metadata = await this.refreshGroupMetadata(jid);
        if (metadata?.announce === false) return true;
      } catch {
        return true;
      }
    }

    this.logger.warning("O evento de abertura chegou, mas o servidor ainda pode estar atualizando o grupo.");
    return false;
  }

  private async diagnoseNotAcceptable(jid: string, cycleId: number) {
    if (this.diagnosedNotAcceptableCycles.has(cycleId)) return;
    this.diagnosedNotAcceptableCycles.add(cycleId);

    try {
      const metadata = await this.refreshGroupMetadata(jid);
      const currentUserIds = this.getCurrentUserIds();
      const currentUserNumbers = currentUserIds.map((id) => id.split(":")[0].split("@")[0]).filter(Boolean);
      const participant = metadata?.participants?.find((item: any) => {
        const id = String(item.id || "");
        const number = id.split(":")[0].split("@")[0];
        return currentUserIds.includes(id) || currentUserNumbers.includes(number);
      });

      const groupState = metadata?.announce === false ? "aberto para todos" : "fechado/somente admins";
      const participantState = participant
        ? `conta encontrada no grupo (${participant.admin || "membro"})`
        : "conta não encontrada na lista de participantes";

      this.logger.warning(
        `Diagnóstico not-acceptable: WhatsApp informa grupo ${groupState}; ${participantState}.`
      );

      if (metadata?.announce !== false) {
        this.logger.error(
          "O WhatsApp ainda está vendo o grupo como fechado no momento do disparo. Nesse estado o servidor recusa a mensagem."
        );
      }
    } catch (error) {
      this.logger.warning(`Não consegui diagnosticar o grupo após not-acceptable: ${this.getErrorMessage(error)}`);
    }
  }

  private isInvalidSession(statusCode?: number, errorMessage = "") {
    const normalizedMessage = errorMessage.toLowerCase();

    return [
      DisconnectReason.loggedOut,
      DisconnectReason.badSession,
      DisconnectReason.multideviceMismatch
    ].includes(statusCode) ||
      normalizedMessage.includes("logged out") ||
      normalizedMessage.includes("bad session") ||
      normalizedMessage.includes("multidevice mismatch") ||
      normalizedMessage.includes("invalid");
  }

  private isRestartRequired(statusCode?: number, errorMessage = "") {
    const normalizedMessage = errorMessage.toLowerCase();
    return statusCode === DisconnectReason?.restartRequired || statusCode === 515 || normalizedMessage.includes("restart required");
  }

  private isConnectionConflict(statusCode?: number, errorMessage = "") {
    const normalizedMessage = errorMessage.toLowerCase();
    return statusCode === DisconnectReason?.connectionReplaced || (
      statusCode === 401 && (normalizedMessage.includes("conflict") || normalizedMessage.includes("connection replaced"))
    );
  }

  private disposeSocket(socket: any) {
    if (!socket) return;
    try {
      socket.ev?.removeAllListeners?.("connection.update");
      socket.ev?.removeAllListeners?.("groups.update");
      socket.ev?.removeAllListeners?.("messages.upsert");
      socket.ev?.removeAllListeners?.("messaging-history.set");
      socket.end?.(undefined);
      socket.ws?.close?.();
    } catch {
      // O socket já pode ter sido encerrado pelo próprio WhatsApp.
    }
  }

  private isQrRefAttemptLimit(statusCode?: number, errorMessage = "") {
    const normalizedMessage = errorMessage.toLowerCase();

    return (
      statusCode === DisconnectReason?.timedOut &&
      normalizedMessage.includes("qr") &&
      normalizedMessage.includes("attempt")
    ) || (
      statusCode === 408 &&
      normalizedMessage.includes("qr refs attempts ended")
    );
  }

  private hasAuthSession() {
    return fs.existsSync(path.join(this.authDir, "creds.json"));
  }

  private async logoutAndClearSession() {
    if (this.sock) {
      try {
        this.logger.info("Solicitando logout ao WhatsApp para remover este dispositivo conectado...");
        await this.sock.logout?.();
        this.logger.success("Logout solicitado ao WhatsApp.");
      } catch (error) {
        this.logger.warning(
          `Não foi possível confirmar logout no WhatsApp: ${this.getErrorMessage(error)}. Limpando sessão local mesmo assim.`
        );
      }
    }

    if (this.isRunning()) {
      await this.stop();
    } else {
      this.monitoringEnabled = false;
      this.clearReconnectTimer();
      this.clearHealthCheckTimer();
      this.clearWarmKeepAliveTimer();
    }

    this.pairingCode = "";
    this.pairingCodeRequested = false;
    this.removeAuthDir();
    this.groupState = "unknown";
    this.currentUserInTargetGroup = false;
    this.preparedTargetJid = "";
    this.preparedMessages = [];
    this.preparedRelayMessages = [];
    this.preparedRelaySignature = "";
    this.preparedRelayBuiltAt = 0;
  }

  private isFatalRuntimeError(errorMessage = "") {
    const normalizedMessage = errorMessage.toLowerCase();
    return (
      normalizedMessage.includes("crypto is not defined") ||
      normalizedMessage.includes("referenceerror")
    );
  }

  private async getWhatsAppVersion() {
    try {
      await loadBaileys();
      const { version } = await fetchLatestBaileysVersion();
      return version;
    } catch (error) {
      this.logger.warning(
        `Não foi possível consultar a versão mais recente do WhatsApp Web: ${this.getErrorMessage(error)}`
      );
      return undefined;
    }
  }

  private getDisconnectDescription(statusCode?: number, errorMessage = "") {
    const code = statusCode || "desconhecido";
    const message = errorMessage && errorMessage !== "undefined" ? ` Erro: ${errorMessage}` : "";
    return `Código: ${code}.${message}`;
  }

  private getCurrentUserIds() {
    return [
      this.sock?.user?.id,
      this.sock?.user?.lid,
      this.sock?.authState?.creds?.me?.id,
      this.sock?.authState?.creds?.me?.lid
    ]
      .map((id) => String(id || ""))
      .filter(Boolean);
  }

  private async refreshGroupMetadata(jid: string) {
    try {
      const metadata = await this.sock.groupMetadata(jid);
      if (metadata) {
        this.groupMetadataCache.set(jid, metadata);
      }

      return metadata;
    } catch (error) {
      const message = this.getErrorMessage(error);
      if (message.toLowerCase().includes("item-not-found")) {
        this.logger.warning("Grupo salvo não foi encontrado pelo WhatsApp. Atualize a lista e salve o grupo novamente.");
        return undefined;
      }

      throw error;
    }
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private isRunning() {
    return Boolean(this.sock) || ["connecting", "connected", "waiting_qr", "reconnecting"].includes(this.status);
  }

  private removeAuthDir() {
    try {
      if (fs.existsSync(this.authDir)) {
        fs.rmSync(this.authDir, { recursive: true, force: true });
      }
    } catch (error) {
      this.logger.error(`Erro ao apagar auth: ${this.getErrorMessage(error)}`);
    }
  }

  private clearPendingCredsSave() {
    if (this.pendingCredsSave) {
      clearTimeout(this.pendingCredsSave);
      this.pendingCredsSave = undefined;
    }
    this.saveCredsNow = undefined;
  }

  private resetPartialQrAuth() {
    this.clearPendingCredsSave();
    this.removeAuthDir();
    this.reconnectAttempts = 0;
    this.unknownDisconnects = 0;
    this.qrReceivedInCurrentConnection = false;
    this.qrCode = "";
    this.pairingCode = "";
    this.pairingCodeRequested = false;
    this.setStatus("reconnecting");
  }

  private setStatus(status: BotStatus) {
    this.status = status;
    this.emitSnapshot();
  }

  private addStatusEvent(type: BotStatusEvent["type"], message: string) {
    const event: BotStatusEvent = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: new Date().toISOString(),
      type,
      message
    };
    this.statusEvents = [event, ...this.statusEvents].slice(0, 300);
    this.saveStatusEvents();
    this.emitSnapshot();
  }

  private loadStatusEvents() {
    try {
      if (!fs.existsSync(this.statusEventsPath)) return [];
      const data = JSON.parse(fs.readFileSync(this.statusEventsPath, "utf-8"));
      return Array.isArray(data)
        ? data.map((item: any) => ({
            id: typeof item.id === "string" ? item.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
            type: ["connected", "disconnected", "reconnecting", "armed", "disarmed", "dispatch", "error"].includes(item.type) ? item.type : "error",
            message: typeof item.message === "string" ? item.message : ""
          })).filter((item: BotStatusEvent) => item.message).slice(0, 300)
        : [];
    } catch {
      return [];
    }
  }

  private saveStatusEvents() {
    try {
      fs.mkdirSync(path.dirname(this.statusEventsPath), { recursive: true });
      fs.writeFileSync(this.statusEventsPath, JSON.stringify(this.statusEvents, null, 2));
    } catch {
      // Status timeline is diagnostic; do not interrupt the bot.
    }
  }

  private emitSnapshot() {
    this.emit("snapshot", this.getSnapshot());
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  private clearHealthCheckTimer() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = undefined;
    }
  }

  private clearWarmKeepAliveTimer() {
    if (this.warmKeepAliveTimer) {
      clearInterval(this.warmKeepAliveTimer);
      this.warmKeepAliveTimer = undefined;
    }
    this.warmKeepAliveIntervalMs = 0;
  }

  private getErrorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  private normalizePhoneFromUnknown(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string" || typeof value === "number") {
      return this.normalizePhone(String(value));
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const directValues = [
        record.user,
        record.phone,
        record.phoneNumber,
        record.phone_number,
        record.pn,
        record.id,
        record.jid,
        record._serialized
      ];

      for (const item of directValues) {
        const phone = this.normalizePhoneFromUnknown(item);
        if (phone) return phone;
      }

      for (const item of Object.values(record)) {
        const phone = this.normalizePhoneFromUnknown(item);
        if (phone) return phone;
      }
    }

    return "";
  }

  private normalizePhone(value: string) {
    return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
  }
}
