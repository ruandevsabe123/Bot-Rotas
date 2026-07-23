import { CSSProperties, FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bell,
  Bot,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Edit3,
  FileUp,
  Gauge,
  Home,
  Info,
  LockKeyhole,
  LogOut,
  Mail,
  MessageSquareText,
  MoreVertical,
  RefreshCw,
  Route,
  Save,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  SlidersHorizontal,
  TestTube2,
  UserPlus,
  X,
  Wifi,
  WifiOff,
  Zap
} from "lucide-react";
import {
  AdminRoutesSnapshot,
  AdminLogEntry,
  AdminSupportMessagesSnapshot,
  AdminUserDetail,
  AdminUserSummary,
  AdminUsersSnapshot,
  BotSnapshot,
  MonitoredRoute,
  OcrRouteOption,
  OcrRouteSelectionState,
  PanelUserRole,
  RomaneioCandidate,
  RomaneioLocateResult,
  RomaneioSettings,
  RomaneioSnapshot,
  RouteDispatch,
  SupportMessage
} from "../../shared/types";
import { ControlButtons } from "./components/ControlButtons";
import { GroupMessageCard } from "./components/GroupMessageCard";
import { LogsPanel } from "./components/LogsPanel";
import { QrCodeBox } from "./components/QrCodeBox";
import { SettingsPanel } from "./components/SettingsPanel";
import { AdminCommandCenter } from "./admin/AdminCommandCenter";
import { enableWebPushNotifications } from "./pushNotifications";
import {
  botApi,
  clearAdminMaintenance,
  confirmRomaneio,
  getRomaneio,
  getAdminMonitor,
  getAdminUserDetail,
  getPanelMe,
  getPanelToken,
  getPanelUserEmail,
  getPanelUserRole,
  isAuthError,
  locateRomaneio,
  markSupportMessageRead,
  panelLogin,
  rejectAdminRoute,
  saveAdminUser,
  saveRomaneioSettings,
  sendSupportMessage,
  setPanelPassword,
  setPanelToken,
  setPanelUserEmail,
  setPanelUserRole,
  subscribeAdminMonitor,
  uploadRomaneio,
  validateAdminRoute
} from "./api";
import "./styles.css";

type PendingConfirmation = {
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
  tone?: "manual" | "auto";
  onConfirm: () => void | Promise<void>;
};

type ActionToast = {
  message: string;
  tone?: "manual" | "auto";
};

type AppTab = "home" | "groups" | "image" | "test" | "settings";
type GroupEditor = "target" | "image" | "test" | undefined;
type AdminSection = "overview" | "reactions" | "logs" | "routes" | "users" | "support" | "settings" | undefined;
type AdminMainTab = "dashboard" | "validations" | "history" | "logs" | "reports" | "clients" | "settings";
type RouteStatusFilter = "all" | "pending" | "validated" | "rejected" | "leader";
type RouteKindFilter = "all" | "automatic" | "manual" | "test";
type RouteHistoryTab = "automatic" | "manual" | "test";
type CleanupTarget = "logs" | "routes" | "support" | "all";
type AdminLogLevelFilter = "all" | "info" | "success" | "warning" | "error";

const emptySnapshot: BotSnapshot = {
  status: "disconnected",
  groupState: "unknown",
  qrCode: "",
  config: {
    grupoAlvoJid: "",
    grupoAlvoNome: "",
    grupoTesteJid: "",
    grupoTesteNome: "",
    nomeEnvio: "",
    targetDispatchMode: "manual",
    nuclearMode: false,
    codigosMensagensAlvo: [],
    rotasMonitoradas: [],
    rotasMonitoradasDetalhadas: [],
    routePresets: [],
    codigosMensagensTeste: [],
    testMessageCount: 15,
    testMessageIntervalMs: 0,
    fastMode: true,
    minSendDelayMs: 0,
    alwaysWarmMode: true,
    keepAliveIntervalMs: 300000,
    ocrManualRouteSelection: true
  },
  groups: [],
  readinessChecks: [],
  logs: [],
  testStatus: {
    active: false,
    lastSentCount: 0,
    lastFailedCount: 0,
    configuredMessageCount: 15,
    intervalMs: 0
  },
  performanceMetrics: {
    lastDispatchLatencyMs: 0,
    averageDispatchLatencyMs: 0,
    lastDispatchDurationMs: 0,
    averageMessageSendMs: 0,
    dispatchCount: 0,
    sentMessages: 0,
    failedMessages: 0,
    activeQueue: 0
  }
};

const tabs: Array<{ id: AppTab; label: string; Icon: typeof Home }> = [
  { id: "home", label: "Inicio", Icon: Home },
  { id: "image", label: "Imagem", Icon: Sparkles },
  { id: "test", label: "Teste", Icon: TestTube2 },
  { id: "settings", label: "Ajustes", Icon: Settings }
];

const emptyRomaneio: RomaneioSnapshot = {
  status: {
    loaded: false,
    totalRows: 0,
    totalRoutes: 0,
    totalPackages: 0,
    columns: []
  },
  settings: {
    prioridade: "equilibrio_geral"
  },
  routes: []
};

const emptyRomaneioLocate: RomaneioLocateResult = {
  found: false,
  message: "",
  candidates: []
};

const romaneioPriorities: Array<{ id: RomaneioSettings["prioridade"]; label: string }> = [
  { id: "equilibrio_geral", label: "Equilíbrio geral" },
  { id: "menor_distancia", label: "Menor distância" },
  { id: "menos_paradas", label: "Menos paradas" },
  { id: "menos_pacotes", label: "Menos pacotes" },
  { id: "maior_concentracao_bairro", label: "Maior concentração" }
];

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getCurrentMonthStartInput() {
  const now = new Date();
  return toDateInputValue(new Date(now.getFullYear(), now.getMonth(), 1));
}

function parseDateRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59.999`);
  const startMs = Number.isNaN(start.getTime()) ? 0 : start.getTime();
  const endMs = Number.isNaN(end.getTime()) ? Date.now() : end.getTime();
  return {
    startMs: Math.min(startMs, endMs),
    endMs: Math.max(startMs, endMs)
  };
}

function formatReportDateRange(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const format = (date: Date) => Number.isNaN(date.getTime()) ? "--/--/----" : date.toLocaleDateString("pt-BR");
  return `${format(start)} ate ${format(end)}`;
}

function normalizeMessages(senderName: string, codes: string[]) {
  return codes.map((code) => `${senderName.trim()} ${code.trim().toUpperCase()}`.trim()).filter(Boolean);
}

function formatOcrRoutes(routes: string[] = [], detailedRoutes: MonitoredRoute[] = []) {
  if (detailedRoutes.length) return detailedRoutes.map((route) => route.cidade ? `${route.cidade} / ${route.bairro}` : route.bairro);
  return routes;
}

function MessagePreviewStrip({
  title,
  group,
  messages,
  onOpen
}: {
  title: string;
  group: string;
  messages: string[];
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <article className="message-strip">
      <button className="message-strip-main" type="button" onClick={() => setExpanded((value) => !value)}>
        <span>
          <strong>{title}</strong>
          <small>{group}</small>
        </span>
        <b>{messages.length}</b>
      </button>
      {expanded ? (
        <div className="message-strip-body">
          {messages.length ? messages.map((message, index) => <span key={`${message}-${index}`}>{message}</span>) : <span>Nenhuma mensagem salva.</span>}
          <button className="link-button" type="button" onClick={onOpen}>
            Editar
          </button>
        </div>
      ) : null}
    </article>
  );
}

function LoginScreen({ error, onSubmit }: { error?: string; onSubmit: (email: string, password: string) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [supportMessage, setSupportMessage] = useState("Meu acesso está bloqueado. Pode liberar minha conta?");
  const [supportStatus, setSupportStatus] = useState("");
  const blocked = Boolean(error && /bloquead/i.test(error));

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(email.trim(), password);
  }

  async function requestSupport() {
    setSupportStatus("");
    try {
      await sendSupportMessage({ email: email.trim(), message: supportMessage });
      setSupportStatus("Mensagem enviada para o admin pelo painel.");
    } catch (supportError) {
      setSupportStatus(supportError instanceof Error ? supportError.message : "Não consegui enviar a mensagem.");
    }
  }

  return (
    <main className="login-shell">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-logo" aria-hidden="true">
          <Bot size={31} />
          <span>BR</span>
        </div>
        <p className="panel-label">Bot Manager</p>
        <h1>Bot Rotas</h1>
        <div className="login-field">
          <Mail size={18} />
          <input
            autoComplete="email"
            placeholder="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="login-field">
          <LockKeyhole size={18} />
          <input
            autoComplete="current-password"
            autoFocus
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {blocked ? (
          <section className="blocked-access-card">
            <strong>Acesso pausado</strong>
            <p>Seu usuário está bloqueado no momento. Envie uma mensagem interna para o admin solicitar liberação.</p>
            <textarea
              value={supportMessage}
              onChange={(event) => setSupportMessage(event.target.value)}
              placeholder="Escreva sua mensagem para o admin"
            />
            <button className="button primary" disabled={!email.trim() || !supportMessage.trim()} type="button" onClick={requestSupport}>
              <MessageSquareText size={18} />
              Enviar para o admin
            </button>
            {supportStatus ? <span className="support-unavailable">{supportStatus}</span> : null}
          </section>
        ) : error ? <p className="login-error">{error}</p> : null}
        <button className="button primary" disabled={!email.trim() || !password} type="submit">
          Entrar
        </button>
      </form>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-shell">
      <section className="loading-panel">
        <div className="brand-logo" aria-hidden="true">
          <Bot size={31} />
          <span>BR</span>
        </div>
        <span className="loading-spinner" aria-hidden="true" />
        <div>
          <p className="panel-label">Abrindo painel</p>
          <h1>Validando sessão</h1>
          <p>Carregando seu acesso salvo.</p>
        </div>
      </section>
    </main>
  );
}

function ConfigStrip({
  kind,
  title,
  group,
  codes,
  onOpen
}: {
  kind: "target" | "test";
  title: string;
  group: string;
  codes: string[];
  onOpen: () => void;
}) {
  const Icon = kind === "target" ? MessageSquareText : TestTube2;

  return (
    <button className={`config-strip config-strip-${kind}`} type="button" onClick={onOpen}>
      <span className="strip-icon">
        <Icon size={20} />
      </span>
      <span className="strip-copy">
        <strong>{title}</strong>
        <small>{group}</small>
      </span>
      <span className="strip-count">{codes.length}</span>
      <SlidersHorizontal size={20} />
    </button>
  );
}

function getLastLogTime(logs: BotSnapshot["logs"], patterns: RegExp[]) {
  const found = [...logs].reverse().find((log) => patterns.some((pattern) => pattern.test(log.message)));
  return found ? new Date(found.timestamp).toLocaleTimeString("pt-BR") : "Sem registro";
}

function countConfirmedMessages(logs: BotSnapshot["logs"]) {
  return logs.filter((log) => /Mensagem (alvo )?\d+ .*?(confirmada|enviada)/i.test(log.message)).length;
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Sem registro";
}

function formatShortDate(value?: string) {
  return value
    ? new Date(value).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      })
    : "Sem registro";
}

const INCIDENT_SNOOZE_DELAYS_MINUTES = [10, 5, 2];

function isClientIncidentDue(route: RouteDispatch, now = Date.now()) {
  const incident = route.clientIncident;
  if (!incident?.required || incident.answeredAt) return false;
  if (!incident.snoozedUntil) return true;
  const dueAt = new Date(incident.snoozedUntil).getTime();
  return !Number.isFinite(dueAt) || dueAt <= now;
}

function getIncidentSnoozeDelayMinutes(route: RouteDispatch) {
  const count = Math.max(0, Number(route.clientIncident?.snoozeCount || 0));
  return INCIDENT_SNOOZE_DELAYS_MINUTES[count];
}

function getIncidentAuditLines(route: RouteDispatch) {
  const incident = route.clientIncident;
  const removedLeaderEvents = (route.reactionsHistory || []).filter((reaction) => reaction.action === "remove" && reaction.isAdmin);
  const lastRemovedLeader = removedLeaderEvents[removedLeaderEvents.length - 1];
  const lastReaction = route.lastReactionState;
  const deletedIds = route.deletedMessageIds || [];
  const lines = [
    `Evento criado: ${formatDate(incident?.createdAt)}`,
    `Envio original: ${formatDate(route.createdAt)}`,
    `Grupo: ${route.groupName || route.groupJid || "Não identificado"}`,
    `Status do envio: ${route.confirmedCount}/${route.totalCount} confirmada(s), status ${route.status}`,
    `Modo: ${route.ocr ? "Bot imagem/análise visual" : route.mode === "test" ? "Teste/aquecimento" : "Grupo alvo"}`,
    `Trigger: ${route.trigger || (route.mode === "test" ? "warmup" : "automatic")}`
  ];

  if (incident?.kind === "message_deleted") {
    lines.push(`Mensagem apagada: ${deletedIds.length ? deletedIds.join(", ") : "ID não identificado"}`);
  }

  if (lastRemovedLeader) {
    lines.push(`Quem removeu: ${lastRemovedLeader.leaderName || lastRemovedLeader.senderPhone || "Líder identificado"}`);
    lines.push(`Horário da remoção: ${formatDate(lastRemovedLeader.timestamp)}`);
    lines.push(`Emoji removido: ${lastRemovedLeader.emoji || "Reação sem emoji"}`);
  } else if (lastReaction?.status === "removed") {
    lines.push(`Última reação removida: ${lastReaction.leaderName || lastReaction.senderPhone || "Remetente identificado"}`);
    lines.push(`Horário da remoção: ${formatDate(lastReaction.updatedAt)}`);
  }

  if (route.messages.length) lines.push(`Mensagem enviada: ${route.messages.join(" | ")}`);
  if (route.sentMessageIds.length) lines.push(`IDs enviados: ${route.sentMessageIds.join(", ")}`);
  if (incident?.snoozeCount) lines.push(`Adiamentos usados: ${incident.snoozeCount}/3`);
  if (incident?.snoozedUntil) lines.push(`Último prazo: ${formatDate(incident.snoozedUntil)}`);
  return lines;
}

function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}min`;
  if (hours) return `${hours}h`;
  return `${minutes}min`;
}

function getPresenceCopy(user: AdminUserSummary) {
  if (user.blocked) return "bloqueado";
  if (user.presenceStatus === "online") return "online agora";
  if (user.presenceStatus === "recent") return "ativo recente";
  return "offline";
}

function getBotOpenCopy(user: AdminUserSummary) {
  if (user.botOpen && user.monitoringEnabled) return "bot ligado";
  if (user.botOpen) return "painel do bot aberto";
  return "bot fechado";
}

function colorStyle(color?: string): CSSProperties {
  return { "--client-color": color || "#7eb6ff" } as CSSProperties;
}

