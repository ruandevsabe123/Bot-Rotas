import { CSSProperties, ReactNode, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  Clock3,
  Download,
  FileJson,
  Gauge,
  History,
  Inbox,
  LogOut,
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  Wifi,
  X,
  Zap
} from "lucide-react";
import {
  AdminLogEntry,
  AdminMonitorSnapshot,
  AdminRoutesSnapshot,
  AdminSupportMessagesSnapshot,
  AdminUserDetail,
  AdminUserSummary,
  AdminUsersSnapshot,
  PanelUserRole,
  RouteDispatch,
  SupportMessage
} from "../../../shared/types";
import {
  bulkDecideAdminRoutes,
  clearAdminMaintenance,
  getAdminMonitor,
  getAdminUserDetail,
  isAuthError,
  markSupportMessageRead,
  rejectAdminRoute,
  runAdminUserBotAction,
  saveAdminUser,
  subscribeAdminMonitor,
  validateAdminRoute
} from "../api";

type AdminCommandCenterProps = {
  userEmail: string;
  onLogout: () => void;
};

type AdminPage = "dashboard" | "clients" | "validations" | "history" | "logs" | "support" | "reports" | "maintenance";
type DatePreset = "today" | "7d" | "30d" | "all";
type DecisionFilter = "all" | "pending" | "validated" | "rejected" | "leader" | "removed";
type ModeFilter = "all" | "target" | "test" | "manual" | "ocr" | "warmup" | "simulation";
type LogLevelFilter = "all" | "info" | "success" | "warning" | "error";
type CleanupTarget = "logs" | "routes" | "support" | "all";

type UserEditorState = {
  originalEmail?: string;
  email: string;
  password: string;
  role: PanelUserRole;
  blocked: boolean;
  color: string;
};

const emptyRoutes: AdminRoutesSnapshot = {
  routes: [],
  pendingReactionRoutes: [],
  totals: { routes: 0, validated: 0, rejected: 0, pending: 0, reactions: 0, removedReactions: 0, clients: 0 }
};

const emptyUsers: AdminUsersSnapshot = { users: [] };
const emptySupport: AdminSupportMessagesSnapshot = { messages: [], unread: 0 };

const emptyEditor: UserEditorState = {
  email: "",
  password: "",
  role: "client",
  blocked: false,
  color: "#38bdf8"
};

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString("pt-BR") : "Sem registro";
}

function formatShort(value?: string) {
  return value
    ? new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : "--";
}

function formatDuration(ms = 0) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours}h ${rest}m`;
  if (hours) return `${hours}h`;
  return `${rest}m`;
}

function routeDecision(route: RouteDispatch) {
  return route.decisionStatus || (route.validated ? "validated" : "pending");
}

function triggerLabel(route: RouteDispatch) {
  if (route.ocr) return "OCR imagem";
  if (route.trigger === "target-simulation") return "Simulação alvo";
  if (route.trigger === "simulation") return "Simulação abertura";
  if (route.trigger === "warmup") return "Aquecimento";
  if (route.trigger === "manual") return "Manual";
  if (route.mode === "test") return "Teste";
  return "Automático";
}

function reactionFinalLabel(route: RouteDispatch) {
  if (route.lastReactionState?.status === "removed") return "Reagiu e removeu";
  if (route.lastReactionState?.status === "active") return "Reagiu e manteve";
  if (route.reactions.length) return "Reagiu e manteve";
  return "Sem reação";
}

function hasLeaderReaction(route: RouteDispatch) {
  return route.reactions.some((reaction) => reaction.isAdmin) || route.reactionsHistory?.some((event) => event.isAdmin);
}

function colorStyle(color?: string) {
  return { "--client-color": color || "#38bdf8" } as CSSProperties;
}

function dateRangeMs(preset: DatePreset) {
  const now = Date.now();
  if (preset === "today") {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return { start: start.getTime(), end: now };
  }
  if (preset === "7d") return { start: now - 7 * 86400000, end: now };
  if (preset === "30d") return { start: now - 30 * 86400000, end: now };
  return { start: 0, end: Number.MAX_SAFE_INTEGER };
}

function downloadText(filename: string, content: string, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows: Array<Record<string, unknown>>) {
  const headers = Array.from(rows.reduce((set, row) => {
    Object.keys(row).forEach((key) => set.add(key));
    return set;
  }, new Set<string>()));
  const escape = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...rows.map((row) => headers.map((key) => escape(row[key])).join(","))].join("\n");
}

function MetricCard({
  title,
  value,
  detail,
  tone,
  Icon
}: {
  title: string;
  value: string | number;
  detail: string;
  tone: "blue" | "green" | "yellow" | "red";
  Icon: typeof Activity;
}) {
  return (
    <article className={`adminx-metric adminx-${tone}`}>
      <span><Icon size={20} /></span>
      <div>
        <small>{title}</small>
        <strong>{value}</strong>
        <em>{detail}</em>
      </div>
    </article>
  );
}

function StatusPill({ tone, children }: { tone: "blue" | "green" | "yellow" | "red" | "muted"; children: ReactNode }) {
  return <span className={`adminx-pill adminx-pill-${tone}`}>{children}</span>;
}

function UserEditor({
  value,
  busy,
  onChange,
  onCancel,
  onSave
}: {
  value: UserEditorState;
  busy: boolean;
  onChange: (value: UserEditorState) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <form className="adminx-editor" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <input type="email" placeholder="Email" value={value.email} onChange={(event) => onChange({ ...value, email: event.target.value })} />
      <input type="password" placeholder={value.originalEmail ? "Nova senha opcional" : "Senha"} value={value.password} onChange={(event) => onChange({ ...value, password: event.target.value })} />
      <select value={value.role} onChange={(event) => onChange({ ...value, role: event.target.value === "admin" ? "admin" : "client" })}>
        <option value="client">Cliente</option>
        <option value="admin">Admin</option>
      </select>
      <label className="adminx-check">
        <input type="checkbox" checked={value.blocked} onChange={(event) => onChange({ ...value, blocked: event.target.checked })} />
        Bloqueado
      </label>
      <input type="color" value={value.color} onChange={(event) => onChange({ ...value, color: event.target.value })} />
      <button className="button" type="button" onClick={onCancel}>Cancelar</button>
      <button className="button primary" disabled={busy || !value.email.trim() || (!value.originalEmail && !value.password.trim())} type="submit">
        Salvar
      </button>
    </form>
  );
}

function RouteSidePanel({
  route,
  onClose,
  onValidate,
  onReject
}: {
  route: RouteDispatch;
  onClose: () => void;
  onValidate: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <aside className="adminx-sidepanel" role="dialog" aria-modal="true">
        <header>
          <div>
            <p>{route.clientEmail}</p>
            <h2>{route.groupName || route.groupJid || "Grupo sem nome"}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Fechar"><X size={20} /></button>
        </header>
        <section className="adminx-detail-grid">
          <MetricCard Icon={Zap} tone="blue" title="Origem" value={triggerLabel(route)} detail={route.mode} />
          <MetricCard Icon={MessageSquareText} tone={route.lastReactionState?.status === "removed" ? "yellow" : route.reactions.length ? "green" : "blue"} title="Reação final" value={reactionFinalLabel(route)} detail={formatShort(route.lastReactionState?.updatedAt)} />
          <MetricCard Icon={SendIcon} tone={route.status === "sent" ? "green" : route.status === "failed" ? "red" : "yellow"} title="Envio" value={`${route.confirmedCount}/${route.totalCount}`} detail={route.status} />
          <MetricCard Icon={ShieldCheck} tone={routeDecision(route) === "validated" ? "green" : routeDecision(route) === "rejected" ? "red" : "yellow"} title="Decisão" value={routeDecision(route)} detail={route.validatedBy || route.rejectedBy || "pendente"} />
        </section>
        <section className="adminx-detail-section">
          <h3>Mensagens enviadas</h3>
          <div className="adminx-chip-stack">
            {route.messages.map((message, index) => <span key={`${route.id}-msg-${index}`}>{message}</span>)}
          </div>
        </section>
        {route.ocr ? (
          <section className="adminx-detail-section">
            <h3>OCR imagem</h3>
            <dl className="adminx-kv">
              <dt>Rota</dt><dd>{route.ocr.route || route.ocr.bairro || "Não registrada"}</dd>
              <dt>Código</dt><dd>{route.ocr.code || "Não registrado"}</dd>
              <dt>Fonte</dt><dd>{route.ocr.source}</dd>
              <dt>Confiança</dt><dd>{route.ocr.confidence ? `${route.ocr.confidence}%` : "Sem média"}</dd>
              <dt>Linha</dt><dd>{route.ocr.line || "Sem linha"}</dd>
            </dl>
            {route.ocr.text ? <pre className="adminx-ocr-text">{route.ocr.text}</pre> : null}
          </section>
        ) : null}
        <section className="adminx-detail-section">
          <h3>Reações</h3>
          {route.reactions.length ? route.reactions.map((reaction) => (
            <div className="adminx-reaction-row" key={reaction.id}>
              <b>{reaction.emoji || "?"}</b>
              <span>{reaction.isAdmin ? `Líder ${reaction.leaderName || ""}` : "Comum"}</span>
              <small>{reaction.senderPhone || reaction.senderJid}</small>
            </div>
          )) : <p className="adminx-empty-text">Nenhuma reação ativa registrada.</p>}
          {route.reactionsHistory?.length ? (
            <div className="adminx-history-events">
              {route.reactionsHistory.map((event) => (
                <span key={event.id}>
                  {event.action === "remove" ? "Removeu" : "Reagiu"} {event.emoji || ""} - {formatDate(event.timestamp)}
                </span>
              ))}
            </div>
          ) : null}
        </section>
        <footer>
          <button className="button primary" type="button" onClick={() => onValidate(route.id)}>Validar</button>
          <button className="button danger" type="button" onClick={() => onReject(route.id)}>Rejeitar</button>
        </footer>
      </aside>
    </div>
  );
}

const SendIcon = Zap;

function ClientSidePanel({
  detail,
  busy,
  onClose,
  onAction
}: {
  detail: AdminUserDetail;
  busy: boolean;
  onClose: () => void;
  onAction: (email: string, action: string) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <aside className="adminx-sidepanel wide" role="dialog" aria-modal="true">
        <header>
          <div>
            <p>{detail.role === "admin" ? "Administrador" : "Cliente"}</p>
            <h2>{detail.email}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} title="Fechar"><X size={20} /></button>
        </header>
        <section className="adminx-detail-grid">
          <MetricCard Icon={Activity} tone={detail.panelOnline ? "green" : "blue"} title="Painel" value={detail.presenceStatus} detail={formatShort(detail.lastSeenAt)} />
          <MetricCard Icon={Bot} tone={detail.monitoringEnabled ? "green" : "yellow"} title="Bot" value={detail.botStatus} detail={detail.monitoringMode || "parado"} />
          <MetricCard Icon={Clock3} tone="blue" title="Uso" value={formatDuration(detail.totalUsageMs)} detail={`${detail.loginCount} login(s)`} />
          <MetricCard Icon={History} tone="green" title="Rotas" value={detail.routes.length} detail="histórico salvo" />
        </section>
        <section className="adminx-detail-section">
          <h3>Configuração</h3>
          <dl className="adminx-kv">
            <dt>Nome envio</dt><dd>{detail.config.nomeEnvio || "Não configurado"}</dd>
            <dt>Grupo alvo</dt><dd>{detail.config.grupoAlvoNome || detail.config.grupoAlvoJid || "Não configurado"}</dd>
            <dt>Grupo teste</dt><dd>{detail.config.grupoTesteNome || detail.config.grupoTesteJid || "Não configurado"}</dd>
            <dt>Modo alvo</dt><dd>{detail.config.targetDispatchMode}{detail.config.nuclearMode ? " + nuclear" : ""}</dd>
            <dt>Sempre quente</dt><dd>{detail.config.alwaysWarmMode ? `ativo (${detail.config.keepAliveIntervalMs}ms)` : "desligado"}</dd>
          </dl>
        </section>
        <section className="adminx-action-row">
          <button className="button" disabled={busy} type="button" onClick={() => onAction(detail.email, "stop")}>Parar bot</button>
          <button className="button" disabled={busy} type="button" onClick={() => onAction(detail.email, "restart")}>Reiniciar</button>
          <button className="button danger" disabled={busy} type="button" onClick={() => onAction(detail.email, "clear-session")}>Reset sessão</button>
          <button className="button danger" disabled={busy} type="button" onClick={() => onAction(detail.email, "factory-reset")}>Factory reset</button>
        </section>
        <section className="adminx-detail-section">
          <h3>Histórico de login</h3>
          <div className="adminx-log-stack">
            {detail.loginHistory.slice(0, 12).map((event) => (
              <span key={event.id}>{formatDate(event.timestamp)} - {event.ip || "IP não identificado"} - {event.userAgent || "UA vazio"}</span>
            ))}
          </div>
        </section>
        <section className="adminx-detail-section">
          <h3>Logs recentes</h3>
          <div className="adminx-log-stack">
            {detail.logs.slice(0, 50).map((log) => (
              <span className={`adminx-logline adminx-log-${log.level}`} key={log.id}>{formatDate(log.timestamp)} - {log.message}</span>
            ))}
          </div>
        </section>
      </aside>
    </div>
  );
}

export function AdminCommandCenter({ userEmail, onLogout }: AdminCommandCenterProps) {
  const [routes, setRoutes] = useState<AdminRoutesSnapshot>(emptyRoutes);
  const [users, setUsers] = useState<AdminUsersSnapshot>(emptyUsers);
  const [support, setSupport] = useState<AdminSupportMessagesSnapshot>(emptySupport);
  const [logs, setLogs] = useState<AdminLogEntry[]>([]);
  const [page, setPage] = useState<AdminPage>("dashboard");
  const [clientFilter, setClientFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<DatePreset>("30d");
  const [search, setSearch] = useState("");
  const [decisionFilter, setDecisionFilter] = useState<DecisionFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [logLevel, setLogLevel] = useState<LogLevelFilter>("all");
  const [busy, setBusy] = useState(false);
  const [streamState, setStreamState] = useState<"connecting" | "live" | "fallback">("connecting");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [editor, setEditor] = useState<UserEditorState>();
  const [routeDetail, setRouteDetail] = useState<RouteDispatch>();
  const [clientDetail, setClientDetail] = useState<AdminUserDetail>();
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);
  const [cleanupTarget, setCleanupTarget] = useState<CleanupTarget>();

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  function applySnapshot(snapshot: AdminMonitorSnapshot) {
    setRoutes(snapshot.routes);
    setUsers(snapshot.users);
    setSupport(snapshot.support);
    setLogs(snapshot.logs);
    setStreamState("live");
    setError("");
  }

  function refresh() {
    getAdminMonitor()
      .then(applySnapshot)
      .catch((nextError) => {
        if (isAuthError(nextError)) {
          onLogout();
          return;
        }
        setStreamState("fallback");
        setError(nextError instanceof Error ? nextError.message : "Falha ao carregar painel admin.");
      });
  }

  useEffect(() => {
    refresh();
    const unsubscribe = subscribeAdminMonitor(applySnapshot, () => {
      setStreamState("fallback");
      refresh();
    });
    const polling = window.setInterval(() => {
      if (streamState === "fallback") refresh();
    }, 15000);
    return () => {
      unsubscribe();
      window.clearInterval(polling);
    };
  }, [streamState]);

  const clients = useMemo(() => users.users.filter((user) => user.role === "client"), [users.users]);
  const period = useMemo(() => dateRangeMs(datePreset), [datePreset]);

  const visibleRoutes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return routes.routes.filter((route) => {
      const created = new Date(route.createdAt).getTime();
      const clientOk = clientFilter === "all" || route.clientEmail === clientFilter;
      const dateOk = created >= period.start && created <= period.end;
      const decision = routeDecision(route);
      const decisionOk =
        decisionFilter === "all" ||
        decisionFilter === decision ||
        (decisionFilter === "leader" && hasLeaderReaction(route)) ||
        (decisionFilter === "removed" && route.lastReactionState?.status === "removed");
      const modeOk =
        modeFilter === "all" ||
        route.mode === modeFilter ||
        route.trigger === modeFilter ||
        (modeFilter === "ocr" && Boolean(route.ocr)) ||
        (modeFilter === "manual" && route.trigger === "manual");
      const queryOk = !query || [
        route.clientEmail,
        route.groupName,
        route.groupJid,
        triggerLabel(route),
        route.ocr?.text,
        route.ocr?.line,
        route.ocr?.route,
        ...route.messages,
        ...route.reactions.flatMap((reaction) => [reaction.senderPhone, reaction.leaderName || "", reaction.emoji])
      ].some((item) => String(item || "").toLowerCase().includes(query));
      return clientOk && dateOk && decisionOk && modeOk && queryOk;
    });
  }, [clientFilter, decisionFilter, modeFilter, period.end, period.start, routes.routes, search]);

  const visibleLogs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return logs.filter((log) => {
      const clientOk = clientFilter === "all" || log.clientEmail === clientFilter;
      const levelOk = logLevel === "all" || log.level === logLevel;
      const queryOk = !query || [log.clientEmail, log.level, log.message].some((item) => String(item).toLowerCase().includes(query));
      return clientOk && levelOk && queryOk;
    });
  }, [clientFilter, logLevel, logs, search]);

  const visibleSupport = useMemo(
    () => support.messages.filter((message) => clientFilter === "all" || message.email === clientFilter),
    [clientFilter, support.messages]
  );

  const pendingRoutes = visibleRoutes.filter((route) => routeDecision(route) === "pending");
  const leaderPending = pendingRoutes.filter(hasLeaderReaction);
  const removedReactionRoutes = visibleRoutes.filter((route) => route.lastReactionState?.status === "removed");
  const onlineClients = clients.filter((client) => client.presenceStatus === "online").length;
  const connectedBots = clients.filter((client) => ["connected", "connecting", "waiting_qr", "reconnecting"].includes(client.botStatus || "")).length;
  const activeBots = clients.filter((client) => client.monitoringEnabled).length;
  const validatedCount = visibleRoutes.filter((route) => routeDecision(route) === "validated").length;
  const validationRate = visibleRoutes.length ? Math.round((validatedCount / visibleRoutes.length) * 100) : 0;
  const ocrRoutes = visibleRoutes.filter((route) => Boolean(route.ocr));

  const hourlyChart = useMemo(() => {
    const slots = Array.from({ length: 24 }, (_, hour) => ({ hour, count: 0 }));
    visibleRoutes.forEach((route) => {
      slots[new Date(route.createdAt).getHours()].count += 1;
    });
    const max = Math.max(1, ...slots.map((slot) => slot.count));
    return slots.map((slot) => ({ ...slot, height: Math.max(5, Math.round((slot.count / max) * 100)) }));
  }, [visibleRoutes]);

  async function saveUser(next = editor) {
    if (!next) return;
    setBusy(true);
    try {
      setUsers(await saveAdminUser(next));
      setEditor(undefined);
      showToast("Usuário salvo.");
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui salvar usuário.");
    } finally {
      setBusy(false);
    }
  }

  async function openClient(email: string) {
    try {
      setClientDetail(await getAdminUserDetail(email));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui abrir cliente.");
    }
  }

  async function decideRoute(routeId: string, decision: "validate" | "reject", reason?: string) {
    setBusy(true);
    try {
      const nextRoutes = decision === "validate" ? await validateAdminRoute(routeId) : await rejectAdminRoute(routeId, reason);
      setRoutes(nextRoutes);
      setRouteDetail(undefined);
      showToast(decision === "validate" ? "Rota validada." : "Rota rejeitada.");
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui atualizar rota.");
    } finally {
      setBusy(false);
    }
  }

  async function decideSelected(decision: "validate" | "reject") {
    if (!selectedRoutes.length) return;
    setBusy(true);
    try {
      const nextRoutes = await bulkDecideAdminRoutes({ routeIds: selectedRoutes, decision });
      setRoutes(nextRoutes);
      setSelectedRoutes([]);
      showToast(`${nextRoutes.changed} rota(s) atualizada(s).`);
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Ação em lote falhou.");
    } finally {
      setBusy(false);
    }
  }

  async function readSupport(id: string) {
    try {
      setSupport(await markSupportMessageRead(id));
      showToast("Mensagem marcada como lida.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui marcar mensagem.");
    }
  }

  async function runClientAction(email: string, action: string) {
    setBusy(true);
    try {
      setClientDetail(await runAdminUserBotAction(email, action));
      showToast("Ação enviada para o bot do cliente.");
      refresh();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui executar ação no cliente.");
    } finally {
      setBusy(false);
    }
  }

  async function cleanup(target: CleanupTarget) {
    if (cleanupTarget !== target) {
      setCleanupTarget(target);
      return;
    }
    setBusy(true);
    try {
      applySnapshot(await clearAdminMaintenance({ target, clientEmail: clientFilter === "all" ? undefined : clientFilter }));
      setCleanupTarget(undefined);
      showToast("Limpeza concluída.");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui limpar dados.");
    } finally {
      setBusy(false);
    }
  }

  function exportRoutes(format: "csv" | "json") {
    const rows = visibleRoutes.map((route) => ({
      id: route.id,
      cliente: route.clientEmail,
      grupo: route.groupName || route.groupJid,
      origem: triggerLabel(route),
      decisao: routeDecision(route),
      envio: `${route.confirmedCount}/${route.totalCount}`,
      reacao_final: reactionFinalLabel(route),
      mensagens: route.messages.join(" | "),
      criado_em: route.createdAt
    }));
    if (format === "json") {
      downloadText("rotas-admin.json", JSON.stringify(visibleRoutes, null, 2), "application/json;charset=utf-8");
      return;
    }
    downloadText("rotas-admin.csv", toCsv(rows), "text/csv;charset=utf-8");
  }

  function toggleSelected(routeId: string) {
    setSelectedRoutes((current) => current.includes(routeId) ? current.filter((id) => id !== routeId) : [...current, routeId]);
  }

  const pages: Array<{ id: AdminPage; label: string; Icon: typeof Activity; badge?: number }> = [
    { id: "dashboard", label: "Dashboard", Icon: Gauge },
    { id: "clients", label: "Clientes", Icon: Users, badge: onlineClients },
    { id: "validations", label: "Validações", Icon: ShieldCheck, badge: pendingRoutes.length },
    { id: "history", label: "Histórico", Icon: History },
    { id: "logs", label: "Logs", Icon: Activity, badge: visibleLogs.filter((log) => log.level === "error").length },
    { id: "support", label: "Suporte", Icon: Inbox, badge: support.unread },
    { id: "reports", label: "Relatórios", Icon: FileJson },
    { id: "maintenance", label: "Manutenção", Icon: Settings }
  ];

  return (
    <main className="adminx-shell">
      <aside className="adminx-sidebar">
        <div className="adminx-brand">
          <Bot size={24} />
          <div>
            <strong>Bot Rotas</strong>
            <small>Admin Command</small>
          </div>
        </div>
        <nav>
          {pages.map(({ id, label, Icon, badge }) => (
            <button className={page === id ? "active" : ""} key={id} type="button" onClick={() => setPage(id)}>
              <Icon size={19} />
              <span>{label}</span>
              {badge ? <b>{badge}</b> : null}
            </button>
          ))}
        </nav>
        <button className="adminx-logout" type="button" onClick={onLogout}>
          <LogOut size={18} />
          {userEmail}
        </button>
      </aside>

      <section className="adminx-main">
        <header className="adminx-topbar">
          <div>
            <p>Central de comando</p>
            <h1>{pages.find((item) => item.id === page)?.label}</h1>
          </div>
          <div className="adminx-global-filters">
            <label>
              <Search size={17} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, grupo, OCR, log..." />
            </label>
            <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}>
              <option value="all">Todos os clientes</option>
              {clients.map((client) => <option key={client.email} value={client.email}>{client.email}</option>)}
            </select>
            <select value={datePreset} onChange={(event) => setDatePreset(event.target.value as DatePreset)}>
              <option value="today">Hoje</option>
              <option value="7d">7 dias</option>
              <option value="30d">30 dias</option>
              <option value="all">Tudo</option>
            </select>
            <StatusPill tone={streamState === "live" ? "green" : streamState === "fallback" ? "yellow" : "blue"}>
              {streamState === "live" ? "SSE ao vivo" : streamState === "fallback" ? "Polling" : "Conectando"}
            </StatusPill>
            <button className="icon-button" type="button" title="Atualizar" onClick={refresh}><RefreshCw size={19} /></button>
          </div>
        </header>

        {error ? <div className="adminx-error"><AlertTriangle size={18} />{error}</div> : null}

        {page === "dashboard" ? (
          <section className="adminx-page">
            <div className="adminx-metrics">
              <MetricCard Icon={Wifi} tone="green" title="Clientes online" value={onlineClients} detail={`${connectedBots} bots conectados`} />
              <MetricCard Icon={Bot} tone="blue" title="Monitoramentos" value={activeBots} detail="ativos agora" />
              <MetricCard Icon={ShieldCheck} tone="yellow" title="Pendentes" value={pendingRoutes.length} detail={`${leaderPending.length} com líder`} />
              <MetricCard Icon={Inbox} tone="red" title="Suporte" value={support.unread} detail="não lidas" />
              <MetricCard Icon={CheckCircle2} tone="green" title="Taxa validação" value={`${validationRate}%`} detail={`${validatedCount}/${visibleRoutes.length}`} />
              <MetricCard Icon={MessageSquareText} tone="yellow" title="Reações removidas" value={removedReactionRoutes.length} detail="auditáveis" />
            </div>

            <section className="adminx-dashboard-grid">
              <article className="adminx-panel">
                <div className="adminx-panel-head">
                  <div><p>Prioridade</p><h2>Fila de validação</h2></div>
                  <button className="button" type="button" onClick={() => setPage("validations")}>Abrir</button>
                </div>
                <RouteTable routes={pendingRoutes.slice(0, 6)} selectedRoutes={selectedRoutes} compact onSelect={toggleSelected} onOpen={setRouteDetail} onValidate={(id) => decideRoute(id, "validate")} onReject={(id) => decideRoute(id, "reject")} />
              </article>
              <article className="adminx-panel">
                <div className="adminx-panel-head">
                  <div><p>Disparos por hora</p><h2>{visibleRoutes.length} no período</h2></div>
                </div>
                <div className="adminx-bars">
                  {hourlyChart.map((slot) => (
                    <span key={slot.hour} style={{ height: `${slot.height}%` }} title={`${slot.hour}h: ${slot.count}`} />
                  ))}
                </div>
              </article>
              <article className="adminx-panel">
                <div className="adminx-panel-head">
                  <div><p>Tempo real</p><h2>Últimos logs</h2></div>
                  <button className="button" type="button" onClick={() => setPage("logs")}>Ver logs</button>
                </div>
                <LogList logs={visibleLogs.slice(0, 10)} />
              </article>
              <article className="adminx-panel">
                <div className="adminx-panel-head">
                  <div><p>OCR</p><h2>{ocrRoutes.length} disparos por imagem</h2></div>
                  <button className="button" type="button" onClick={() => { setModeFilter("ocr"); setPage("history"); }}>Auditar</button>
                </div>
                <div className="adminx-ocr-list">
                  {ocrRoutes.slice(0, 8).map((route) => (
                    <button key={`ocr-${route.id}`} type="button" onClick={() => setRouteDetail(route)}>
                      <strong>{route.ocr?.route || route.ocr?.bairro || route.messages[0]}</strong>
                      <small>{route.clientEmail} - {route.ocr?.source}</small>
                    </button>
                  ))}
                  {!ocrRoutes.length ? <p className="adminx-empty-text">Nenhum OCR no filtro atual.</p> : null}
                </div>
              </article>
            </section>
          </section>
        ) : null}

        {page === "clients" ? (
          <section className="adminx-page">
            <div className="adminx-page-actions">
              <button className="button primary" type="button" onClick={() => setEditor(emptyEditor)}><UserPlus size={18} />Adicionar usuário</button>
              <button className="button" type="button" onClick={() => exportRoutes("csv")}><Download size={18} />Exportar rotas</button>
            </div>
            {editor ? <UserEditor value={editor} busy={busy} onChange={setEditor} onCancel={() => setEditor(undefined)} onSave={() => saveUser()} /> : null}
            <ClientsTable users={users.users} onOpen={openClient} onEdit={(user) => setEditor({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: user.blocked, color: user.color })} onToggleBlock={(user) => saveUser({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: !user.blocked, color: user.color })} />
          </section>
        ) : null}

        {page === "validations" ? (
          <section className="adminx-page">
            <RouteFilters decisionFilter={decisionFilter} modeFilter={modeFilter} onDecision={setDecisionFilter} onMode={setModeFilter} />
            <div className="adminx-page-actions">
              <StatusPill tone="yellow">{selectedRoutes.length} selecionada(s)</StatusPill>
              <button className="button primary" disabled={!selectedRoutes.length || busy} type="button" onClick={() => decideSelected("validate")}>Validar lote</button>
              <button className="button danger" disabled={!selectedRoutes.length || busy} type="button" onClick={() => decideSelected("reject")}>Rejeitar lote</button>
            </div>
            <RouteTable routes={pendingRoutes} selectedRoutes={selectedRoutes} onSelect={toggleSelected} onOpen={setRouteDetail} onValidate={(id) => decideRoute(id, "validate")} onReject={(id) => decideRoute(id, "reject")} />
          </section>
        ) : null}

        {page === "history" ? (
          <section className="adminx-page">
            <RouteFilters decisionFilter={decisionFilter} modeFilter={modeFilter} onDecision={setDecisionFilter} onMode={setModeFilter} />
            <div className="adminx-page-actions">
              <button className="button" type="button" onClick={() => exportRoutes("csv")}><Download size={18} />CSV</button>
              <button className="button" type="button" onClick={() => exportRoutes("json")}><FileJson size={18} />JSON</button>
            </div>
            <RouteTable routes={visibleRoutes} selectedRoutes={selectedRoutes} onSelect={toggleSelected} onOpen={setRouteDetail} onValidate={(id) => decideRoute(id, "validate")} onReject={(id) => decideRoute(id, "reject")} />
          </section>
        ) : null}

        {page === "logs" ? (
          <section className="adminx-page">
            <div className="adminx-page-actions">
              <select value={logLevel} onChange={(event) => setLogLevel(event.target.value as LogLevelFilter)}>
                <option value="all">Todos os níveis</option>
                <option value="success">Sucesso</option>
                <option value="info">Info</option>
                <option value="warning">Aviso</option>
                <option value="error">Erro</option>
              </select>
              <button className="button danger" type="button" onClick={() => cleanup("logs")}><Trash2 size={18} />{cleanupTarget === "logs" ? "Confirmar limpar logs" : "Limpar logs"}</button>
            </div>
            <LogList logs={visibleLogs} full />
          </section>
        ) : null}

        {page === "support" ? (
          <section className="adminx-page">
            <SupportList messages={visibleSupport} onRead={readSupport} />
          </section>
        ) : null}

        {page === "reports" ? (
          <section className="adminx-page">
            <div className="adminx-metrics">
              <MetricCard Icon={History} tone="blue" title="Rotas" value={visibleRoutes.length} detail="no filtro" />
              <MetricCard Icon={CheckCircle2} tone="green" title="Validadas" value={validatedCount} detail={`${validationRate}%`} />
              <MetricCard Icon={Ban} tone="red" title="Rejeitadas" value={visibleRoutes.filter((route) => routeDecision(route) === "rejected").length} detail="julgadas" />
              <MetricCard Icon={MessageSquareText} tone="yellow" title="Líder" value={visibleRoutes.filter(hasLeaderReaction).length} detail="com reação" />
            </div>
            <article className="adminx-panel">
              <div className="adminx-panel-head">
                <div><p>Por cliente</p><h2>Relatório operacional</h2></div>
                <button className="button" type="button" onClick={() => exportRoutes("csv")}>Exportar CSV</button>
              </div>
              <ReportTable clients={clients} routes={visibleRoutes} />
            </article>
          </section>
        ) : null}

        {page === "maintenance" ? (
          <section className="adminx-page">
            <article className="adminx-panel">
              <div className="adminx-panel-head">
                <div><p>Escopo</p><h2>{clientFilter === "all" ? "Todos os clientes" : clientFilter}</h2></div>
              </div>
              <div className="adminx-maintenance-grid">
                {[
                  ["logs", "Limpar logs", "Apaga eventos salvos do bot"],
                  ["routes", "Limpar histórico", "Apaga disparos/validações"],
                  ["support", "Limpar suporte", "Apaga mensagens internas"],
                  ["all", "Limpar tudo", "Logs, rotas e suporte"]
                ].map(([target, title, detail]) => (
                  <button className={cleanupTarget === target ? "adminx-danger-card confirm" : "adminx-danger-card"} disabled={busy} key={target} type="button" onClick={() => cleanup(target as CleanupTarget)}>
                    <Trash2 size={20} />
                    <strong>{cleanupTarget === target ? `Confirmar ${title}` : title}</strong>
                    <span>{detail}</span>
                  </button>
                ))}
              </div>
            </article>
          </section>
        ) : null}
      </section>

      <nav className="adminx-bottom-nav">
        {pages.slice(0, 5).map(({ id, label, Icon, badge }) => (
          <button className={page === id ? "active" : ""} key={id} type="button" onClick={() => setPage(id)}>
            {badge ? <b>{badge}</b> : null}
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {routeDetail ? <RouteSidePanel route={routeDetail} onClose={() => setRouteDetail(undefined)} onValidate={(id) => decideRoute(id, "validate")} onReject={(id) => decideRoute(id, "reject")} /> : null}
      {clientDetail ? <ClientSidePanel detail={clientDetail} busy={busy} onClose={() => setClientDetail(undefined)} onAction={runClientAction} /> : null}
      {toast ? <div className="action-toast">{toast}</div> : null}
    </main>
  );
}

function RouteFilters({
  decisionFilter,
  modeFilter,
  onDecision,
  onMode
}: {
  decisionFilter: DecisionFilter;
  modeFilter: ModeFilter;
  onDecision: (value: DecisionFilter) => void;
  onMode: (value: ModeFilter) => void;
}) {
  return (
    <div className="adminx-page-actions">
      <select value={decisionFilter} onChange={(event) => onDecision(event.target.value as DecisionFilter)}>
        <option value="all">Todos status</option>
        <option value="pending">Pendentes</option>
        <option value="validated">Validadas</option>
        <option value="rejected">Rejeitadas</option>
        <option value="leader">Com líder</option>
        <option value="removed">Reação removida</option>
      </select>
      <select value={modeFilter} onChange={(event) => onMode(event.target.value as ModeFilter)}>
        <option value="all">Todas origens</option>
        <option value="target">Alvo</option>
        <option value="test">Teste</option>
        <option value="manual">Manual</option>
        <option value="ocr">OCR imagem</option>
        <option value="warmup">Aquecimento</option>
        <option value="simulation">Simulação</option>
      </select>
    </div>
  );
}

function RouteTable({
  routes,
  selectedRoutes,
  compact = false,
  onSelect,
  onOpen,
  onValidate,
  onReject
}: {
  routes: RouteDispatch[];
  selectedRoutes: string[];
  compact?: boolean;
  onSelect: (id: string) => void;
  onOpen: (route: RouteDispatch) => void;
  onValidate: (id: string) => void;
  onReject: (id: string) => void;
}) {
  return (
    <div className={compact ? "adminx-table-wrap compact" : "adminx-table-wrap"}>
      <table className="adminx-table">
        <thead>
          <tr>
            <th />
            <th>Cliente</th>
            <th>Modo</th>
            <th>Trigger</th>
            <th>Mensagens</th>
            <th>Status Final da Reação</th>
            <th>Envio</th>
            <th>Data</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {routes.map((route) => (
            <tr key={route.id} style={colorStyle(route.clientColor)}>
              <td data-label="Selecionar"><input type="checkbox" checked={selectedRoutes.includes(route.id)} onChange={() => onSelect(route.id)} /></td>
              <td data-label="Cliente"><span className="adminx-client-dot" />{route.clientEmail}</td>
              <td data-label="Modo">{route.ocr ? <StatusPill tone="blue">OCR</StatusPill> : <StatusPill tone={route.mode === "test" ? "yellow" : "green"}>{route.mode}</StatusPill>}</td>
              <td data-label="Trigger">{triggerLabel(route)}</td>
              <td data-label="Mensagens"><button className="adminx-link-cell" type="button" onClick={() => onOpen(route)}>{route.messages.join(" | ") || "Sem mensagem"}</button></td>
              <td data-label="Reação final"><StatusPill tone={route.lastReactionState?.status === "removed" ? "yellow" : route.reactions.length ? "green" : "muted"}>{reactionFinalLabel(route)}</StatusPill></td>
              <td data-label="Envio">{route.confirmedCount}/{route.totalCount} - {route.status}</td>
              <td data-label="Data">{formatShort(route.createdAt)}</td>
              <td data-label="Ações">
                <div className="adminx-row-actions">
                  <button className="button" type="button" onClick={() => onOpen(route)}>Ver</button>
                  <button className="button primary" type="button" onClick={() => onValidate(route.id)}>Validar</button>
                  <button className="button danger" type="button" onClick={() => onReject(route.id)}>Rejeitar</button>
                </div>
              </td>
            </tr>
          ))}
          {!routes.length ? (
            <tr><td colSpan={9}><p className="adminx-empty-text">Nenhuma rota encontrada.</p></td></tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function ClientsTable({
  users,
  onOpen,
  onEdit,
  onToggleBlock
}: {
  users: AdminUserSummary[];
  onOpen: (email: string) => void;
  onEdit: (user: AdminUserSummary) => void;
  onToggleBlock: (user: AdminUserSummary) => void;
}) {
  return (
    <div className="adminx-table-wrap">
      <table className="adminx-table">
        <thead>
          <tr>
            <th>Usuário</th>
            <th>Role</th>
            <th>Painel</th>
            <th>Bot</th>
            <th>Monitoramento</th>
            <th>Último visto</th>
            <th>Uso</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.email} style={colorStyle(user.color)}>
              <td data-label="Usuário"><span className="adminx-client-dot" />{user.email}</td>
              <td data-label="Role">{user.role}</td>
              <td data-label="Painel"><StatusPill tone={user.blocked ? "red" : user.presenceStatus === "online" ? "green" : user.presenceStatus === "recent" ? "yellow" : "muted"}>{user.blocked ? "bloqueado" : user.presenceStatus}</StatusPill></td>
              <td data-label="Bot">{user.botStatus || "fechado"}</td>
              <td data-label="Monitoramento">{user.monitoringEnabled ? <StatusPill tone="green">ativo</StatusPill> : <StatusPill tone="muted">parado</StatusPill>}</td>
              <td data-label="Último visto">{formatShort(user.lastSeenAt)}</td>
              <td data-label="Uso">{formatDuration(user.totalUsageMs)}</td>
              <td data-label="Ações">
                <div className="adminx-row-actions">
                  <button className="button" type="button" onClick={() => onOpen(user.email)}>Detalhes</button>
                  <button className="button" type="button" onClick={() => onEdit(user)}>Editar</button>
                  <button className={user.blocked ? "button primary" : "button danger"} type="button" onClick={() => onToggleBlock(user)}>{user.blocked ? "Liberar" : "Bloquear"}</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LogList({ logs, full = false }: { logs: AdminLogEntry[]; full?: boolean }) {
  return (
    <div className={full ? "adminx-log-list full" : "adminx-log-list"}>
      {logs.map((log) => (
        <article className={`adminx-log-row adminx-log-${log.level}`} key={`${log.clientEmail}-${log.id}`} style={colorStyle(log.clientColor)}>
          <span>{formatShort(log.timestamp)}</span>
          <b>{log.clientEmail}</b>
          <p>{log.message}</p>
        </article>
      ))}
      {!logs.length ? <p className="adminx-empty-text">Nenhum log encontrado.</p> : null}
    </div>
  );
}

function SupportList({ messages, onRead }: { messages: SupportMessage[]; onRead: (id: string) => void }) {
  return (
    <div className="adminx-support-list">
      {messages.map((message) => (
        <article className={message.read ? "adminx-support-row" : "adminx-support-row unread"} key={message.id} style={colorStyle(message.clientColor)}>
          <div>
            <span className="adminx-client-dot" />
            <strong>{message.email}</strong>
            <small>{formatDate(message.createdAt)}</small>
          </div>
          <p>{message.message}</p>
          <small>{message.userAgent || "Sem user-agent"}</small>
          {!message.read ? <button className="button" type="button" onClick={() => onRead(message.id)}>Marcar lida</button> : null}
        </article>
      ))}
      {!messages.length ? <p className="adminx-empty-text">Nenhuma mensagem de suporte.</p> : null}
    </div>
  );
}

function ReportTable({ clients, routes }: { clients: AdminUserSummary[]; routes: RouteDispatch[] }) {
  const rows = clients.map((client) => {
    const clientRoutes = routes.filter((route) => route.clientEmail === client.email);
    const valid = clientRoutes.filter((route) => routeDecision(route) === "validated").length;
    const rejected = clientRoutes.filter((route) => routeDecision(route) === "rejected").length;
    const pending = clientRoutes.filter((route) => routeDecision(route) === "pending").length;
    const leader = clientRoutes.filter(hasLeaderReaction).length;
    const rate = clientRoutes.length ? Math.round((valid / clientRoutes.length) * 100) : 0;
    return { client, clientRoutes, valid, rejected, pending, leader, rate };
  });

  return (
    <div className="adminx-table-wrap">
      <table className="adminx-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Total</th>
            <th>Validadas</th>
            <th>Pendentes</th>
            <th>Rejeitadas</th>
            <th>Reações líder</th>
            <th>Taxa</th>
            <th>Último disparo</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.client.email} style={colorStyle(row.client.color)}>
              <td data-label="Cliente"><span className="adminx-client-dot" />{row.client.email}</td>
              <td data-label="Total">{row.clientRoutes.length}</td>
              <td data-label="Validadas">{row.valid}</td>
              <td data-label="Pendentes">{row.pending}</td>
              <td data-label="Rejeitadas">{row.rejected}</td>
              <td data-label="Reações líder">{row.leader}</td>
              <td data-label="Taxa">{row.rate}%</td>
              <td data-label="Último disparo">{formatShort(row.clientRoutes[0]?.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