function OperationStep({
  title,
  detail,
  state,
  Icon
}: {
  title: string;
  detail: string;
  state: "done" | "active" | "waiting" | "error";
  Icon: typeof Home;
}) {
  return (
    <article className={`operation-step step-${state}`}>
      <span className="operation-icon">
        {state === "done" ? <CheckCircle2 size={19} /> : state === "error" ? <AlertTriangle size={19} /> : <Icon size={19} />}
      </span>
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function CockpitPanel({
  snapshot,
  groupLabel
}: {
  snapshot: BotSnapshot;
  groupLabel: string;
}) {
  const connected = snapshot.status === "connected";
  const connectionWaiting = snapshot.status === "connecting" || snapshot.status === "waiting_qr" || snapshot.status === "reconnecting";
  const hasGroup = Boolean(snapshot.config.grupoAlvoJid || snapshot.config.grupoAlvoNome);
  const hasMessages = Boolean(snapshot.config.nomeEnvio && snapshot.config.codigosMensagensAlvo?.length);
  const armed = Boolean(snapshot.monitoringEnabled);
  const lastOpening = getLastLogTime(snapshot.logs, [/ABRIU/i, /Palavra de abertura/i, /Abertura simulada/i]);
  const confirmed = countConfirmedMessages(snapshot.logs);

  return (
    <section className="operation-panel" aria-label="Resumo operacional">
      <div className="operation-heading">
        <div>
          <p className="panel-label">Agora</p>
          <h2>{armed ? "Bot armado e ouvindo o grupo" : connected ? "Pronto para iniciar" : connectionWaiting ? "Conectando WhatsApp" : "Conecte o WhatsApp"}</h2>
        </div>
        <span className={armed ? "live-badge active" : "live-badge"}>{armed ? "Ao vivo" : "Parado"}</span>
      </div>
      <div className="operation-steps">
        <OperationStep
          Icon={connected ? Wifi : WifiOff}
          state={snapshot.status === "error" ? "error" : connected ? "done" : connectionWaiting ? "active" : "waiting"}
          title="WhatsApp"
          detail={connected ? "Conectado" : snapshot.status === "waiting_qr" ? "Leia o QR Code" : "Aguardando conexão"}
        />
        <OperationStep
          Icon={ShieldCheck}
          state={hasGroup ? "done" : "waiting"}
          title="Rota"
          detail={hasGroup ? groupLabel : "Escolha o grupo alvo"}
        />
        <OperationStep
          Icon={MessageSquareText}
          state={hasMessages ? "done" : "waiting"}
          title="Mensagens"
          detail={hasMessages ? `${snapshot.config.codigosMensagensAlvo.length} pronta(s)` : "Configure nome e códigos"}
        />
        <OperationStep
          Icon={Send}
          state={armed ? "active" : "waiting"}
          title="Disparo"
          detail={armed ? `Última abertura: ${lastOpening}` : `${confirmed} mensagem(ns) confirmadas`}
        />
      </div>
    </section>
  );
}

function PerformanceStrip({ snapshot }: { snapshot: BotSnapshot }) {
  const metrics = snapshot.performanceMetrics || emptySnapshot.performanceMetrics!;
  const healthLabel = metrics.raceHealth === "excellent" ? "excelente" : metrics.raceHealth === "good" ? "boa" : metrics.raceHealth === "poor" ? "atenção" : metrics.raceHealth === "critical" ? "crítica" : "sem teste";
  const healthTone = metrics.raceHealth === "excellent" || metrics.raceHealth === "good" ? "green" : metrics.raceHealth === "unknown" ? "blue" : "yellow";
  return (
    <section className="performance-strip">
      <AdminMetric Icon={Zap} tone={healthTone} title="Saúde da corrida" value={healthLabel} detail={`loop ${metrics.eventLoopLagMs || 0}ms`} />
      <AdminMetric Icon={Gauge} tone="green" title="ACK P95" value={`${metrics.p95FirstAckMs || 0}ms`} detail={`relay ${metrics.p95FirstRelayMs || 0}ms`} />
      <AdminMetric Icon={Activity} tone={(metrics.notAcceptableCount || 0) ? "yellow" : "blue"} title="Retorno do grupo" value={metrics.lastFirstGroupEchoMs === undefined ? "—" : `${metrics.lastFirstGroupEchoMs}ms`} detail={(metrics.notAcceptableCount || 0) ? `${metrics.notAcceptableCount} recusas` : "sem recusa"} />
      <AdminMetric Icon={Wifi} tone={snapshot.status === "connected" ? "green" : "yellow"} title="Conexão" value={snapshot.status === "connected" ? "online" : "atenção"} detail={snapshot.monitoringEnabled ? `armado há ${formatDuration(metrics.armedIdleMs || 0)}` : "aguardando operação"} />
    </section>
  );
}

function LaunchReviewPanel({
  snapshot,
  groupLabel,
  messages,
  onEditTarget,
}: {
  snapshot: BotSnapshot;
  groupLabel: string;
  messages: string[];
  onEditTarget: () => void;
}) {
  const hasGroup = Boolean(snapshot.config.grupoAlvoJid || snapshot.config.grupoAlvoNome);
  const hasName = Boolean(snapshot.config.nomeEnvio);
  const hasMessages = messages.length > 0;
  const ocrMode = messages.some((message) => message.startsWith("OCR:"));

  return (
    <section className="quick-panel launch-review-panel">
      <div className="panel-heading">
        <div>
          <p className="panel-label">Revisão antes de iniciar</p>
          <h2>{ocrMode ? "Foto da rota" : "Rota e mensagens"}</h2>
        </div>
        <button className="button" type="button" onClick={onEditTarget}>
          <SlidersHorizontal size={18} />
          Editar
        </button>
      </div>
      <div className="review-grid">
        <article className={hasGroup ? "review-item ok" : "review-item pending"}>
          <span>Rota</span>
          <strong>{groupLabel}</strong>
        </article>
        <article className={hasName ? "review-item ok" : "review-item pending"}>
          <span>Nome</span>
          <strong>{snapshot.config.nomeEnvio || "Não configurado"}</strong>
        </article>
        <article className={hasMessages ? "review-item ok" : "review-item pending"}>
          <span>{ocrMode ? "Ranking inteligente" : "Mensagens"}</span>
          <strong>{messages.length ? `${messages.length} salvo(s)` : "Nenhuma"}</strong>
        </article>
      </div>
      <div className="review-messages">
        {messages.length ? messages.map((message, index) => <span key={`${message}-${index}`}>{message}</span>) : <span>Configure a rota antes de iniciar.</span>}
      </div>
      <div className="review-actions">
        <button className="button" type="button" onClick={onEditTarget}>
          Configurar rota
        </button>
      </div>
    </section>
  );
}

function AdminMetric({
  title,
  value,
  detail,
  Icon,
  tone = "yellow"
}: {
  title: string;
  value: string | number;
  detail: string;
  Icon?: typeof Home;
  tone?: "yellow" | "green" | "blue" | "red";
}) {
  return (
    <article className={`admin-metric admin-metric-${tone}`}>
      {Icon ? (
        <span className="admin-metric-icon">
          <Icon size={19} />
        </span>
      ) : null}
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function getReactionDisplayPhone(reaction: RouteDispatch["reactions"][number]) {
  if (reaction.senderPhone && reaction.senderPhone.startsWith("55")) return reaction.senderPhone;
  const phone = (reaction.senderIdentifiers || []).find((item) => /^55\d{10,13}$/.test(item));
  return phone || reaction.senderPhone || "Número não identificado";
}

function getRouteTrigger(route: RouteDispatch) {
  if (route.trigger) return route.trigger;
  return route.mode === "test" ? "warmup" : "automatic";
}

function getRouteTriggerLabel(route: RouteDispatch) {
  const trigger = getRouteTrigger(route);
  if (trigger === "manual") return "Manual";
  if (trigger === "warmup") return "Teste 15 msgs";
  if (trigger === "target-simulation") return "Simulação alvo";
  if (trigger === "simulation") return "Simulação abertura";
  return "Automático";
}

function getRouteDecisionStatus(route: RouteDispatch) {
  return route.decisionStatus || (route.validated ? "validated" : "pending");
}

function getRouteDecisionLabel(route: RouteDispatch) {
  const status = getRouteDecisionStatus(route);
  if (status === "validated") return "Validada";
  if (status === "rejected") return "Não válida";
  return "Pendente";
}

function AdminRouteHistory({
  automaticRoutes,
  manualRoutes,
  testRoutes,
  activeTab,
  onTabChange,
  onValidate,
  onReject,
  onFilterClient,
  onDetails,
  compact = false
}: {
  automaticRoutes: RouteDispatch[];
  manualRoutes: RouteDispatch[];
  testRoutes: RouteDispatch[];
  activeTab: RouteHistoryTab;
  onTabChange: (tab: RouteHistoryTab) => void;
  onValidate?: (routeId: string) => void;
  onReject?: (routeId: string) => void;
  onFilterClient?: (email: string) => void;
  onDetails?: (route: RouteDispatch) => void;
  compact?: boolean;
}) {
  const tabs: Array<{ id: RouteHistoryTab; title: string; detail: string; routes: RouteDispatch[]; Icon: typeof Home }> = [
    { id: "automatic", title: "Alvo automático", detail: "Abertura real do grupo alvo", routes: automaticRoutes, Icon: Zap },
    { id: "manual", title: "Manual / simulação", detail: "Clique manual e simulação", routes: manualRoutes, Icon: Send },
    { id: "test", title: "Teste / 15 mensagens", detail: "Aquecimento e simulação alvo", routes: testRoutes, Icon: TestTube2 }
  ];
  const active = tabs.find((tab) => tab.id === activeTab) || tabs[0];

  return (
    <section className={compact ? "admin-route-history compact" : "admin-route-history"}>
      <aside className="admin-route-tabs">
        {tabs.map(({ id, title, detail, routes, Icon }) => (
          <button className={id === active.id ? "active" : ""} key={id} type="button" onClick={() => onTabChange(id)}>
            <Icon size={18} />
            <span>
              <strong>{title}</strong>
              <small>{detail}</small>
            </span>
            <b>{routes.length}</b>
          </button>
        ))}
      </aside>
      <div className="admin-route-history-list">
        <div className="admin-route-history-heading">
          <div>
            <p className="panel-label">Histórico de disparo</p>
            <h2>{active.title}</h2>
          </div>
          <span>{active.routes.length} registro(s)</span>
        </div>
        <div className={compact ? "admin-route-scroll compact" : "admin-route-scroll"}>
          {active.routes.length ? active.routes.map((route) => (
            compact ? (
              <button className="admin-route-feed-item" key={`route-feed-${route.id}`} type="button">
                <div className="admin-route-feed-top">
                  <span className={getRouteDecisionStatus(route) === "validated" ? "mini-badge ok" : getRouteDecisionStatus(route) === "rejected" ? "mini-badge danger" : "mini-badge"}>{getRouteDecisionLabel(route)}</span>
                  <small>{new Date(route.createdAt).toLocaleString("pt-BR")}</small>
                </div>
                <strong>{route.groupName || route.groupJid || "Grupo sem nome"}</strong>
                <small>{route.clientEmail} · {route.confirmedCount}/{route.totalCount} enviadas · {route.reactions.length} reação(ões)</small>
                <div className="admin-route-feed-messages">
                  {route.messages.map((message, index) => (
                    <span key={`${route.id}-compact-message-${index}`}>{message}</span>
                  ))}
                </div>
                {route.reactions.length ? (
                  <div className="admin-route-feed-reactions">
                    {route.reactions.map((reaction) => (
                      <span className={reaction.isAdmin ? "leader" : ""} key={`${route.id}-compact-reaction-${reaction.id}`}>
                        <b>{reaction.emoji || "?"}</b>
                        {reaction.isAdmin
                          ? `Líder${reaction.leaderName ? ` - ${reaction.leaderName}` : ""}`
                          : getReactionDisplayPhone(reaction)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </button>
            ) : (
              <RouteRow
                key={route.id}
                route={route}
                onValidate={onValidate ? () => onValidate(route.id) : undefined}
                onReject={onReject ? () => onReject(route.id) : undefined}
                onFilterClient={onFilterClient ? () => onFilterClient(route.clientEmail) : undefined}
                onDetails={onDetails ? () => onDetails(route) : undefined}
              />
            )
          )) : <p className="qr-empty">Nenhum disparo nesse histórico.</p>}
        </div>
      </div>
    </section>
  );
}

function RouteRow({
  route,
  onValidate,
  onReject,
  onFilterClient,
  onDetails
}: {
  route: RouteDispatch;
  onValidate?: () => void;
  onReject?: () => void;
  onFilterClient?: () => void;
  onDetails?: () => void;
}) {
  const createdAt = new Date(route.createdAt).toLocaleString("pt-BR");
  const [menuOpen, setMenuOpen] = useState(false);
  const decisionStatus = getRouteDecisionStatus(route);
  const validated = decisionStatus === "validated";
  const rejected = decisionStatus === "rejected";

  return (
    <article className={validated ? "route-row validated" : rejected ? "route-row rejected" : "route-row"} style={colorStyle(route.clientColor)}>
      <div className="route-row-main">
        <span className={validated ? "route-state-icon ok" : rejected ? "route-state-icon rejected" : "route-state-icon"}>
          {validated ? <CheckCircle2 size={19} /> : rejected ? <Ban size={19} /> : <Clock3 size={19} />}
        </span>
        <div>
          <p className="panel-label client-label">
            <span className="client-color-dot" />
            {route.clientEmail || "Cliente"}
          </p>
          <h2>{route.groupName || route.groupJid || "Grupo sem nome"}</h2>
        </div>
        <span className={validated ? "route-status ok" : rejected ? "route-status rejected" : "route-status"}>{getRouteDecisionLabel(route)}</span>
        <button className="icon-button route-menu-button" title="Mais opções" type="button" onClick={() => setMenuOpen((current) => !current)}>
          <MoreVertical size={18} />
        </button>
        {menuOpen ? (
          <div className="route-menu-popover">
            {onDetails ? <button type="button" onClick={() => { setMenuOpen(false); onDetails(); }}>Ver detalhes</button> : null}
            {onFilterClient ? <button type="button" onClick={() => { setMenuOpen(false); onFilterClient(); }}>Filtrar cliente</button> : null}
            {!validated && onValidate ? <button type="button" onClick={() => { setMenuOpen(false); onValidate(); }}>Marcar validada</button> : null}
            {!rejected && onReject ? <button className="danger" type="button" onClick={() => { setMenuOpen(false); onReject(); }}>Não validar</button> : null}
          </div>
        ) : null}
      </div>
      <div className="route-meta">
        <span>{getRouteTriggerLabel(route)}</span>
        <span>{createdAt}</span>
        <span>{route.confirmedCount}/{route.totalCount} enviadas</span>
        <span>{route.reactions.length} reações</span>
      </div>
      <div className="route-messages">
        {route.messages.map((message, index) => (
          <span key={`${route.id}-${message}-${index}`}>{message}</span>
        ))}
      </div>
      {route.reactions.length ? (
        <div className="reaction-stack">
          {route.reactions.map((reaction) => (
            <div className={reaction.isAdmin ? "reaction-line leader" : "reaction-line"} key={reaction.id}>
              <b>{reaction.emoji || "?"}</b>
              <span>
                <strong>
                  {reaction.isAdmin
                    ? `REAÇÃO DE LÍDER CONFIRMADA${reaction.leaderName ? ` - ${reaction.leaderName}` : ""}`
                    : "Reação comum - não é líder"}
                </strong>
                <small>{getReactionDisplayPhone(reaction)}</small>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {decisionStatus === "pending" && (onValidate || onReject) ? (
        <div className="route-action-stack">
          {onValidate ? (
            <button className="button accent route-validate-button" type="button" onClick={onValidate}>
              <CheckCircle2 size={18} />
              Validar
            </button>
          ) : null}
          <button className="button route-review-button" type="button">
            Revisar
          </button>
          {onReject ? (
            <button className="button danger route-reject-button" type="button" onClick={onReject}>
              <Ban size={18} />
              Não validar
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

type UserEditorState = {
  originalEmail?: string;
  email: string;
  password: string;
  role: PanelUserRole;
  blocked: boolean;
  color: string;
};

const emptyUserEditor: UserEditorState = {
  email: "",
  password: "",
  role: "client",
  blocked: false,
  color: "#3b82f6"
};

function UserEditor({
  value,
  onChange,
  onSave,
  onCancel,
  busy
}: {
  value: UserEditorState;
  onChange: (value: UserEditorState) => void;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
}) {
  return (
    <section className="user-editor">
      <div className="login-field">
        <Mail size={18} />
        <input
          autoComplete="off"
          placeholder="Email"
          type="email"
          value={value.email}
          onChange={(event) => onChange({ ...value, email: event.target.value })}
        />
      </div>
      <div className="login-field">
        <LockKeyhole size={18} />
        <input
          autoComplete="new-password"
          placeholder={value.originalEmail ? "Nova senha opcional" : "Senha"}
          type="password"
          value={value.password}
          onChange={(event) => onChange({ ...value, password: event.target.value })}
        />
      </div>
      <select value={value.role} onChange={(event) => onChange({ ...value, role: event.target.value === "admin" ? "admin" : "client" })}>
        <option value="client">Cliente</option>
        <option value="admin">Admin</option>
      </select>
      <label className="toggle-row">
        <input type="checkbox" checked={value.blocked} onChange={(event) => onChange({ ...value, blocked: event.target.checked })} />
        Bloqueado
      </label>
      <label className="color-picker-row" title="Cor do usuário no histórico">
        <span className="color-orb" style={{ background: value.color }} />
        <input
          aria-label="Cor do usuário"
          type="color"
          value={value.color}
          onChange={(event) => onChange({ ...value, color: event.target.value })}
        />
      </label>
      <div className="user-editor-actions">
        <button className="button" type="button" onClick={onCancel}>
          <X size={18} />
          Cancelar
        </button>
        <button className="button primary" disabled={busy || !value.email.trim() || (!value.originalEmail && !value.password.trim())} type="button" onClick={onSave}>
          <Save size={18} />
          Salvar
        </button>
      </div>
    </section>
  );
}

function AdminUserRow({
  user,
  onEdit,
  onToggleBlock,
  onDetails
}: {
  user: AdminUserSummary;
  onEdit: () => void;
  onToggleBlock: () => void;
  onDetails: () => void;
}) {
  return (
    <article className={user.blocked ? "user-row blocked" : `user-row presence-${user.presenceStatus}`} style={colorStyle(user.color)}>
      <span className={user.blocked ? "user-state-icon blocked" : "user-state-icon"}>
        {user.blocked ? <Ban size={19} /> : user.panelOnline ? <Activity size={19} /> : <CheckCircle2 size={19} />}
      </span>
      <div>
        <p className="panel-label client-label">
          <span className="client-color-dot" />
          {user.role === "admin" ? "Admin" : "Cliente"} · {getPresenceCopy(user)}
        </p>
        <h2>{user.email}</h2>
        <div className="route-meta">
          <span>Último login: {formatDate(user.lastLoginAt)}</span>
          <span>{getBotOpenCopy(user)}</span>
          <span>Uso: {formatDuration(user.totalUsageMs)}</span>
          <span>{user.loginCount} login(s)</span>
        </div>
      </div>
      <div className="user-row-actions">
        <button className="icon-button" title="Mais especificações" type="button" onClick={onDetails}>
          <Info size={19} />
        </button>
        <button className="icon-button" title="Editar usuário" type="button" onClick={onEdit}>
          <Edit3 size={19} />
        </button>
        <button className={user.blocked ? "icon-button active-danger" : "icon-button"} title={user.blocked ? "Desbloquear" : "Bloquear"} type="button" onClick={onToggleBlock}>
          <Ban size={19} />
        </button>
      </div>
    </article>
  );
}

function UserDetailModal({ detail, onClose }: { detail: AdminUserDetail; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="sheet-dialog user-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="user-detail-title">
        <div className="sheet-heading">
          <div>
            <p className="panel-label">Especificações</p>
            <h2 id="user-detail-title">{detail.email}</h2>
          </div>
          <button className="icon-button" title="Fechar" type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <section className="detail-grid">
          <AdminMetric Icon={Clock3} tone="blue" title="Uso" value={formatDuration(detail.totalUsageMs)} detail={`${detail.loginCount} login(s)`} />
          <AdminMetric Icon={Activity} tone={detail.panelOnline ? "green" : detail.presenceStatus === "recent" ? "yellow" : "blue"} title="Painel" value={getPresenceCopy(detail)} detail={getBotOpenCopy(detail)} />
          <AdminMetric Icon={Bot} tone={detail.monitoringEnabled ? "green" : "yellow"} title="Bot" value={detail.botStatus} detail={detail.monitoringEnabled ? "monitorando" : "parado"} />
          <AdminMetric Icon={Wifi} tone="blue" title="Zap" value={formatShortDate(detail.lastWhatsAppConnectionAt)} detail="última conexão" />
          <AdminMetric Icon={Route} tone="green" title="Rotas" value={detail.routes.length} detail="histórico salvo" />
          <AdminMetric Icon={Zap} tone="yellow" title="Latência" value={`${detail.performanceMetrics?.lastDispatchLatencyMs || 0}ms`} detail={`média ${detail.performanceMetrics?.averageDispatchLatencyMs || 0}ms`} />
        </section>

        <section className="detail-section">
          <p className="panel-label">Configuração do usuário</p>
          <div className="detail-list">
            <span>Nome configurado: <b>{detail.config.nomeEnvio || "Não configurado"}</b></span>
            <span>Grupo alvo: <b>{detail.config.grupoAlvoNome || detail.config.grupoAlvoJid || "Não configurado"}</b></span>
            <span>Grupo teste: <b>{detail.config.grupoTesteNome || detail.config.grupoTesteJid || "Não configurado"}</b></span>
            <span>Rotas por imagem: <b>{formatOcrRoutes(detail.config.rotasMonitoradas || [], detail.config.rotasMonitoradasDetalhadas || []).join(", ") || "Nenhuma"}</b></span>
            <span>Mensagens alvo: <b>{(detail.config.codigosMensagensAlvo || []).join(", ") || "Nenhuma"}</b></span>
            <span>Mensagens teste: <b>{(detail.config.codigosMensagensTeste || []).join(", ") || "Nenhuma"}</b></span>
          </div>
        </section>

        <section className="detail-section">
          <p className="panel-label">Histórico de login</p>
          <div className="detail-list">
            {detail.loginHistory.length ? detail.loginHistory.slice(0, 8).map((event) => (
              <span key={event.id}>{formatDate(event.timestamp)} · {event.ip || "IP não identificado"}</span>
            )) : <span>Nenhum login registrado.</span>}
          </div>
        </section>

        <section className="detail-section">
          <p className="panel-label">Logs recentes do bot</p>
          <div className="detail-list scrollable-detail-list">
            {detail.logs.length ? detail.logs.slice(0, 60).map((log) => (
              <span key={log.id}>{formatDate(log.timestamp)} · {log.message}</span>
            )) : <span>Nenhum log registrado.</span>}
          </div>
        </section>
      </section>
    </div>
  );
}

function RouteDetailModal({ route, onClose }: { route: RouteDispatch; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="sheet-dialog user-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="route-detail-title">
        <div className="sheet-heading">
          <div>
            <p className="panel-label">{getRouteTriggerLabel(route)} · {getRouteDecisionLabel(route)}</p>
            <h2 id="route-detail-title">{route.groupName || route.groupJid || "Grupo sem nome"}</h2>
          </div>
          <button className="icon-button" title="Fechar" type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <section className="detail-grid">
          <AdminMetric Icon={Send} tone="blue" title="Envio" value={`${route.confirmedCount}/${route.totalCount}`} detail={route.status} />
          <AdminMetric Icon={MessageSquareText} tone="yellow" title="Reações" value={route.reactions.length} detail="recebidas" />
          <AdminMetric Icon={Clock3} tone="blue" title="Criada" value={formatShortDate(route.createdAt)} detail={new Date(route.createdAt).toLocaleTimeString("pt-BR")} />
          <AdminMetric Icon={ShieldCheck} tone={getRouteDecisionStatus(route) === "validated" ? "green" : getRouteDecisionStatus(route) === "rejected" ? "red" : "yellow"} title="Decisão" value={getRouteDecisionLabel(route)} detail={route.validatedBy || route.rejectedBy || "aguardando"} />
        </section>
        <section className="detail-section">
          <p className="panel-label">Dados da rota</p>
          <div className="detail-list">
            <span>Cliente: <b>{route.clientEmail || "Não identificado"}</b></span>
            <span>Grupo: <b>{route.groupName || route.groupJid || "Não identificado"}</b></span>
            <span>Origem: <b>{getRouteTriggerLabel(route)}</b></span>
            <span>Atualizada: <b>{formatDate(route.updatedAt)}</b></span>
          </div>
        </section>
        <section className="detail-section">
          <p className="panel-label">Mensagens</p>
          <div className="detail-list">
            {route.messages.length ? route.messages.map((message, index) => <span key={`${route.id}-detail-message-${index}`}>{message}</span>) : <span>Nenhuma mensagem registrada.</span>}
          </div>
        </section>
        <section className="detail-section">
          <p className="panel-label">Reações</p>
          <div className="detail-list">
            {route.reactions.length ? route.reactions.map((reaction) => (
              <span key={`${route.id}-detail-reaction-${reaction.id}`}>
                {reaction.emoji || "?"} · {reaction.isAdmin ? `Líder${reaction.leaderName ? ` - ${reaction.leaderName}` : ""}` : getReactionDisplayPhone(reaction)}
              </span>
            )) : <span>Nenhuma reação registrada.</span>}
          </div>
        </section>
      </section>
    </div>
  );
}

function SupportMessageRow({ message, onMarkRead }: { message: SupportMessage; onMarkRead: () => void }) {
  return (
    <article className={message.read ? "support-message-row" : "support-message-row unread"} style={colorStyle(message.clientColor)}>
      <div>
        <p className="panel-label client-label">
          <span className="client-color-dot" />
          {message.read ? "Lida" : "Nova mensagem"}
        </p>
        <h2>{message.email}</h2>
        <small>{formatDate(message.createdAt)}</small>
      </div>
      <p>{message.message}</p>
      {!message.read ? (
        <button className="button" type="button" onClick={onMarkRead}>
          Marcar como lida
        </button>
      ) : null}
    </article>
  );
}

function AdminSectionCard({
  title,
  detail,
  value,
  tone,
  Icon,
  badge,
  onOpen
}: {
  title: string;
  detail: string;
  value: string | number;
  tone: "yellow" | "green" | "blue" | "red";
  Icon: typeof Home;
  badge?: number;
  onOpen: () => void;
}) {
  return (
    <button className={`admin-section-card admin-section-card-${tone}`} type="button" onClick={onOpen}>
      {badge ? <span className="admin-section-badge">{badge}</span> : null}
      <span className="admin-section-icon">
        <Icon size={22} />
      </span>
      <span>
        <small>{title}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </span>
    </button>
  );
}

function AdminSectionModal({
  title,
  eyebrow,
  onClose,
  children
}: {
  title: string;
  eyebrow: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="sheet-dialog admin-section-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-section-title">
        <div className="sheet-heading">
          <div>
            <p className="panel-label">{eyebrow}</p>
            <h2 id="admin-section-title">{title}</h2>
          </div>
          <button className="icon-button" title="Fechar" type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="admin-section-scroll">{children}</div>
      </section>
    </div>
  );
}

function AdminLogRow({ log }: { log: AdminLogEntry }) {
  return (
    <article className={`admin-log-row admin-log-${log.level}`} style={colorStyle(log.clientColor)}>
      <div>
        <p className="panel-label client-label">
          <span className="client-color-dot" />
          {log.clientEmail}
        </p>
        <small>{formatDate(log.timestamp)}</small>
      </div>
      <p>{log.message}</p>
    </article>
  );
}

function AdminDashboard({ userEmail, onLogout }: { userEmail: string; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<AdminRoutesSnapshot>({
    routes: [],
    pendingReactionRoutes: [],
    totals: { routes: 0, validated: 0, reactions: 0, clients: 0 }
  });
  const [usersDashboard, setUsersDashboard] = useState<AdminUsersSnapshot>({ users: [] });
  const [supportDashboard, setSupportDashboard] = useState<AdminSupportMessagesSnapshot>({ messages: [], unread: 0 });
  const [adminLogs, setAdminLogs] = useState<AdminLogEntry[]>([]);
  const [activeSection, setActiveSection] = useState<AdminSection>();
  const [activeAdminTab, setActiveAdminTab] = useState<AdminMainTab>("dashboard");
  const [editor, setEditor] = useState<UserEditorState>();
  const [detail, setDetail] = useState<AdminUserDetail>();
  const [routeDetail, setRouteDetail] = useState<RouteDispatch>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastNotifiedSupportId, setLastNotifiedSupportId] = useState("");
  const [leaderAlert, setLeaderAlert] = useState("");
  const [lastLeaderReactionId, setLastLeaderReactionId] = useState("");
  const [clientFilter, setClientFilter] = useState("all");
  const [routeStatusFilter, setRouteStatusFilter] = useState<RouteStatusFilter>("all");
  const [routeKindFilter, setRouteKindFilter] = useState<RouteKindFilter>("all");
  const [routeHistoryTab, setRouteHistoryTab] = useState<RouteHistoryTab>("automatic");
  const [routeSearch, setRouteSearch] = useState("");
  const [adminLogLevelFilter, setAdminLogLevelFilter] = useState<AdminLogLevelFilter>("all");
  const [adminLogSearch, setAdminLogSearch] = useState("");
  const [lastSeenLogAt, setLastSeenLogAt] = useState(() => new Date().toISOString());
  const [seenAdminCounts, setSeenAdminCounts] = useState({ validations: 0, alerts: 0, clients: 0 });
  const [logToast, setLogToast] = useState<AdminLogEntry>();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState<CleanupTarget>();
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [actionToast, setActionToast] = useState("");
  const [reportStartDate, setReportStartDate] = useState(getCurrentMonthStartInput);
  const [reportEndDate, setReportEndDate] = useState(() => toDateInputValue(new Date()));

  const clientOptions = useMemo(
    () => usersDashboard.users.filter((user) => user.role === "client"),
    [usersDashboard.users]
  );
  const filteredRoutes = useMemo(() => {
    return dashboard.routes.filter((route) => {
      const matchesClient = clientFilter === "all" || route.clientEmail === clientFilter;
      const search = routeSearch.trim().toLowerCase();
      const matchesSearch =
        !search ||
        [
          route.groupName,
          route.groupJid,
          route.clientEmail,
          route.validatedBy,
          ...route.messages,
          ...route.reactions.flatMap((reaction) => [reaction.senderPhone, reaction.leaderName || "", ...(reaction.senderIdentifiers || [])])
        ].some((item) => String(item || "").toLowerCase().includes(search));
      const hasLeaderReaction = route.reactions.some((reaction) => reaction.isAdmin);
      const trigger = getRouteTrigger(route);
      const matchesStatus =
        routeStatusFilter === "all" ||
        (routeStatusFilter === "pending" && getRouteDecisionStatus(route) === "pending") ||
        (routeStatusFilter === "validated" && getRouteDecisionStatus(route) === "validated") ||
        (routeStatusFilter === "rejected" && getRouteDecisionStatus(route) === "rejected") ||
        (routeStatusFilter === "leader" && hasLeaderReaction);
      const matchesKind =
        routeKindFilter === "all" ||
        (routeKindFilter === "automatic" && route.mode === "target" && trigger === "automatic") ||
        (routeKindFilter === "manual" && ["manual", "simulation"].includes(trigger)) ||
        (routeKindFilter === "test" && (route.mode === "test" || ["warmup", "target-simulation"].includes(trigger)));
      return matchesClient && matchesSearch && matchesStatus && matchesKind;
    });
  }, [clientFilter, dashboard.routes, routeKindFilter, routeSearch, routeStatusFilter]);
  const filteredPendingRoutes = useMemo(
    () => dashboard.pendingReactionRoutes.filter((route) => getRouteDecisionStatus(route) === "pending" && (clientFilter === "all" || route.clientEmail === clientFilter)),
    [clientFilter, dashboard.pendingReactionRoutes]
  );
  const filteredLogs = useMemo(() => {
    const search = adminLogSearch.trim().toLowerCase();
    return adminLogs.filter((log) => {
      const matchesClient = clientFilter === "all" || log.clientEmail === clientFilter;
      const matchesLevel = adminLogLevelFilter === "all" || log.level === adminLogLevelFilter;
      const matchesSearch =
        !search ||
        [log.clientEmail, log.level, log.message, log.timestamp].some((item) => String(item || "").toLowerCase().includes(search));
      return matchesClient && matchesLevel && matchesSearch;
    });
  }, [adminLogLevelFilter, adminLogSearch, adminLogs, clientFilter]);
  const filteredSupportMessages = useMemo(
    () => supportDashboard.messages.filter((message) => clientFilter === "all" || message.email === clientFilter),
    [clientFilter, supportDashboard.messages]
  );
  const unreadLogCount = adminLogs.filter((log) => new Date(log.timestamp).getTime() > new Date(lastSeenLogAt).getTime()).length;

  function showAdminToast(message: string) {
    setActionToast(message);
    window.setTimeout(() => setActionToast(""), 1000);
  }

  function applyMonitorSnapshot(snapshot: Awaited<ReturnType<typeof getAdminMonitor>>) {
    setDashboard(snapshot.routes);
    setUsersDashboard(snapshot.users);
    setSupportDashboard(snapshot.support);
    setAdminLogs(snapshot.logs);
    setDetail((current) => {
      if (!current) return current;
      const summary = snapshot.users.users.find((user) => user.email === current.email);
      return {
        ...current,
        ...(summary || {}),
        logs: snapshot.logs.filter((log) => log.clientEmail === current.email).slice(0, 250),
        routes: snapshot.routes.routes.filter((route) => route.clientEmail === current.email)
      };
    });
    setError("");
  }

  function refresh() {
    getAdminMonitor()
      .then(applyMonitorSnapshot)
      .catch((nextError) => {
        if (isAuthError(nextError)) {
          onLogout();
          return;
        }
        setError(nextError instanceof Error ? nextError.message : "Falha ao carregar monitoramento.");
      });
  }

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeAdminMonitor(applyMonitorSnapshot, refresh);
    return unsubscribe;
  }, []);

  useEffect(() => {
    const locked = Boolean(activeSection || detail || routeDetail || leaderAlert);
    if (!locked) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activeSection, detail, routeDetail, leaderAlert]);

  useEffect(() => {
    if (activeSection !== "logs" && activeAdminTab !== "logs") return;
    const newestLog = adminLogs[0];
    if (newestLog) setLastSeenLogAt(newestLog.timestamp);
    setLogToast(undefined);
  }, [activeAdminTab, activeSection, adminLogs]);

  useEffect(() => {
    if (activeSection === "logs" || activeAdminTab === "logs") return;
    const newestLog = adminLogs[0];
    if (!newestLog) return;
    if (new Date(newestLog.timestamp).getTime() <= new Date(lastSeenLogAt).getTime()) return;
    setLogToast(newestLog);
    const timer = window.setTimeout(() => setLogToast(undefined), 5200);
    return () => window.clearTimeout(timer);
  }, [activeAdminTab, activeSection, adminLogs, lastSeenLogAt]);

  useEffect(() => {
    const latestUnread = supportDashboard.messages.find((message) => !message.read);
    if (!latestUnread || latestUnread.id === lastNotifiedSupportId) return;
    setLastNotifiedSupportId(latestUnread.id);

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const audio = new AudioContextClass();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.1, audio.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.28);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.3);
        window.setTimeout(() => void audio.close(), 360);
      }

      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Nova mensagem no painel", {
          body: `${latestUnread.email}: ${latestUnread.message.slice(0, 90)}`
        });
      }
    } catch {
      // O navegador pode bloquear áudio/notificações antes de interação do admin.
    }
  }, [lastNotifiedSupportId, supportDashboard.messages]);

  useEffect(() => {
    const reaction = dashboard.pendingReactionRoutes
      .flatMap((route) => route.reactions)
      .filter((item) => item.isAdmin)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    if (!reaction || reaction.id === lastLeaderReactionId) return;
    setLastLeaderReactionId(reaction.id);
    setLeaderAlert(`Reação do líder${reaction.leaderName ? ` (${reaction.leaderName})` : ""} foi encontrada.`);

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const audio = new AudioContextClass();
        const oscillator = audio.createOscillator();
        const gain = audio.createGain();
        oscillator.frequency.value = 1046;
        gain.gain.setValueAtTime(0.0001, audio.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        oscillator.start();
        oscillator.stop(audio.currentTime + 0.38);
        window.setTimeout(() => void audio.close(), 450);
      }
    } catch {
      // O navegador pode bloquear áudio antes da interação do admin.
    }
  }, [dashboard.pendingReactionRoutes, lastLeaderReactionId]);

  async function saveUser(nextEditor = editor) {
    if (!nextEditor) return;
    setBusy(true);
    try {
      const nextUsers = await saveAdminUser(nextEditor);
      setUsersDashboard(nextUsers);
      setEditor(undefined);
      setError("");
      showAdminToast("Usuário salvo.");
    } catch (nextError) {
      if (isAuthError(nextError)) {
        onLogout();
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Não consegui salvar usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function openDetails(email: string) {
    try {
      setDetail(await getAdminUserDetail(email));
      setError("");
    } catch (nextError) {
      if (isAuthError(nextError)) {
        onLogout();
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Não consegui abrir especificações.");
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setError("Este navegador não suporta notificações.");
      return;
    }
    const permission = await Notification.requestPermission();
    setError(permission === "granted" ? "" : "Permissão de notificação não liberada no navegador.");
  }

  async function readSupportMessage(id: string) {
    try {
      setSupportDashboard(await markSupportMessageRead(id));
      showAdminToast("Notificação marcada como lida.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui marcar a mensagem.");
    }
  }

  async function validateRoute(routeId: string) {
    try {
      setDashboard(await validateAdminRoute(routeId));
      setError("");
      showAdminToast("Rota validada.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui validar a rota.");
    }
  }

  async function rejectRoute(routeId: string) {
    try {
      setDashboard(await rejectAdminRoute(routeId));
      setError("");
      showAdminToast("Rota marcada como não válida.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui rejeitar a rota.");
    }
  }

  function filterRouteClient(email: string) {
    if (!email) return;
    setClientFilter(email);
    setActiveAdminTab("history");
  }

  async function runCleanup(target: CleanupTarget) {
    if (confirmCleanup !== target) {
      setConfirmCleanup(target);
      return;
    }

    setCleanupBusy(true);
    try {
      const snapshot = await clearAdminMaintenance({
        target,
        clientEmail: clientFilter === "all" ? undefined : clientFilter
      });
      applyMonitorSnapshot(snapshot);
      setConfirmCleanup(undefined);
      setError("");
      showAdminToast("Limpeza concluída.");
    } catch (nextError) {
      if (isAuthError(nextError)) {
        onLogout();
        return;
      }
      setError(nextError instanceof Error ? nextError.message : "Não consegui apagar os dados.");
    } finally {
      setCleanupBusy(false);
    }
  }

  const activeClientLabel = clientFilter === "all" ? "Todos os clientes" : clientFilter;
  const filteredUnreadSupport = filteredSupportMessages.filter((message) => !message.read).length;
  const onlineClients = usersDashboard.users.filter((user) => user.role === "client" && user.presenceStatus === "online").length;
  const visibleUserMetrics = usersDashboard.users
    .filter((user) => clientFilter === "all" || user.email === clientFilter)
    .map((user) => user.performanceMetrics)
    .filter((metrics): metrics is NonNullable<AdminUserSummary["performanceMetrics"]> => Boolean(metrics?.dispatchCount));
  const averageDispatchLatency = visibleUserMetrics.length
    ? Math.round(visibleUserMetrics.reduce((total, metrics) => total + metrics.averageDispatchLatencyMs, 0) / visibleUserMetrics.length)
    : 0;
  const lastDispatchLatency = visibleUserMetrics.reduce((latest, metrics) => Math.max(latest, metrics.lastDispatchLatencyMs || 0), 0);
  const automaticRoutes = filteredRoutes.filter((route) => route.mode === "target" && getRouteTrigger(route) === "automatic");
  const manualRoutes = filteredRoutes.filter((route) => ["manual", "simulation"].includes(getRouteTrigger(route)));
  const testRoutes = filteredRoutes.filter((route) => route.mode === "test" || ["warmup", "target-simulation"].includes(getRouteTrigger(route)));
  const latestTestRoute = testRoutes[0];
  const validatedRoutes = filteredRoutes.filter((route) => getRouteDecisionStatus(route) === "validated");
  const rejectedRoutes = filteredRoutes.filter((route) => getRouteDecisionStatus(route) === "rejected");
  const liveActivity = [
    ...filteredLogs.slice(0, 6).map((log) => ({
      id: `log-${log.clientEmail}-${log.id}`,
      time: log.timestamp,
      title: log.message,
      detail: log.clientEmail,
      tone: log.level === "error" ? "red" : log.level === "success" ? "green" : "blue"
    })),
    ...filteredRoutes.slice(0, 4).map((route) => ({
      id: `route-${route.id}`,
      time: route.updatedAt,
      title: `${getRouteTriggerLabel(route)} · ${route.confirmedCount}/${route.totalCount} enviada(s)`,
      detail: `${route.groupName || route.groupJid} · ${route.clientEmail}`,
      tone: route.mode === "test" ? "purple" : "yellow"
    }))
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 8);
  const alerts = [
    ...filteredPendingRoutes.map((route) => ({
      id: `pending-${route.id}`,
      title: "Validação pendente",
      detail: `${route.groupName || route.groupJid} · ${route.reactions.length} reação(ões)`,
      time: route.updatedAt,
      tone: "red" as const
    })),
    ...filteredSupportMessages.filter((message) => !message.read).map((message) => ({
      id: `support-${message.id}`,
      title: "Mensagem de suporte",
      detail: `${message.email}: ${message.message}`,
      time: message.createdAt,
      tone: "yellow" as const
    })),
    ...filteredLogs.filter((log) => log.level === "error").slice(0, 8).map((log) => ({
      id: `error-${log.clientEmail}-${log.id}`,
      title: "Erro no bot",
      detail: `${log.clientEmail}: ${log.message}`,
      time: log.timestamp,
      tone: "red" as const
    }))
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 30);

  useEffect(() => {
    if (activeAdminTab === "validations") {
      setSeenAdminCounts((current) => ({ ...current, validations: filteredPendingRoutes.length }));
    }
    if (notificationsOpen) {
      setSeenAdminCounts((current) => ({ ...current, alerts: alerts.length }));
    }
    if (activeAdminTab === "clients") {
      setSeenAdminCounts((current) => ({ ...current, clients: onlineClients }));
    }
  }, [activeAdminTab, notificationsOpen, filteredPendingRoutes.length, alerts.length, onlineClients]);

  const reportPeriodLabel = formatReportDateRange(reportStartDate, reportEndDate);
  const monthlyReport = useMemo(() => {
    const { startMs, endMs } = parseDateRange(reportStartDate, reportEndDate);
    return clientOptions.map((user) => {
      const routes = dashboard.routes.filter((route) => {
        const created = new Date(route.createdAt);
        const createdMs = created.getTime();
        return route.clientEmail === user.email && createdMs >= startMs && createdMs <= endMs;
      });
      const valid = routes.filter((route) => getRouteDecisionStatus(route) === "validated").length;
      const rejected = routes.filter((route) => getRouteDecisionStatus(route) === "rejected").length;
      const pending = routes.filter((route) => getRouteDecisionStatus(route) === "pending").length;
      const sent = routes.filter((route) => route.confirmedCount > 0).length;
      const activeDays = new Set(routes.map((route) => new Date(route.createdAt).toISOString().slice(0, 10))).size;
      const successRate = routes.length ? Math.round((valid / routes.length) * 100) : 0;
      const pickupRate = routes.length ? Math.round((sent / routes.length) * 100) : 0;
      const lastRoute = [...routes].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
      const messageCounts = new Map<string, number>();
      routes.forEach((route) => {
        const label = route.ocr?.bairro || route.ocr?.route || route.messages[0] || "Sem mensagem";
        messageCounts.set(label, (messageCounts.get(label) || 0) + 1);
      });
      const topRoutes = Array.from(messageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, count]) => `${label} (${count})`);
      return { user, routes, valid, rejected, pending, sent, activeDays, successRate, pickupRate, lastRoute, topRoutes };
    }).sort((a, b) => b.valid - a.valid || b.sent - a.sent || b.routes.length - a.routes.length);
  }, [clientOptions, dashboard.routes, reportEndDate, reportStartDate]);

  const adminTabs: Array<{ id: AdminMainTab; label: string; Icon: typeof Home; badge?: number }> = [
    { id: "dashboard", label: "Dashboard", Icon: Home },
    { id: "validations", label: "Validações", Icon: ShieldCheck, badge: activeAdminTab === "validations" ? 0 : Math.max(0, filteredPendingRoutes.length - seenAdminCounts.validations) },
    { id: "history", label: "Histórico", Icon: Clock3 },
    { id: "logs", label: "Logs", Icon: Activity, badge: activeAdminTab === "logs" ? 0 : unreadLogCount },
    { id: "reports", label: "Relatório", Icon: Gauge },
    { id: "clients", label: "Clientes", Icon: UserPlus, badge: activeAdminTab === "clients" ? 0 : Math.max(0, onlineClients - seenAdminCounts.clients) },
    { id: "settings", label: "Config", Icon: Settings }
  ];

  return (
    <main className="app-shell admin-shell admin-mobile-shell">
      <section className="admin-mobile-header">
        <span className="admin-app-icon">{activeAdminTab === "validations" ? <ShieldCheck size={25} /> : <Activity size={24} />}</span>
        <div>
          <h1>{activeAdminTab === "validations" ? "Validações e histórico" : activeAdminTab === "history" ? "Histórico permanente" : activeAdminTab === "logs" ? "Logs ao vivo" : activeAdminTab === "reports" ? "Relatório mensal" : activeAdminTab === "clients" ? "Clientes" : activeAdminTab === "settings" ? "Configurações" : "Central de comando"}</h1>
          <p>
            {activeAdminTab === "dashboard" ? "Dados ao vivo de todos os clientes" : activeAdminTab === "validations" ? "Monitore, valide e audite todas as rotas do bot" : activeClientLabel}
            {activeAdminTab === "dashboard" ? <span className="online-copy">Tudo online</span> : null}
          </p>
        </div>
        <button className="icon-button alert-button" title="Notificações" type="button" onClick={() => setNotificationsOpen((current) => !current)}>
          {Math.max(0, alerts.length - seenAdminCounts.alerts) ? <b>{Math.max(0, alerts.length - seenAdminCounts.alerts)}</b> : null}
          <Bell size={20} />
        </button>
        <button className="button admin-filter-button" title="Configurações" type="button" onClick={() => setActiveAdminTab("settings")}>
          <Settings size={18} />
          Config
        </button>
        {notificationsOpen ? (
          <section className="notification-popover">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Notificações</p>
                <h2>{alerts.length} recentes</h2>
              </div>
              <button className="icon-button" title="Fechar" type="button" onClick={() => setNotificationsOpen(false)}>
                <X size={18} />
              </button>
            </div>
            <div className="alert-list compact">
              {alerts.length ? alerts.slice(0, 8).map((alert) => (
                <article className={`alert-row tone-${alert.tone}`} key={`bell-${alert.id}`}>
                  <AlertTriangle size={17} />
                  <div>
                    <strong>{alert.title}</strong>
                    <p>{alert.detail}</p>
                  </div>
                  <time>{formatShortDate(alert.time)}</time>
                </article>
              )) : <p className="qr-empty">Nenhuma notificação.</p>}
            </div>
          </section>
        ) : null}
      </section>

      <section className="admin-mobile-filters">
        <label>
          <span>Cliente</span>
          <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
            <option value="all">Todos os clientes</option>
            {clientOptions.map((user) => (
              <option key={user.email} value={user.email}>{user.email}</option>
            ))}
          </select>
        </label>
        <button className="button" type="button" onClick={refresh}>
          <RefreshCw size={18} />
          Atualizar
        </button>
      </section>

      {activeAdminTab === "dashboard" ? (
        <section className="admin-tab-page">
          <section className="command-metrics-grid">
            <AdminMetric Icon={UserPlus} tone="green" title="Clientes online" value={onlineClients} detail="agora" />
            <AdminMetric Icon={Send} tone="yellow" title="Disparos hoje" value={filteredRoutes.length} detail={`${validatedRoutes.length} validadas`} />
            <AdminMetric Icon={MessageSquareText} tone="blue" title="Reações" value={filteredRoutes.reduce((total, route) => total + route.reactions.length, 0)} detail="recebidas" />
            <AdminMetric Icon={Activity} tone="blue" title="Logs ao vivo" value={filteredLogs.length} detail="agora" />
            <AdminMetric Icon={Route} tone="green" title="Grupos ativos" value={new Set(filteredRoutes.map((route) => route.groupJid).filter(Boolean)).size} detail="estáveis" />
            <AdminMetric Icon={Zap} tone="yellow" title="Latência média" value={averageDispatchLatency ? `${averageDispatchLatency}ms` : "0ms"} detail={lastDispatchLatency ? `último ${lastDispatchLatency}ms` : "sem disparos"} />
          </section>

          <article className="command-card queue-card">
            <span className="command-card-icon"><Send size={22} /></span>
            <div>
              <h2>Fila de envio</h2>
              <p>{filteredRoutes.filter((route) => route.status === "sending").length} mensagens aguardando</p>
              <div className="queue-progress" aria-hidden="true">
                <span style={{ width: `${Math.min(100, Math.max(8, filteredRoutes.filter((route) => route.status === "sending").length * 22))}%` }} />
              </div>
            </div>
            <button className="button" type="button" onClick={() => setActiveAdminTab("history")}>Ver fila</button>
          </article>

          <article className="command-card validation-card">
            <span className="command-card-icon danger"><AlertTriangle size={22} /></span>
            <div>
              <h2>Validações pendentes</h2>
              <p>Fila aberta · aguardando validação manual</p>
              <div className="validation-mini-row">
                <span>Na fila <b>{filteredPendingRoutes.length}</b></span>
                <span>Aguardando líder <b>{filteredPendingRoutes.filter((route) => route.reactions.some((reaction) => reaction.isAdmin)).length}</b></span>
                <span>Prontas <b>{filteredPendingRoutes.filter((route) => route.reactions.length).length}</b></span>
              </div>
            </div>
            <strong>{filteredPendingRoutes.length}</strong>
            <button className="button" type="button" onClick={() => setActiveAdminTab("validations")}>Abrir fila</button>
          </article>

          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Atividade ao vivo</p>
                <h2>Últimos eventos</h2>
              </div>
              <button className="button" type="button" onClick={() => setNotificationsOpen(true)}>Ver tudo</button>
            </div>
            <div className="live-activity-list">
              {liveActivity.length ? liveActivity.map((item) => (
                <div className={`live-activity-row tone-${item.tone}`} key={item.id}>
                  <span />
                  <time>{new Date(item.time).toLocaleTimeString("pt-BR")}</time>
                  <p>{item.title}</p>
                  <small>{item.detail}</small>
                </div>
              )) : <p className="qr-empty">Nenhuma atividade ainda.</p>}
            </div>
          </article>

          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Histórico por origem</p>
                <h2>Resumo</h2>
              </div>
              <button className="button" type="button" onClick={() => setActiveAdminTab("history")}>Ver tudo</button>
            </div>
            <div className="origin-summary-grid">
              <button type="button" onClick={() => { setRouteKindFilter("automatic"); setActiveAdminTab("history"); }}>
                <Zap size={22} />
                <strong>{automaticRoutes.length}</strong>
                <span>Automático</span>
                <small>Abertura real do grupo alvo</small>
              </button>
              <button type="button" onClick={() => { setRouteKindFilter("manual"); setActiveAdminTab("history"); }}>
                <Send size={22} />
                <strong>{manualRoutes.length}</strong>
                <span>Manual / Simulação</span>
                <small>Clique manual e simulação</small>
              </button>
              <button type="button" onClick={() => { setRouteKindFilter("test"); setActiveAdminTab("history"); }}>
                <TestTube2 size={22} />
                <strong>{testRoutes.length}</strong>
                <span>Teste / mensagens</span>
                <small>Aquecimento e simulação alvo</small>
              </button>
            </div>
          </article>

          <article className="command-card test-monitor-card">
            <span className="command-card-icon purple"><TestTube2 size={22} /></span>
            <div>
              <h2>Grupo de teste</h2>
              <p>{latestTestRoute?.groupName || "Sem teste recente"}</p>
              <small>{latestTestRoute ? `${latestTestRoute.clientEmail} · ${latestTestRoute.confirmedCount}/${latestTestRoute.totalCount} mensagens` : "Apenas monitoramento no admin"}</small>
            </div>
            <button className="button" type="button" onClick={() => { setRouteKindFilter("test"); setActiveAdminTab("history"); }}>Ver detalhes</button>
          </article>

          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Alertas e notificações</p>
                <h2>Recentes</h2>
              </div>
              <button className="button" type="button" onClick={() => setNotificationsOpen(true)}>Ver todas</button>
            </div>
            <div className="alert-list compact">
              {alerts.slice(0, 3).length ? alerts.slice(0, 3).map((alert) => (
                <article className={`alert-row tone-${alert.tone}`} key={`dash-${alert.id}`}>
                  <AlertTriangle size={18} />
                  <div>
                    <strong>{alert.title}</strong>
                    <p>{alert.detail}</p>
                  </div>
                  <time>{formatShortDate(alert.time)}</time>
                </article>
              )) : (
                <article className="alert-row tone-info">
                  <Info size={18} />
                  <div>
                    <strong>O bot está online no momento</strong>
                    <p>Aguardando novos eventos de clientes.</p>
                  </div>
                  <time>agora</time>
                </article>
              )}
            </div>
          </article>
        </section>
      ) : null}

      {activeAdminTab === "validations" ? (
        <section className="admin-tab-page">
          <div className="admin-subtabs">
            <button className={routeStatusFilter === "pending" ? "active" : ""} type="button" onClick={() => setRouteStatusFilter("pending")}>Pendentes <b>{filteredPendingRoutes.length}</b></button>
            <button className={routeStatusFilter === "validated" ? "active" : ""} type="button" onClick={() => setRouteStatusFilter("validated")}>Validadas <b>{validatedRoutes.length}</b></button>
            <button className={routeStatusFilter === "rejected" ? "active" : ""} type="button" onClick={() => setRouteStatusFilter("rejected")}>Não válidas <b>{rejectedRoutes.length}</b></button>
            <button className={routeStatusFilter === "all" ? "active" : ""} type="button" onClick={() => setRouteStatusFilter("all")}>Histórico</button>
          </div>
          <section className="command-metrics-grid compact">
            <AdminMetric Icon={AlertTriangle} tone="red" title="Pendentes" value={filteredPendingRoutes.length} detail="para validar" />
            <AdminMetric Icon={CheckCircle2} tone="green" title="Validadas" value={validatedRoutes.length} detail="no período" />
            <AdminMetric Icon={MessageSquareText} tone="yellow" title="Reações" value={filteredRoutes.reduce((total, route) => total + route.reactions.length, 0)} detail="recebidas" />
            <AdminMetric Icon={UserPlus} tone="blue" title="Clientes online" value={onlineClients} detail="no momento" />
          </section>
          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Fila de validação</p>
                <h2>{filteredPendingRoutes.length} pendente(s)</h2>
              </div>
              <button className="button accent" type="button" onClick={() => filteredPendingRoutes.forEach((route) => void validateRoute(route.id))}>Validar todas</button>
            </div>
            <div className="validation-list">
              {filteredPendingRoutes.length ? filteredPendingRoutes.map((route) => (
                <RouteRow
                  key={`mobile-pending-${route.id}`}
                  route={route}
                  onValidate={() => validateRoute(route.id)}
                  onReject={() => rejectRoute(route.id)}
                  onFilterClient={() => filterRouteClient(route.clientEmail)}
                  onDetails={() => setRouteDetail(route)}
                />
              )) : <p className="qr-empty">Nenhuma validação pendente.</p>}
            </div>
          </article>
          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Validadas recentemente</p>
                <h2>Auditoria</h2>
              </div>
            </div>
            <div className="validation-list">
              {validatedRoutes.slice(0, 8).map((route) => (
                <RouteRow
                  key={`mobile-validated-${route.id}`}
                  route={route}
                  onFilterClient={() => filterRouteClient(route.clientEmail)}
                  onDetails={() => setRouteDetail(route)}
                />
              ))}
            </div>
          </article>
          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Não válidas</p>
                <h2>{rejectedRoutes.length} rejeitada(s)</h2>
              </div>
            </div>
            <div className="validation-list">
              {rejectedRoutes.slice(0, 8).map((route) => (
                <RouteRow
                  key={`mobile-rejected-${route.id}`}
                  route={route}
                  onValidate={() => validateRoute(route.id)}
                  onFilterClient={() => filterRouteClient(route.clientEmail)}
                  onDetails={() => setRouteDetail(route)}
                />
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {activeAdminTab === "history" ? (
        <section className="admin-tab-page">
          <section className="history-filter-bar">
            <label className="history-search">
              <Search size={18} />
              <input
                value={routeSearch}
                onChange={(event) => setRouteSearch(event.target.value)}
                placeholder="Buscar por grupo, cliente ou e-mail..."
              />
            </label>
            <button className="button" type="button">
              <CalendarDays size={18} />
              Período
            </button>
            <label>
              <select value={routeStatusFilter} onChange={(event) => setRouteStatusFilter(event.target.value as RouteStatusFilter)}>
                <option value="all">Todos</option>
                <option value="pending">Pendentes</option>
                <option value="validated">Validadas</option>
                <option value="rejected">Não válidas</option>
                <option value="leader">Com líder</option>
              </select>
            </label>
            <label>
              <select value={routeKindFilter} onChange={(event) => setRouteKindFilter(event.target.value as RouteKindFilter)}>
                <option value="all">Origem</option>
                <option value="automatic">Automático</option>
                <option value="manual">Manual / simulação</option>
                <option value="test">Teste</option>
              </select>
            </label>
          </section>
          <AdminRouteHistory
            automaticRoutes={automaticRoutes}
            manualRoutes={manualRoutes}
            testRoutes={testRoutes}
            activeTab={routeHistoryTab}
            onTabChange={setRouteHistoryTab}
            onValidate={validateRoute}
            onReject={rejectRoute}
            onFilterClient={filterRouteClient}
            onDetails={setRouteDetail}
          />
        </section>
      ) : null}

      {activeAdminTab === "logs" ? (
        <section className="admin-tab-page">
          <section className="history-filter-bar">
            <label className="history-search">
              <Search size={18} />
              <input
                value={adminLogSearch}
                onChange={(event) => setAdminLogSearch(event.target.value)}
                placeholder="Buscar log, cliente, erro, imagem..."
              />
            </label>
            <label>
              <select value={adminLogLevelFilter} onChange={(event) => setAdminLogLevelFilter(event.target.value as AdminLogLevelFilter)}>
                <option value="all">Todos os níveis</option>
                <option value="success">Sucesso</option>
                <option value="info">Info</option>
                <option value="warning">Avisos</option>
                <option value="error">Erros</option>
              </select>
            </label>
            <button className="button" type="button" onClick={() => { setAdminLogSearch(""); setAdminLogLevelFilter("all"); }}>
              Limpar filtro
            </button>
          </section>

          <section className="command-metrics-grid compact">
            <AdminMetric Icon={Activity} tone="blue" title="Logs visíveis" value={filteredLogs.length} detail={activeClientLabel} />
            <AdminMetric Icon={CheckCircle2} tone="green" title="Sucessos" value={filteredLogs.filter((log) => log.level === "success").length} detail="eventos ok" />
            <AdminMetric Icon={AlertTriangle} tone="yellow" title="Avisos" value={filteredLogs.filter((log) => log.level === "warning").length} detail="atenção" />
            <AdminMetric Icon={Ban} tone="red" title="Erros" value={filteredLogs.filter((log) => log.level === "error").length} detail="falhas" />
          </section>

          <article className="command-panel admin-live-log-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Tempo real por cliente</p>
                <h2>{filteredLogs.length} evento(s)</h2>
              </div>
              <button className="button" type="button" onClick={refresh}>
                <RefreshCw size={18} />
                Atualizar
              </button>
            </div>
            <div className="admin-log-list full">
              {filteredLogs.length ? filteredLogs.map((log) => (
                <AdminLogRow key={`tab-${log.clientEmail}-${log.id}`} log={log} />
              )) : <p className="qr-empty">Nenhum log encontrado com os filtros atuais.</p>}
            </div>
          </article>
        </section>
      ) : null}

      {activeAdminTab === "reports" ? (
        <section className="admin-tab-page">
          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Relatório</p>
                <h2>{reportPeriodLabel}</h2>
              </div>
              <button className="button" type="button" onClick={() => { setClientFilter("all"); setRouteStatusFilter("validated"); setActiveAdminTab("history"); }}>Abrir validadas</button>
            </div>
            <div className="report-date-filter">
              <label>
                <CalendarDays size={18} />
                <span>Data inicial</span>
                <input type="date" value={reportStartDate} onChange={(event) => setReportStartDate(event.target.value)} />
              </label>
              <label>
                <CalendarDays size={18} />
                <span>Data final</span>
                <input type="date" value={reportEndDate} onChange={(event) => setReportEndDate(event.target.value)} />
              </label>
            </div>
            <div className="report-list">
              {monthlyReport.length ? monthlyReport.map((item) => (
                <article className="report-row" key={`report-${item.user.email}`} style={colorStyle(item.user.color)}>
                  <div className="report-client">
                    <span className="client-color-dot" />
                    <div>
                      <strong>{item.user.email}</strong>
                      <p>{item.routes.length} rota(s) no período</p>
                    </div>
                  </div>
                  <div className="report-stats">
                    <span className="report-stat ok"><small>Válidas</small><b>{item.valid}</b></span>
                    <span className="report-stat warn"><small>Pendentes</small><b>{item.pending}</b></span>
                    <span className="report-stat danger"><small>Não válidas</small><b>{item.rejected}</b></span>
                    <span className="report-stat"><small>Pegas</small><b>{item.sent}</b></span>
                    <span className="report-stat ok"><small>Aproveit.</small><b>{item.successRate}%</b></span>
                    <span className="report-stat"><small>Dias</small><b>{item.activeDays}</b></span>
                  </div>
                  <div className="report-route-summary">
                    <span>Última: {item.lastRoute ? formatShortDate(item.lastRoute.createdAt) : "sem rota"}</span>
                    <span>{item.topRoutes.length ? `Mais recorrentes: ${item.topRoutes.join(" | ")}` : "Sem recorrência no período"}</span>
                    <span>Taxa de envio: {item.pickupRate}%</span>
                  </div>
                  <button className="button" type="button" onClick={() => { setClientFilter(item.user.email); setRouteStatusFilter("validated"); setActiveAdminTab("history"); }}>Ver</button>
                </article>
              )) : <p className="qr-empty">Nenhum cliente no relatório.</p>}
            </div>
          </article>
          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Resumo geral</p>
                <h2>{monthlyReport.reduce((total, item) => total + item.valid, 0)} rotas válidas</h2>
              </div>
            </div>
            <section className="command-metrics-grid compact">
              <AdminMetric Icon={CheckCircle2} tone="green" title="Válidas" value={monthlyReport.reduce((total, item) => total + item.valid, 0)} detail="no mês" />
              <AdminMetric Icon={Clock3} tone="yellow" title="Pendentes" value={monthlyReport.reduce((total, item) => total + item.pending, 0)} detail="aguardando" />
              <AdminMetric Icon={Ban} tone="red" title="Não válidas" value={monthlyReport.reduce((total, item) => total + item.rejected, 0)} detail="julgadas" />
              <AdminMetric Icon={Send} tone="blue" title="Pegas" value={monthlyReport.reduce((total, item) => total + item.sent, 0)} detail="enviadas no período" />
            </section>
          </article>
        </section>
      ) : null}

      {activeAdminTab === "settings" ? (
        <section className="admin-tab-page">
          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Configurações</p>
                <h2>Admin</h2>
              </div>
            </div>
            <section className="admin-settings-grid">
              <div className="admin-settings-panel">
                <p className="panel-label">Notificações</p>
                <h2>Sino do painel</h2>
                <p>Receba avisos de rotas pendentes, suporte e erros do bot.</p>
                <button className="button primary" type="button" onClick={enableNotifications}>Ativar notificações</button>
              </div>
              <div className="admin-settings-panel">
                <p className="panel-label">Filtros</p>
                <h2>Visão atual</h2>
                <p>{activeClientLabel}</p>
                <button className="button" type="button" onClick={() => { setClientFilter("all"); setRouteKindFilter("all"); setRouteStatusFilter("all"); showAdminToast("Filtros resetados."); }}>Resetar filtros</button>
              </div>
              <div className="admin-settings-panel danger">
                <p className="panel-label">Sessão</p>
                <h2>Sair</h2>
                <p>Encerra seu acesso nesse navegador.</p>
                <button className="button danger" type="button" onClick={onLogout}>
                  <LogOut size={18} />
                  Sair do usuário
                </button>
              </div>
            </section>
          </article>
        </section>
      ) : null}

      {activeAdminTab === "clients" ? (
        <section className="admin-tab-page">
          <article className="command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Clientes</p>
                <h2>{usersDashboard.users.length} usuário(s)</h2>
              </div>
              <button className="button primary" type="button" onClick={() => setEditor(emptyUserEditor)}>
                <UserPlus size={18} />
                Adicionar
              </button>
            </div>
            {editor ? (
              <UserEditor
                value={editor}
                onChange={setEditor}
                onCancel={() => setEditor(undefined)}
                onSave={() => saveUser()}
                busy={busy}
              />
            ) : null}
            <div className="user-list">
              {usersDashboard.users.map((user) => (
                <AdminUserRow
                  key={user.email}
                  user={user}
                  onDetails={() => openDetails(user.email)}
                  onEdit={() => setEditor({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: user.blocked, color: user.color })}
                  onToggleBlock={() => saveUser({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: !user.blocked, color: user.color })}
                />
              ))}
            </div>
          </article>
        </section>
      ) : null}

      <nav className="bottom-nav admin-bottom-nav" aria-label="Navegação do admin">
        {adminTabs.map(({ id, label, Icon, badge }) => (
          <button className={activeAdminTab === id ? "active" : ""} key={id} type="button" onClick={() => setActiveAdminTab(id)}>
            {badge ? <b className="nav-badge">{badge}</b> : null}
            <Icon size={22} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {error ? <p className="login-error">{error}</p> : null}

      {activeSection === "reactions" ? (
        <AdminSectionModal eyebrow="Validação" title="Reações para validar" onClose={() => setActiveSection(undefined)}>
          <div className="admin-section-summary">
            <strong>{filteredPendingRoutes.length}</strong>
            <span>rotas com reação aguardando sua confirmação em {activeClientLabel}.</span>
          </div>
          <div className="route-list">
            {filteredPendingRoutes.length ? (
              filteredPendingRoutes.map((route) => (
                <RouteRow
                  key={`pending-${route.id}`}
                  route={route}
                  onValidate={() => validateRoute(route.id)}
                  onReject={() => rejectRoute(route.id)}
                  onFilterClient={() => filterRouteClient(route.clientEmail)}
                  onDetails={() => setRouteDetail(route)}
                />
              ))
            ) : (
              <p className="qr-empty">Nenhuma reação pendente de validação.</p>
            )}
          </div>
        </AdminSectionModal>
      ) : null}

      {activeSection === "logs" ? (
        <AdminSectionModal eyebrow="Tempo real" title="Logs dos bots" onClose={() => setActiveSection(undefined)}>
          <div className="admin-section-summary">
            <strong>{filteredLogs.length}</strong>
            <span>eventos em tempo real para {activeClientLabel}. Abrir esta tela marca os logs como vistos.</span>
          </div>
          <div className="admin-log-list">
            {filteredLogs.length ? filteredLogs.map((log) => <AdminLogRow key={`${log.clientEmail}-${log.id}`} log={log} />) : <p className="qr-empty">Nenhum log recebido ainda.</p>}
          </div>
        </AdminSectionModal>
      ) : null}

      {activeSection === "routes" ? (
        <AdminSectionModal eyebrow="Histórico" title="Últimos 100 disparos" onClose={() => setActiveSection(undefined)}>
          <div className="admin-section-summary">
            <strong>{filteredRoutes.length}</strong>
            <span>histórico separado por origem com cliente: {activeClientLabel}.</span>
          </div>
          <AdminRouteHistory
            automaticRoutes={automaticRoutes}
            manualRoutes={manualRoutes}
            testRoutes={testRoutes}
            activeTab={routeHistoryTab}
            onTabChange={setRouteHistoryTab}
            onValidate={validateRoute}
            onReject={rejectRoute}
            onFilterClient={filterRouteClient}
            onDetails={setRouteDetail}
          />
        </AdminSectionModal>
      ) : null}

      {activeSection === "users" ? (
        <AdminSectionModal eyebrow="Acessos" title="Usuários do painel" onClose={() => setActiveSection(undefined)}>
          <div className="panel-heading">
            <div>
              <p className="panel-label">Controle</p>
              <h2>Gerenciar acessos</h2>
            </div>
            <button className="button primary" type="button" onClick={() => setEditor(emptyUserEditor)}>
              <UserPlus size={18} />
              Adicionar
            </button>
          </div>
          {editor ? (
            <UserEditor
              value={editor}
              onChange={setEditor}
              onCancel={() => setEditor(undefined)}
              onSave={() => saveUser()}
              busy={busy}
            />
          ) : null}
          <div className="user-list">
            {usersDashboard.users.map((user) => (
              <AdminUserRow
                key={user.email}
                user={user}
                onDetails={() => openDetails(user.email)}
                onEdit={() => setEditor({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: user.blocked, color: user.color })}
                onToggleBlock={() => saveUser({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: !user.blocked, color: user.color })}
              />
            ))}
          </div>
        </AdminSectionModal>
      ) : null}

      {activeSection === "support" ? (
        <AdminSectionModal eyebrow="Chat interno" title="Mensagens dos clientes" onClose={() => setActiveSection(undefined)}>
          <div className="panel-heading">
            <div>
              <p className="panel-label">Notificações</p>
              <h2>{filteredUnreadSupport} não lida(s)</h2>
            </div>
            <button className="button" type="button" onClick={enableNotifications}>
              Ativar notificação
            </button>
          </div>
          <div className="support-message-list">
            {filteredSupportMessages.length ? filteredSupportMessages.map((message) => (
              <SupportMessageRow key={message.id} message={message} onMarkRead={() => readSupportMessage(message.id)} />
            )) : <p className="qr-empty">Nenhuma mensagem de cliente ainda.</p>}
          </div>
        </AdminSectionModal>
      ) : null}

      {activeSection === "settings" ? (
        <AdminSectionModal eyebrow="Configurações" title="Preferências do admin" onClose={() => { setActiveSection(undefined); setConfirmLogout(false); setConfirmCleanup(undefined); }}>
          <section className="admin-settings-grid">
            <div className="admin-settings-panel">
              <p className="panel-label">Notificações</p>
              <h2>Alertas do navegador</h2>
              <p>Use isso para receber aviso quando cliente chamar no painel ou quando aparecer reação importante.</p>
              <button className="button primary" type="button" onClick={enableNotifications}>
                Ativar notificações
              </button>
            </div>
            <div className="admin-settings-panel">
              <p className="panel-label">Filtro padrão</p>
              <h2>Visão atual</h2>
              <p>{activeClientLabel} · {routeKindFilter === "all" ? "todos os tipos" : "tipo filtrado"} · {routeStatusFilter === "all" ? "todos os status" : "status filtrado"}</p>
              <button className="button" type="button" onClick={() => { setClientFilter("all"); setRouteKindFilter("all"); setRouteStatusFilter("all"); }}>
                Resetar filtros
              </button>
            </div>
            <div className="admin-settings-panel danger">
              <p className="panel-label">Sessão</p>
              <h2>Sair do painel</h2>
              <p>A saída fica aqui para evitar clique sem querer durante monitoramento de rota.</p>
              {!confirmLogout ? (
                <button className="button" type="button" onClick={() => setConfirmLogout(true)}>
                  <LogOut size={18} />
                  Mostrar botão de sair
                </button>
              ) : (
                <button className="button danger" type="button" onClick={onLogout}>
                  Confirmar saída
                </button>
              )}
            </div>
            <div className="admin-settings-panel danger cleanup-panel">
              <p className="panel-label">Limpeza</p>
              <h2>Apagar históricos</h2>
              <p>Escopo: {activeClientLabel}. Use um filtro de cliente antes se quiser apagar só um cliente.</p>
              <div className="cleanup-actions">
                {[
                  { target: "logs" as CleanupTarget, label: "Logs do bot" },
                  { target: "routes" as CleanupTarget, label: "Histórico de disparos" },
                  { target: "support" as CleanupTarget, label: "Mensagens suporte" },
                  { target: "all" as CleanupTarget, label: "Tudo acima" }
                ].map((item) => (
                  <button
                    className={confirmCleanup === item.target ? "button danger" : "button"}
                    disabled={cleanupBusy}
                    key={item.target}
                    type="button"
                    onClick={() => runCleanup(item.target)}
                  >
                    {confirmCleanup === item.target ? `Confirmar: ${item.label}` : `Apagar ${item.label}`}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </AdminSectionModal>
      ) : null}

      {detail ? <UserDetailModal detail={detail} onClose={() => setDetail(undefined)} /> : null}
      {routeDetail ? <RouteDetailModal route={routeDetail} onClose={() => setRouteDetail(undefined)} /> : null}
      {actionToast ? <div className="action-toast">{actionToast}</div> : null}
      {logToast ? (
        <button className="admin-log-toast" type="button" onClick={() => setActiveSection("logs")}>
          <span>{unreadLogCount}</span>
          <div>
            <strong>Novo log</strong>
            <small>{logToast.clientEmail}</small>
            <p>{logToast.message}</p>
          </div>
        </button>
      ) : null}
      {leaderAlert ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="leader-alert-title">
            <p className="panel-label">Atenção</p>
            <h2 id="leader-alert-title">Reação encontrada</h2>
            <p className="confirmation-message">{leaderAlert}</p>
            <div className="confirmation-actions">
              <button className="button primary" type="button" onClick={() => setLeaderAlert("")}>
                Ver rotas
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function RomaneioPanel({
  romaneio,
  settingsDraft,
  locateResult,
  busy,
  onSettingsChange,
  onLocate,
  onUpload,
  onConfirmCandidate,
  onSaveSettings,
  error
}: {
  romaneio: RomaneioSnapshot;
  settingsDraft: RomaneioSettings;
  locateResult: RomaneioLocateResult;
  busy: boolean;
  onSettingsChange: (settings: RomaneioSettings) => void;
  onLocate: () => void;
  onUpload: (file: File) => void;
  onConfirmCandidate: (candidate: RomaneioCandidate) => void;
  onSaveSettings: () => void;
  error: string;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const topRoutes = romaneio.routes.slice(0, 12);
  const lastUpload = romaneio.status.uploadedAt ? new Date(romaneio.status.uploadedAt).toLocaleString("pt-BR") : "Nenhum";

  function updateNumber(key: "distanciaMaxKm" | "paradasMax" | "pacotesMax", value: string) {
    const parsed = Number(value);
    onSettingsChange({
      ...settingsDraft,
      [key]: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
    });
  }

  return (
    <section className="mobile-home">
      <section className="quick-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-label">Análise de Romaneio</p>
            <h2>{romaneio.status.loaded ? `${romaneio.status.totalRoutes} rota(s)` : "Nenhum arquivo carregado"}</h2>
          </div>
          <div className="romaneio-source-actions">
            <input
              ref={fileInputRef}
              className="visually-hidden-file"
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
            <button className="button" disabled={busy} type="button" onClick={() => fileInputRef.current?.click()}>
              <FileUp size={18} />
              Enviar do aparelho
            </button>
            <button className="button primary" disabled={busy} type="button" onClick={onLocate}>
              Localizar no grupo
            </button>
          </div>
        </div>
        <div className="review-grid">
          <article className={romaneio.status.loaded ? "review-item ok" : "review-item"}>
            <span>Último upload</span>
            <strong>{lastUpload}</strong>
          </article>
          <article className="review-item ok">
            <span>Pacotes</span>
            <strong>{romaneio.status.totalPackages}</strong>
          </article>
          <article className="review-item ok">
            <span>Linhas lidas</span>
            <strong>{romaneio.status.totalRows}</strong>
          </article>
        </div>
        {romaneio.status.warnings?.length ? (
          <div className="romaneio-adaptation-box">
            <Info size={18} />
            <div>
              <strong>Formato adaptado automaticamente</strong>
              {romaneio.status.warnings.map((warning) => <span key={warning}>{warning}</span>)}
            </div>
          </div>
        ) : null}
        {romaneio.status.error || error ? <p className="inline-error">{romaneio.status.error || error}</p> : null}
        {locateResult.message ? (
          <div className={locateResult.found ? "romaneio-found-box" : "inline-error"}>
            <strong>{locateResult.message}</strong>
            {locateResult.candidates.length ? (
              <div className="romaneio-candidate-list">
                {locateResult.candidates.map((candidate) => (
                  <button key={candidate.id} className="romaneio-candidate" disabled={busy} type="button" onClick={() => onConfirmCandidate(candidate)}>
                    <span>{candidate.periodoLabel} · {candidate.fileName}</span>
                    <small>{new Date(candidate.timestamp).toLocaleString("pt-BR")}</small>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="quick-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-label">Filtros</p>
            <h2>Escolha de rotas</h2>
          </div>
          <button className="button primary" disabled={busy} type="button" onClick={onSaveSettings}>
            Salvar filtros
          </button>
        </div>
        <div className="settings-grid compact-settings">
          <label>
            Distância máxima km
            <input value={settingsDraft.distanciaMaxKm || ""} type="number" min="0" step="0.1" onChange={(event) => updateNumber("distanciaMaxKm", event.target.value)} />
          </label>
          <label>
            Máximo de paradas
            <input value={settingsDraft.paradasMax || ""} type="number" min="0" step="1" onChange={(event) => updateNumber("paradasMax", event.target.value)} />
          </label>
          <label>
            Máximo de pacotes
            <input value={settingsDraft.pacotesMax || ""} type="number" min="0" step="1" onChange={(event) => updateNumber("pacotesMax", event.target.value)} />
          </label>
          <label>
            Prioridade
            <select value={settingsDraft.prioridade} onChange={(event) => onSettingsChange({ ...settingsDraft, prioridade: event.target.value as RomaneioSettings["prioridade"] })}>
              {romaneioPriorities.map((priority) => (
                <option key={priority.id} value={priority.id}>{priority.label}</option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="quick-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-label">Prévia</p>
            <h2>Rotas processadas</h2>
          </div>
          <span className="mini-badge">{topRoutes.length}/{romaneio.routes.length}</span>
        </div>
        <div className="admin-route-scroll compact">
          {topRoutes.length ? topRoutes.map((route) => (
            <article key={`${route.rota}-${route.gaiola}-${route.plannedAt || ""}`} className="admin-route-row">
              <div>
                <strong>{route.rota} / {route.gaiola}</strong>
                <span>{route.cidade || "Cidade não informada"} · {route.bairros.slice(0, 3).map((bairro) => bairro.nome).join(", ")}</span>
              </div>
              <div className="route-row-metrics">
                <span>{route.distanciaKm > 0 ? `${route.distanciaKm.toFixed(3)} km` : "km não informado"}</span>
                <span>{route.pacotes} pct</span>
                <span>{route.paradas} paradas</span>
              </div>
            </article>
          )) : <p className="qr-empty">Envie um arquivo .xlsx para ver a prévia.</p>}
        </div>
      </section>
    </section>
  );
}

function OcrRouteApprovalPanel({
  selection,
  selectedIds,
  busy,
  onToggle,
  onConfirm,
  onClose
}: {
  selection?: OcrRouteSelectionState;
  selectedIds: string[];
  busy: boolean;
  onToggle: (option: OcrRouteOption) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [analysisClock, setAnalysisClock] = useState(Date.now());

  useEffect(() => {
    if (selection?.status !== "analyzing") return;
    setAnalysisClock(Date.now());
    const interval = window.setInterval(() => setAnalysisClock(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [selection?.status, selection?.processedAt]);

  if (!selection || selection.status === "idle") return null;

  if (selection.status === "analyzing") {
    const startedAt = Date.parse(selection.processedAt || "") || analysisClock;
    const elapsedSeconds = Math.max(0, Math.floor((analysisClock - startedAt) / 1000));
    const remainingSeconds = Math.max(0, (selection.estimatedDurationSeconds || 30) - elapsedSeconds);
    const timer = `${String(Math.floor(remainingSeconds / 60)).padStart(2, "0")}:${String(remainingSeconds % 60).padStart(2, "0")}`;
    return (
      <section className="quick-panel ocr-approval-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-label">Bot imagem</p>
            <h2>Analisando imagem...</h2>
            <strong className="ocr-analysis-timer" aria-live="polite">{timer}</strong>
            <p className="approval-message">Tempo estimado restante. As rotas aparecerão automaticamente ao terminar.</p>
          </div>
          <span className="mini-badge">VISÃO</span>
        </div>
      </section>
    );
  }

  if (selection.status === "error") {
    return (
      <section className="quick-panel ocr-approval-panel">
        <p className="panel-label">Bot imagem</p>
        <h2>Imagem analisada</h2>
        <p className="inline-error">{selection.message || "Não foi possível encontrar rotas para essa imagem."}</p>
      </section>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="sheet-dialog ocr-route-dialog" role="dialog" aria-modal="true" aria-labelledby="ocr-routes-title">
        <div className="sheet-heading">
          <div>
            <p className="panel-label">Ranking de rotas</p>
            <h2 id="ocr-routes-title">{selection.status === "confirmed" ? "Rotas confirmadas" : "Escolha as rotas"}</h2>
          </div>
          <button className="icon-button" title="Fechar" type="button" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        {selection.message ? <p className="approval-message">{selection.message}</p> : null}
        {selection.preferredCity && selection.preferredCityFound === false ? (
          <div className="ocr-city-alert" role="status">
            <strong>Nenhuma rota de {selection.preferredCity} foi encontrada</strong>
            <span>As demais rotas identificadas na imagem estão listadas abaixo.</span>
          </div>
        ) : null}
        {selection.preferredCity && selection.preferredCityFound ? (
          <div className="ocr-city-priority" role="status">
            <strong>{selection.preferredCity} priorizada</strong>
            <span>As rotas da cidade aparecem primeiro no ranking.</span>
          </div>
        ) : null}
        <div className="ocr-option-grid">
          {selection.options.map((option) => {
            const selectedOrder = selectedIds.indexOf(option.id);
            const confirmedOrder = selection.selectedOptionIds?.indexOf(option.id) ?? -1;
            const selected = selectedOrder >= 0 || confirmedOrder >= 0;
            const sendOrder = selectedOrder >= 0 ? selectedOrder + 1 : confirmedOrder >= 0 ? confirmedOrder + 1 : 0;
            return (
              <button
                key={option.id}
                className={selected ? "ocr-option selected" : "ocr-option"}
                disabled={busy || selection.status === "confirmed" || !option.passedFilters || option.romaneioMatch === false}
                type="button"
                onClick={() => onToggle(option)}
              >
                <strong>#{option.rank} {option.rota} / {option.gaiola}</strong>
                <span>{option.cidade || "Cidade não identificada"} · {option.bairro}{option.bairroPercentual !== undefined ? ` · ${option.bairroPercentual.toFixed(1)}%` : ""}</span>
                {option.observation ? <small>{option.observation}</small> : null}
                {sendOrder ? <b className="send-order-badge">{sendOrder}ª mensagem</b> : null}
                {option.romaneioMatch !== false ? (
                  <div className="route-row-metrics">
                    <span>{option.distanciaKm.toFixed(3)} km</span>
                    <span>{option.pacotes} pct</span>
                    <span>{option.paradas} paradas</span>
                  </div>
                ) : null}
                {!option.passedFilters && option.reasons.length ? <small>{option.reasons.join(" ")}</small> : null}
              </button>
            );
          })}
        </div>
        {selection.status !== "confirmed" ? (
          <div className="review-actions">
            <button className="button primary" disabled={busy || !selectedIds.length} type="button" onClick={onConfirm}>
              Confirmar rota(s)
            </button>
          </div>
        ) : (
          <div className="review-actions">
            <button className="button primary" type="button" onClick={onClose}>
              Fechar
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<BotSnapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();
  const [activeTab, setActiveTab] = useState<AppTab>(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    return ["home", "groups", "image", "test", "settings"].includes(requested || "") ? requested as AppTab : "home";
  });
  const [groupEditor, setGroupEditor] = useState<GroupEditor>();
  const [authenticated, setAuthenticated] = useState(Boolean(window.botApi || getPanelToken()));
  const [userEmail, setUserEmail] = useState(getPanelUserEmail());
  const [userRole, setUserRole] = useState<PanelUserRole>(getPanelUserRole());
  const [sessionChecked, setSessionChecked] = useState(Boolean(window.botApi || !getPanelToken()));
  const [loginError, setLoginError] = useState("");
  const [alertFlash, setAlertFlash] = useState(false);
  const [lastAlertLogId, setLastAlertLogId] = useState("");
  const [actionToast, setActionToast] = useState<ActionToast | undefined>();
  const [romaneio, setRomaneio] = useState<RomaneioSnapshot>(emptyRomaneio);
  const [romaneioSettingsDraft, setRomaneioSettingsDraft] = useState<RomaneioSettings>(emptyRomaneio.settings);
  const [romaneioLocateResult, setRomaneioLocateResult] = useState<RomaneioLocateResult>(emptyRomaneioLocate);
  const [romaneioError, setRomaneioError] = useState("");
  const [selectedOcrOptionIds, setSelectedOcrOptionIds] = useState<string[]>([]);
  const [ocrRouteDialogOpen, setOcrRouteDialogOpen] = useState(false);
  const [incidentValid, setIncidentValid] = useState(true);
  const [incidentReason, setIncidentReason] = useState("");
  const [incidentClock, setIncidentClock] = useState(Date.now());
  const [notificationStatus, setNotificationStatus] = useState("");
  const connectionSectionRef = useRef<HTMLElement | null>(null);

  function showActionToast(message: string, tone?: ActionToast["tone"]) {
    setActionToast({ message, tone });
    window.setTimeout(() => setActionToast(undefined), 1000);
  }

  function scrollToConnectionOptions(delayMs = 120) {
    window.setTimeout(() => {
      connectionSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, delayMs);
  }


  function logout(message = "") {
    setPanelToken("");
    setPanelUserEmail("");
    setPanelUserRole("");
    setPanelPassword("");
    setUserEmail("");
    setUserRole("client");
    setAuthenticated(false);
    setSessionChecked(true);
    if (message) setLoginError(message);
  }

  useEffect(() => {
    if (!authenticated || window.botApi) return;

    let mounted = true;
    getPanelMe()
      .then((user) => {
        if (!mounted) return;
        setUserEmail(user.email);
        setUserRole(user.role);
        setSessionChecked(true);
        setLoginError("");
      })
      .catch((error) => {
        if (!mounted) return;
        if (isAuthError(error)) {
          logout(error instanceof Error ? error.message : "Faça login novamente.");
          return;
        }
        setSessionChecked(true);
        setLoginError(error instanceof Error ? error.message : "Falha ao validar sessão.");
      });

    return () => {
      mounted = false;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    if (userRole === "admin") return;

    let mounted = true;
    botApi
      .getSnapshot()
      .then((nextSnapshot) => {
        if (mounted) {
          setSnapshot(nextSnapshot);
          setLoginError("");
        }
      })
      .catch((error) => {
        if (!mounted) return;
        if (isAuthError(error)) {
          logout(error instanceof Error ? error.message : "Faça login para continuar.");
          return;
        }
        setLoginError(error instanceof Error ? error.message : "Falha ao abrir painel.");
      });

    const unsubscribe = botApi.onSnapshot((nextSnapshot) => {
      if (mounted) setSnapshot(nextSnapshot);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [authenticated, userRole]);

  useEffect(() => {
    if (!authenticated || userRole === "admin") return;
    const refreshAfterBackground = () => {
      if (document.visibilityState !== "visible") return;
      void botApi.getSnapshot().then(setSnapshot).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", refreshAfterBackground);
    window.addEventListener("focus", refreshAfterBackground);
    window.addEventListener("pageshow", refreshAfterBackground);
    return () => {
      document.removeEventListener("visibilitychange", refreshAfterBackground);
      window.removeEventListener("focus", refreshAfterBackground);
      window.removeEventListener("pageshow", refreshAfterBackground);
    };
  }, [authenticated, userRole]);

  useEffect(() => {
    if (!authenticated || userRole === "admin") return;
    let mounted = true;
    getRomaneio()
      .then((nextRomaneio) => {
        if (!mounted) return;
        setRomaneio(nextRomaneio);
        setRomaneioSettingsDraft(nextRomaneio.settings);
      })
      .catch((error) => {
        if (!mounted) return;
        setRomaneioError(error instanceof Error ? error.message : "Falha ao carregar romaneio.");
      });
    return () => {
      mounted = false;
    };
  }, [authenticated, userRole]);

  useEffect(() => {
    if (snapshot.status !== "connected") return;
  }, [snapshot.status]);

  useEffect(() => {
    const selection = snapshot.ocrRouteSelection;
    const imageBotActive = snapshot.config.targetDispatchMode === "ocr";
    if (!imageBotActive) {
      setSelectedOcrOptionIds([]);
      setOcrRouteDialogOpen(false);
      return;
    }
    if (selection?.status === "analyzing") {
      setActiveTab("image");
      setSelectedOcrOptionIds([]);
      setOcrRouteDialogOpen(true);
      return;
    }
    if (selection?.status === "ready") {
      setActiveTab("image");
      setSelectedOcrOptionIds(selection.options[0]?.id ? [selection.options[0].id] : []);
      setOcrRouteDialogOpen(true);
      return;
    }
    if (selection?.status === "confirmed") {
      setActiveTab("image");
      setSelectedOcrOptionIds(selection.selectedOptionIds || []);
      setOcrRouteDialogOpen(true);
      return;
    }
    if (selection?.status === "idle" || selection?.status === "error") {
      setSelectedOcrOptionIds([]);
      if (selection.status === "error") {
        setActiveTab("image");
        setOcrRouteDialogOpen(true);
      }
    }
  }, [snapshot.config.targetDispatchMode, snapshot.ocrRouteSelection?.processedAt, snapshot.ocrRouteSelection?.status]);

  const groupLabel = useMemo(() => {
    return snapshot.config.grupoAlvoNome || "Nenhum grupo alvo";
  }, [snapshot.config]);

  const testGroupLabel = useMemo(() => {
    return snapshot.config.grupoTesteNome || "Nenhum teste salvo";
  }, [snapshot.config]);

  const pendingClientIncident = useMemo(() => {
    if (userRole === "admin") return undefined;
    return (snapshot.routeDispatches || []).find((route) => isClientIncidentDue(route, incidentClock));
  }, [snapshot.routeDispatches, userRole, incidentClock]);

  const pendingIncidentAuditLines = useMemo(() => {
    return pendingClientIncident ? getIncidentAuditLines(pendingClientIncident) : [];
  }, [pendingClientIncident]);

  const pendingIncidentSnoozeDelay = pendingClientIncident ? getIncidentSnoozeDelayMinutes(pendingClientIncident) : undefined;

  useEffect(() => {
    const timer = window.setInterval(() => setIncidentClock(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pendingClientIncident) {
      setIncidentReason("");
      setIncidentValid(true);
    }
  }, [pendingClientIncident?.id]);

  useEffect(() => {
    const lastLog = snapshot.logs[snapshot.logs.length - 1];
    if (!lastLog || lastLog.id === lastAlertLogId) return;

    const shouldAlert = /ABRIU|Abertura simulada|Disparo acionado|Disparo .*conclu|Mensagem alvo \d+ enviada/i.test(lastLog.message);
    if (!shouldAlert) return;

    setLastAlertLogId(lastLog.id);
    setAlertFlash(true);
    window.setTimeout(() => setAlertFlash(false), 900);

    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const audio = new AudioContextClass();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = 740;
      gain.gain.setValueAtTime(0.0001, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audio.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.2);
      window.setTimeout(() => void audio.close(), 260);
    } catch {
      // Browsers can block sound before user interaction.
    }
  }, [lastAlertLogId, snapshot.logs]);

  async function runAction(action: () => Promise<BotSnapshot>) {
    setBusy(true);
    try {
      const nextSnapshot = await action();
      setSnapshot(nextSnapshot);
      showActionToast("Ação concluída.");
      return nextSnapshot;
    } catch (error) {
      if (isAuthError(error)) {
        logout(error instanceof Error ? error.message : "Entre novamente para continuar.");
      } else {
        setConfirmation({
          title: "Erro",
          message: error instanceof Error ? error.message : "Não consegui executar essa ação.",
          details: [],
          confirmLabel: "Fechar",
          onConfirm: () => undefined
        });
      }
      return snapshot;
    } finally {
      setBusy(false);
    }
  }

  async function startWhatsAppConnection() {
    await runAction(botApi.startBot);
    scrollToConnectionOptions(180);
  }

  function buildMessagePreview(senderName = snapshot.config.nomeEnvio, codes = snapshot.config.codigosMensagensAlvo) {
    return normalizeMessages(senderName, codes || []);
  }

  function buildRoutePreview(routes = snapshot.config.rotasMonitoradas, detailedRoutes = snapshot.config.rotasMonitoradasDetalhadas) {
    return formatOcrRoutes(routes || [], detailedRoutes || []).map((route, index) => `Prioridade ${index + 1}: ${route}`);
  }

  function isHomeOperationLog(message: string) {
    return /Bot .*ARMADO|NORMAL ARMADO|NUCLEAR ARMADO|Monitoramento desativado|Parou de escutar|FECHADO|ABRIU|Palavra de abertura|Abertura simulada|Disparo acionado|Rajada instantânea|Mensagem .*?(confirmada|enviada)|Disparo .*?(concluído|concluido|terminou)|Abertura ignorada|falhou|erro/i.test(message);
  }

  function isImageOperationLog(message: string) {
    return /OCR|IA|imagem|foto|romaneio|rota\(s\)|rotas encontradas|Ranking de rotas|Cliente confirmou|gaiola/i.test(message);
  }

  function confirmSaveTarget(group: string, groupId: string | undefined, groupName: string | undefined, senderName: string, codes: string[], _messageCount?: number, _intervalMs?: number, startAfterSave = false, monitoredRoutes?: MonitoredRoute[], targetDispatchMode: "manual" | "ocr" = "manual") {
    const selectedGroupName = groupName || group;
    const isImageMode = targetDispatchMode === "ocr";
    const routes = isImageMode ? codes : [];
    const messages = isImageMode ? buildRoutePreview(routes, monitoredRoutes) : buildMessagePreview(senderName, codes);

    setConfirmation({
      title: startAfterSave ? (isImageMode ? "Salvar e iniciar imagem" : "Salvar e iniciar manual") : isImageMode ? "Salvar bot imagem" : "Salvar mensagens",
      message: `Grupo alvo: ${selectedGroupName}`,
      details: messages.length ? messages : [isImageMode ? "Nenhuma rota monitorada." : "Nenhuma mensagem manual."],
      confirmLabel: startAfterSave ? "Salvar e iniciar" : "Salvar",
      onConfirm: async () => {
        await runAction(async () => {
          await botApi.saveGroup({ group, groupId, groupName });
          await botApi.saveTargetMessageSettings({
            senderName,
            codes: isImageMode ? snapshot.config.codigosMensagensAlvo || [] : codes,
            routes: isImageMode ? routes : snapshot.config.rotasMonitoradas || [],
            monitoredRoutes: isImageMode ? monitoredRoutes : snapshot.config.rotasMonitoradasDetalhadas || [],
            targetDispatchMode
          });
          setGroupEditor(undefined);
          return startAfterSave ? (isImageMode ? botApi.startImageMonitoring() : botApi.startMonitoring()) : botApi.getSnapshot();
        });
      }
    });
  }

  function confirmSaveTest(group: string, groupId: string | undefined, groupName: string | undefined, senderName: string, codes: string[], messageCount = 15, intervalMs = 0) {
    const selectedGroupName = groupName || group;
    const messages = buildMessagePreview(senderName, codes);

    setConfirmation({
      title: "Salvar teste",
      message: `Grupo teste: ${selectedGroupName}`,
      details: messages.length ? messages : ["Nenhuma mensagem pronta."],
      confirmLabel: "Salvar teste",
      onConfirm: async () => {
        await runAction(async () => {
          await botApi.saveTestGroup({ group, groupId, groupName });
          setGroupEditor(undefined);
          return botApi.saveWarmupMessageSettings({ senderName, codes, messageCount, intervalMs });
        });
      }
    });
  }

  function confirmSaveManualTarget(group: string, groupId: string | undefined, groupName: string | undefined, senderName: string, codes: string[]) {
    const selectedGroupName = groupName || group;
    const messages = buildMessagePreview(senderName, codes);

    setConfirmation({
      title: "Salvar manual avançado",
      message: `Grupo alvo: ${selectedGroupName}`,
      details: messages.length ? messages : ["Nenhum código manual."],
      confirmLabel: "Salvar manual",
      onConfirm: async () => {
        await runAction(async () => {
          await botApi.saveGroup({ group, groupId, groupName });
          await botApi.saveTargetMessageSettings({ senderName, codes, routes: snapshot.config.rotasMonitoradas || [], monitoredRoutes: snapshot.config.rotasMonitoradasDetalhadas || [] });
          setGroupEditor(undefined);
          return botApi.getSnapshot();
        });
      }
    });
  }

  function confirmStartMonitoring() {
    const manualMessages = buildMessagePreview();
    const hasGroup = Boolean(snapshot.config.grupoAlvoJid || snapshot.config.grupoAlvoNome);
    const hasName = Boolean(snapshot.config.nomeEnvio);

    if (!hasGroup || !hasName || !manualMessages.length) {
      setGroupEditor("target");
      setConfirmation({
        title: "Revise o envio",
        message: "Falta configurar o grupo, o nome ou os códigos manuais.",
        details: [
          hasGroup ? `Rota: ${groupLabel}` : "Rota ainda não configurada.",
          hasName ? `Nome: ${snapshot.config.nomeEnvio}` : "Nome ainda não configurado.",
          manualMessages.length ? `Mensagens: ${manualMessages.join(" | ")}` : "Nenhum código manual configurado."
        ],
        confirmLabel: "Entendi",
        onConfirm: () => undefined
      });
      return;
    }

    setConfirmation({
      title: "Iniciar bot manual",
      message: "Confira a rota e as mensagens manuais que serão enviadas.",
      details: [
        `Grupo alvo: ${groupLabel}`,
        `Nome: ${snapshot.config.nomeEnvio}`,
        `Mensagens manuais: ${manualMessages.join(" | ")}`
      ],
      confirmLabel: "Iniciar manual",
      onConfirm: async () => {
        await runAction(botApi.startMonitoring);
      }
    });
  }

  function confirmStartImageMonitoring() {
    const hasGroup = Boolean(snapshot.config.grupoAlvoJid || snapshot.config.grupoAlvoNome);
    const hasName = Boolean(snapshot.config.nomeEnvio);

    if (!hasGroup || !hasName) {
      setGroupEditor("image");
      setConfirmation({
        title: "Revise o bot imagem",
        message: "Falta configurar grupo, nome ou bairro para leitura de foto.",
        details: [
          hasGroup ? `Grupo: ${groupLabel}` : "Grupo alvo ainda não configurado.",
          hasName ? `Nome: ${snapshot.config.nomeEnvio}` : "Nome ainda não configurado.",
          "Todas as rotas encontradas na imagem serão analisadas."
        ],
        confirmLabel: "Entendi",
        onConfirm: () => undefined
      });
      return;
    }

    setConfirmation({
      title: "Iniciar bot imagem",
      message: "O bot vai aguardar foto da tabela e só enviar se achar uma rota segura.",
      details: [
        `Grupo alvo: ${groupLabel}`,
        `Nome: ${snapshot.config.nomeEnvio}`,
        "Ranking definido pelo romaneio e pelos filtros."
      ],
      confirmLabel: "Iniciar imagem",
      onConfirm: async () => {
        await runAction(botApi.startImageMonitoring);
      }
    });
  }

  function confirmStartTestMonitoring() {
    const messages = normalizeMessages(snapshot.config.nomeEnvio, snapshot.config.codigosMensagensTeste || []);

    setConfirmation({
      title: "Teste abrir/fechar",
      message: "Deseja testar abrindo e fechando o grupo?",
      details: [
        `Grupo teste: ${testGroupLabel}`,
        messages.length ? `Mensagens: ${messages.join(" | ")}` : "Nenhuma mensagem de teste configurada."
      ],
      confirmLabel: "Testar grupo",
      onConfirm: async () => {
        await runAction(botApi.startTestMonitoring);
      }
    });
  }

  function confirmWarmup() {
    const config = snapshot.config;
    setConfirmation({
      title: "Testar envio",
      message: "Deseja enviar as mensagens de teste agora?",
      details: [
        config.grupoTesteNome || config.grupoTesteJid
          ? `Grupo teste: ${testGroupLabel}`
          : "Nenhum grupo de teste configurado.",
        `${snapshot.warmupMessagesSent || 0}/${snapshot.warmupRequiredMessages || 15} mensagens no último teste.`
      ],
      confirmLabel: "Testar envio",
      onConfirm: async () => {
        await runAction(botApi.warmupGroups);
      }
    });
  }

  function confirmManualDispatch() {
    const messages = buildMessagePreview();
    setConfirmation({
      title: "Disparo manual",
      message: snapshot.groupState === "closed"
        ? "O grupo ainda parece fechado. Se clicar agora, o sistema vai bloquear e registrar o aviso."
        : "Deseja disparar manualmente no grupo alvo agora?",
      details: [
        `Grupo alvo: ${groupLabel}`,
        `Estado atual: ${snapshot.groupState === "open" ? "aberto" : snapshot.groupState === "closed" ? "fechado" : "desconhecido"}`,
        messages.length ? `Mensagens manuais: ${messages.join(" | ")}` : "Nenhuma mensagem manual configurada. O modo principal usa análise de foto."
      ],
      confirmLabel: "Disparar agora",
      onConfirm: async () => {
        await runAction(botApi.manualDispatch);
      }
    });
  }

  function confirmSimulateTargetDispatch() {
    const messages = buildMessagePreview();
    setConfirmation({
      title: "Simular alvo",
      message: "Deseja enviar no grupo teste exatamente as mensagens que iriam para o grupo alvo?",
      details: [
        `Grupo teste: ${testGroupLabel}`,
        messages.length ? `Mensagens alvo: ${messages.join(" | ")}` : "Nenhuma mensagem alvo configurada."
      ],
      confirmLabel: "Simular alvo",
      onConfirm: async () => {
        await runAction(botApi.simulateTargetDispatch);
      }
    });
  }

  function confirmClearLogs() {
    setConfirmation({
      title: "Limpar logs",
      message: "Deseja apagar os logs exibidos no painel?",
      details: [`${snapshot.logs.length} evento(s) no painel.`],
      confirmLabel: "Limpar logs",
      onConfirm: async () => {
        await runAction(botApi.clearLogs);
      }
    });
  }

  function confirmFactoryReset() {
    setConfirmation({
      title: "Resetar tudo",
      message: "Deseja apagar sessão do WhatsApp e todas as configurações salvas?",
      details: ["O bot vai voltar zerado, com grupos, nome e mensagens em branco.", "Depois do reset será necessário conectar o WhatsApp novamente."],
      confirmLabel: "Resetar tudo",
      onConfirm: async () => {
        await runAction(botApi.factoryReset);
      }
    });
  }

  function saveGeneralSettings(settings: { nuclearMode?: boolean; ocrManualRouteSelection?: boolean }) {
    return runAction(() => botApi.saveGeneralSettings({
      nuclearMode: settings.nuclearMode ?? snapshot.config.nuclearMode,
      ocrManualRouteSelection: settings.ocrManualRouteSelection ?? snapshot.config.ocrManualRouteSelection
    }));
  }

  function confirmOcrSelectionMode(nextManualMode: boolean) {
    setConfirmation({
      title: nextManualMode ? "Ligar escolha manual" : "Desligar escolha manual",
      message: nextManualMode
        ? "Com essa opção ligada, você terá que escolher a rota que vai pegar antes do bot preparar o envio."
        : "Com essa opção desligada, o bot vai analisar a imagem e enviar a mensagem por conta própria com a melhor rota do ranking.",
      details: nextManualMode
        ? ["O painel abrirá a tela de ranking para seleção manual.", "Nada será enviado até confirmar uma ou mais rotas."]
        : ["Útil quando o líder envia a imagem e não fecha o grupo.", "Se o grupo já estiver aberto, o bot tenta enviar a melhor rota o mais rápido possível."],
      confirmLabel: nextManualMode ? "Ligar escolha" : "Desligar escolha",
      tone: nextManualMode ? "manual" : "auto",
      onConfirm: async () => {
        await saveGeneralSettings({ ocrManualRouteSelection: nextManualMode });
        showActionToast(
          nextManualMode ? "Modo seleção manual ligado." : "Modo automático ligado.",
          nextManualMode ? "manual" : "auto"
        );
      }
    });
  }

  async function handleLocateRomaneio() {
    setBusy(true);
    setRomaneioError("");
    try {
      const result = await locateRomaneio();
      setRomaneioLocateResult(result);
      showActionToast(result.found ? "Romaneio encontrado." : "Busca concluída.");
    } catch (error) {
      setRomaneioError(error instanceof Error ? error.message : "Não consegui localizar o romaneio.");
    } finally {
      setBusy(false);
    }
  }

  async function handleUploadRomaneio(file: File) {
    if (!/\.xlsx$/i.test(file.name)) {
      setRomaneioError("Selecione um arquivo de romaneio no formato .xlsx.");
      return;
    }
    setBusy(true);
    setRomaneioError("");
    setRomaneioLocateResult({ found: false, message: "", candidates: [] });
    try {
      const nextRomaneio = await uploadRomaneio(file);
      setRomaneio(nextRomaneio);
      setRomaneioSettingsDraft(nextRomaneio.settings);
      setRomaneioLocateResult({
        found: true,
        message: `Romaneio enviado do aparelho: ${file.name}`,
        candidates: []
      });
      showActionToast(`${nextRomaneio.status.totalRoutes} rota(s) carregada(s).`);
    } catch (error) {
      setRomaneioError(error instanceof Error ? error.message : "Não consegui enviar o romaneio.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmRomaneio(candidate: RomaneioCandidate) {
    setBusy(true);
    setRomaneioError("");
    try {
      const nextRomaneio = await confirmRomaneio(candidate.id);
      setRomaneio(nextRomaneio);
      setRomaneioSettingsDraft(nextRomaneio.settings);
      setRomaneioLocateResult({
        found: true,
        message: `Romaneio confirmado (${candidate.periodoLabel}): ${candidate.fileName}`,
        candidates: []
      });
      showActionToast("Romaneio processado.");
    } catch (error) {
      setRomaneioError(error instanceof Error ? error.message : "Não consegui confirmar o romaneio.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveRomaneioSettings() {
    setBusy(true);
    setRomaneioError("");
    try {
      const settings = await saveRomaneioSettings(romaneioSettingsDraft);
      setRomaneio((current) => ({ ...current, settings }));
      setRomaneioSettingsDraft(settings);
      showActionToast("Filtros salvos.");
    } catch (error) {
      setRomaneioError(error instanceof Error ? error.message : "Não consegui salvar os filtros.");
    } finally {
      setBusy(false);
    }
  }

  function toggleOcrRouteOption(option: OcrRouteOption) {
    setSelectedOcrOptionIds((current) => {
      if (current.includes(option.id)) return current.filter((id) => id !== option.id);
      return [...current, option.id].slice(0, 2);
    });
  }

  async function confirmOcrRoutes() {
    await runAction(() => botApi.confirmOcrRoutes({ optionIds: selectedOcrOptionIds }));
  }

  async function submitIncidentAnswer() {
    if (!pendingClientIncident || !incidentReason.trim()) return;
    await runAction(() => botApi.submitRouteIncident({
      routeId: pendingClientIncident.id,
      valid: incidentValid,
      reason: incidentReason.trim()
    }));
    setIncidentReason("");
  }

  async function handleEnableNotifications() {
    setBusy(true);
    setNotificationStatus("");
    try {
      await enableWebPushNotifications();
      setNotificationStatus("Alertas ativados neste dispositivo.");
      showActionToast("Alertas em segundo plano ativados.");
    } catch (error) {
      setNotificationStatus(error instanceof Error ? error.message : "Não consegui ativar os alertas.");
    } finally {
      setBusy(false);
    }
  }

  async function snoozePendingClientIncident() {
    if (!pendingClientIncident || !pendingIncidentSnoozeDelay) return;
    await runAction(() => botApi.snoozeRouteIncident({ routeId: pendingClientIncident.id }));
    setIncidentClock(Date.now());
  }

  async function confirmPendingAction() {
    if (!confirmation) return;
    const action = confirmation.onConfirm;
    setConfirmation(undefined);
    await action();
  }

  async function login(email: string, password: string) {
    try {
      const user = await panelLogin(email, password);
      setUserEmail(user.email);
      setUserRole(user.role);
      setSessionChecked(true);
      setAuthenticated(true);
      setLoginError("");
    } catch (error) {
      setPanelToken("");
      setPanelUserRole("");
      setLoginError(error instanceof Error ? error.message : "Não consegui fazer login.");
    }
  }

  if (!sessionChecked) {
    return <LoadingScreen />;
  }

  if (!authenticated) {
    return <LoginScreen error={loginError} onSubmit={login} />;
  }

  if (userRole === "admin") {
    return (
      <AdminCommandCenter
        userEmail={userEmail}
        onLogout={() => logout("Entre novamente para continuar.")}
      />
    );
  }

  return (
    <main className={alertFlash ? "app-shell alert-flash" : "app-shell"}>
      <section className="topbar app-topbar">
        <div>
          <p className="eyebrow">Central operacional</p>
          <h1>Bot Rotas</h1>
        </div>
        <div className="group-pill">
          <span>{snapshot.monitoringMode === "test" ? "Teste ativo" : "Grupo alvo"}</span>
          <strong>{snapshot.monitoringMode === "test" ? testGroupLabel : groupLabel}</strong>
        </div>
      </section>

      {activeTab === "home" ? (
        <section className="mobile-home">
          <CockpitPanel snapshot={snapshot} groupLabel={snapshot.monitoringMode === "test" ? testGroupLabel : groupLabel} />

          <LaunchReviewPanel
            snapshot={snapshot}
            groupLabel={groupLabel}
            messages={normalizeMessages(snapshot.config.nomeEnvio, snapshot.config.codigosMensagensAlvo || [])}
            onEditTarget={() => setGroupEditor("target")}
          />

          <ControlButtons
            busy={busy}
            status={snapshot.status}
            onStart={startWhatsAppConnection}
            onStop={() => runAction(botApi.stopBot)}
            onStartMonitoring={confirmStartMonitoring}
            onStopMonitoring={() => runAction(botApi.stopMonitoring)}
            onManualDispatch={confirmManualDispatch}
            monitoringEnabled={snapshot.monitoringEnabled}
            monitoringMode={snapshot.monitoringMode}
            groupState={snapshot.groupState}
          />

          <LogsPanel logs={snapshot.logs.filter((log) => isHomeOperationLog(log.message)).slice(-30)} />

          <PerformanceStrip snapshot={snapshot} />

          <section ref={connectionSectionRef} className="connection-anchor">
            {snapshot.qrCode || snapshot.status === "waiting_qr" || snapshot.status === "connecting" ? (
              <QrCodeBox
                qrCode={snapshot.qrCode}
                status={snapshot.status}
                pairingCode={snapshot.pairingCode}
                busy={busy}
                onRequestPairingCode={(phoneNumber) => runAction(() => botApi.requestPairingCode({ phoneNumber }))}
              />
            ) : null}
          </section>
        </section>
      ) : null}

      {activeTab === "groups" ? (
        <section className="mobile-home">
          <section className="quick-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Configuração</p>
                <h2>Grupos do bot</h2>
              </div>
              <button className="icon-button" disabled={busy} title="Atualizar grupos" type="button" onClick={() => runAction(botApi.refreshGroups)}>
                <RefreshCw size={20} />
              </button>
            </div>
            <ConfigStrip
              kind="target"
              title="Config grupo alvo"
              group={groupLabel}
              codes={snapshot.config.codigosMensagensAlvo || []}
              onOpen={() => setGroupEditor("target")}
            />
          </section>
        </section>
      ) : null}

      {activeTab === "image" ? (
        <section className="mobile-home">
          <section className="quick-panel identity-panel">
            <div>
              <p className="panel-label">Bot imagem</p>
              <h2>Todas as rotas da imagem</h2>
            </div>
            <button className="button" type="button" onClick={() => setGroupEditor("image")}>
              Configurar grupo
            </button>
          </section>
          <section className="quick-panel client-usage-panel">
            <div className="client-usage-head">
              <div className="client-usage-icon"><BrainCircuit size={22} /></div>
              <div>
                <p className="panel-label">Análise inteligente</p>
                <h2>Consumo de imagens</h2>
              </div>
              <strong>{((snapshot.imageUsage?.amountCents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</strong>
            </div>
          </section>
          {false ? <MessagePreviewStrip
            title="Ranking de rotas"
            group={groupLabel}
            messages={["Ranking automático pelo romaneio", "Sem filtro de bairros preferidos"]}
            onOpen={() => setGroupEditor("image")}
          /> : null}
          <section className={snapshot.config.ocrManualRouteSelection ? "quick-panel ocr-mode-panel tone-manual" : "quick-panel ocr-mode-panel tone-auto"}>
            <div className="panel-heading">
              <div>
                <p className="panel-label">Escolha da rota</p>
                <h2>{snapshot.config.ocrManualRouteSelection ? "Manual" : "Automática"}</h2>
              </div>
              <div className="ocr-mode-actions" role="group" aria-label="Modo de escolha da rota">
                <button
                  className={!snapshot.config.ocrManualRouteSelection ? "button primary" : "button"}
                  disabled={busy || !snapshot.config.ocrManualRouteSelection}
                  type="button"
                  onClick={() => confirmOcrSelectionMode(false)}
                >
                  Automática
                </button>
                <button
                  className={snapshot.config.ocrManualRouteSelection ? "button primary" : "button"}
                  disabled={busy || snapshot.config.ocrManualRouteSelection}
                  type="button"
                  onClick={() => confirmOcrSelectionMode(true)}
                >
                  Manual
                </button>
              </div>
            </div>
            <p className="approval-message">
              {snapshot.config.ocrManualRouteSelection
                ? "O painel mostra o ranking e aguarda sua confirmação."
                : "O bot usa a melhor rota do ranking e envia sozinho quando possível."}
            </p>
          </section>
          <ControlButtons
            busy={busy}
            status={snapshot.status}
            onStart={startWhatsAppConnection}
            onStop={() => runAction(botApi.stopBot)}
            onStartMonitoring={confirmStartImageMonitoring}
            onStopMonitoring={() => runAction(botApi.stopMonitoring)}
            onManualDispatch={confirmManualDispatch}
            startMonitoringLabel="Iniciar bot imagem"
            hideManualDispatch
            monitoringEnabled={snapshot.monitoringEnabled && snapshot.config.targetDispatchMode === "ocr"}
            monitoringMode={snapshot.monitoringMode}
            groupState={snapshot.groupState}
          />
          {snapshot.config.targetDispatchMode === "ocr" && (ocrRouteDialogOpen || snapshot.ocrRouteSelection?.status === "analyzing") ? (
            <OcrRouteApprovalPanel
              selection={snapshot.ocrRouteSelection}
              selectedIds={selectedOcrOptionIds}
              busy={busy}
              onToggle={toggleOcrRouteOption}
              onConfirm={confirmOcrRoutes}
              onClose={() => setOcrRouteDialogOpen(false)}
            />
          ) : null}
          <RomaneioPanel
            romaneio={romaneio}
            settingsDraft={romaneioSettingsDraft}
            locateResult={romaneioLocateResult}
            busy={busy}
            onSettingsChange={setRomaneioSettingsDraft}
            onLocate={handleLocateRomaneio}
            onUpload={handleUploadRomaneio}
            onConfirmCandidate={handleConfirmRomaneio}
            onSaveSettings={handleSaveRomaneioSettings}
            error={romaneioError}
          />
          <LogsPanel logs={snapshot.logs.filter((log) => isImageOperationLog(log.message)).slice(-60)} />
        </section>
      ) : null}

      {activeTab === "test" ? (
        <section className="mobile-home">
          <section className="quick-panel test-command-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Grupo de teste</p>
                <h2>{testGroupLabel}</h2>
              </div>
              <span className={snapshot.testStatus?.active ? "mini-badge ok" : "mini-badge"}>
                {snapshot.testStatus?.active ? "Rodando" : "Parado"}
              </span>
            </div>
            <div className="review-grid">
              <article className="review-item ok">
                <span>Quantidade</span>
                <strong>{snapshot.config.testMessageCount || 15}</strong>
              </article>
              <article className="review-item ok">
                <span>Intervalo</span>
                <strong>{snapshot.config.testMessageIntervalMs || 0}ms</strong>
              </article>
              <article className="review-item ok">
                <span>Último teste</span>
                <strong>{snapshot.testStatus?.lastSentCount || 0}/{snapshot.testStatus?.configuredMessageCount || snapshot.config.testMessageCount || 15}</strong>
              </article>
            </div>
            <div className="review-actions">
              <button className="button" type="button" onClick={() => setGroupEditor("test")}>
                Configurar teste
              </button>
              {snapshot.testStatus?.active ? (
                <button className="button danger" disabled={busy} type="button" onClick={() => runAction(botApi.stopMonitoring)}>
                  Parar teste
                </button>
              ) : (
                <button className="button primary" disabled={busy || snapshot.status !== "connected"} type="button" onClick={confirmWarmup}>
                  Iniciar teste
                </button>
              )}
            </div>
          </section>
          <section className="quick-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Histórico de teste</p>
                <h2>{(snapshot.routeDispatches || []).filter((route) => route.mode === "test" || ["warmup", "target-simulation"].includes(getRouteTrigger(route))).length} registro(s)</h2>
              </div>
              <button className="button" type="button" onClick={confirmSimulateTargetDispatch}>
                Simular alvo
              </button>
              <button className="button" disabled={busy || snapshot.status !== "connected"} type="button" onClick={() => runAction(botApi.latencyProbe)}>
                Medir latência
              </button>
            </div>
            <div className="admin-route-scroll compact">
              {(snapshot.routeDispatches || [])
                .filter((route) => route.mode === "test" || ["warmup", "target-simulation"].includes(getRouteTrigger(route)))
                .slice(0, 12)
                .map((route) => <RouteRow key={`client-test-${route.id}`} route={route} />)}
            </div>
          </section>
          <LogsPanel logs={snapshot.logs.filter((log) => /teste|aquecimento|simulação/i.test(log.message)).slice(0, 80)} />
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="tab-stack">
          <LogsPanel logs={snapshot.logs.filter((log) => !isImageOperationLog(log.message))} />
          <PerformanceStrip snapshot={snapshot} />
          <SettingsPanel
            config={snapshot.config}
            busy={busy}
            monitoringEnabled={Boolean(snapshot.monitoringEnabled)}
            userEmail={userEmail}
            onClearLogs={confirmClearLogs}
            onFactoryReset={confirmFactoryReset}
            onEnableNotifications={handleEnableNotifications}
            notificationStatus={notificationStatus}
            onLogout={() => {
              logout();
            }}
          />
        </section>
      ) : null}

      <nav className="bottom-nav icon-nav" aria-label="Navegação principal">
        {tabs.map(({ id, label, Icon }) => {
          const badge =
            id === "test" && snapshot.testStatus?.active
              ? 1
              : id === "settings" && snapshot.logs.some((log) => log.level === "error" && !isImageOperationLog(log.message))
              ? snapshot.logs.filter((log) => log.level === "error" && !isImageOperationLog(log.message)).length
              : 0;
          return (
            <button
              key={id}
              aria-label={label}
              className={activeTab === id ? "active" : ""}
              title={label}
              type="button"
              onClick={() => setActiveTab(id)}
            >
              {badge ? <b className="nav-badge">{badge}</b> : null}
              <Icon size={22} />
              <span>{label}</span>
            </button>
          );
        })}
      </nav>

      {actionToast ? <div className={["action-toast", actionToast.tone ? `tone-${actionToast.tone}` : ""].filter(Boolean).join(" ")}>{actionToast.message}</div> : null}
      {groupEditor ? (
        <div className="modal-backdrop" role="presentation">
          <section className="sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="group-editor-title">
            <div className="sheet-heading">
              <div>
                <p className="panel-label">Configuração</p>
                <h2 id="group-editor-title">{groupEditor === "image" ? "Bot imagem" : groupEditor === "target" ? "Mensagens manuais" : "Teste abrir/fechar"}</h2>
              </div>
              <button className="icon-button" title="Fechar" type="button" onClick={() => setGroupEditor(undefined)}>
                <X size={20} />
              </button>
            </div>
            <GroupMessageCard
              kind={groupEditor === "image" ? "target" : groupEditor}
              targetMode={groupEditor === "image" ? "ocr" : "manual"}
              config={snapshot.config}
              groups={snapshot.groups}
              busy={busy}
              onRefresh={() => runAction(botApi.refreshGroups)}
              onSave={groupEditor === "target" || groupEditor === "image" ? confirmSaveTarget : confirmSaveTest}
              onSaveManual={undefined}
              onWarmup={groupEditor === "test" ? confirmWarmup : undefined}
              onSaveRoutePreset={groupEditor === "image" ? (name, routes) => runAction(() => botApi.saveRoutePreset({ name, routes })) : undefined}
              onDeleteRoutePreset={groupEditor === "image" ? (id) => runAction(() => botApi.deleteRoutePreset({ id })) : undefined}
            />
          </section>
        </div>
      ) : null}

      {confirmation ? (
        <div className="modal-backdrop" role="presentation">
          <section className={["confirmation-dialog", confirmation.tone ? `tone-${confirmation.tone}` : ""].filter(Boolean).join(" ")} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="panel-label">Confirmação</p>
            <h2 id="confirm-title">{confirmation.title}</h2>
            <p className="confirmation-message">{confirmation.message}</p>
            {confirmation.details.length ? (
              <div className="confirmation-details">
                {confirmation.details.map((detail, index) => (
                  <span key={`${detail}-${index}`}>{detail}</span>
                ))}
              </div>
            ) : null}
            <div className="confirmation-actions">
              <button className="button" disabled={busy} type="button" onClick={() => setConfirmation(undefined)}>
                Cancelar
              </button>
              <button className="button primary" disabled={busy} type="button" onClick={confirmPendingAction}>
                {confirmation.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {pendingClientIncident ? (
        <div className="modal-backdrop incident-lock-backdrop" role="presentation">
          <section className="confirmation-dialog incident-lock-dialog" role="dialog" aria-modal="true" aria-labelledby="incident-lock-title">
            <p className="panel-label">Ação obrigatória</p>
            <h2 id="incident-lock-title">Explique o que aconteceu</h2>
            <p className="confirmation-message">
              {pendingClientIncident.clientIncident?.message || "O admin precisa de uma explicação para liberar o bot."}
            </p>
            <div className="incident-summary-grid">
              <span>
                <b>Evento</b>
                {pendingClientIncident.clientIncident?.kind === "message_deleted" ? "Mensagem apagada" : "Líder removeu reação"}
              </span>
              <span>
                <b>Prazo</b>
                {pendingClientIncident.clientIncident?.snoozeCount ? `${pendingClientIncident.clientIncident.snoozeCount}/3 adiamentos usados` : "Primeira cobrança"}
              </span>
            </div>
            <div className="confirmation-details incident-audit-list">
              {pendingIncidentAuditLines.map((line) => (
                <span key={`${pendingClientIncident.id}-${line}`}>{line}</span>
              ))}
            </div>
            <div className="incident-choice">
              <button className={incidentValid ? "button primary" : "button"} type="button" onClick={() => setIncidentValid(true)}>
                Rota válida
              </button>
              <button className={!incidentValid ? "button danger" : "button"} type="button" onClick={() => setIncidentValid(false)}>
                Rota não válida
              </button>
            </div>
            <textarea
              className="incident-textarea"
              autoFocus
              value={incidentReason}
              onChange={(event) => setIncidentReason(event.target.value)}
              placeholder="Descreva o motivo: por que a reação foi removida ou por que a mensagem foi apagada?"
            />
            <div className="confirmation-actions">
              {pendingIncidentSnoozeDelay ? (
                <button className="button incident-snooze-button" disabled={busy} type="button" onClick={snoozePendingClientIncident}>
                  <Clock3 size={16} />
                  Responder daqui a {pendingIncidentSnoozeDelay} minutos
                </button>
              ) : (
                <span className="incident-final-warning">Adiamentos encerrados. A resposta é obrigatória.</span>
              )}
              <button className="button primary" disabled={busy || incidentReason.trim().length < 8} type="button" onClick={submitIncidentAnswer}>
                Enviar explicação e liberar bot
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
