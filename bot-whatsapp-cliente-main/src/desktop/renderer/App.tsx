import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Ban,
  Bot,
  Clock3,
  Edit3,
  Flame,
  Gauge,
  Home,
  Info,
  LockKeyhole,
  Mail,
  MessageSquareText,
  RefreshCw,
  Route,
  Save,
  Shield,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TestTube2,
  UserPlus,
  Users,
  X,
  Zap
} from "lucide-react";
import { AdminRoutesSnapshot, AdminUserDetail, AdminUserSummary, AdminUsersSnapshot, BotSnapshot, PanelUserRole, RouteDispatch } from "../../shared/types";
import { ControlButtons } from "./components/ControlButtons";
import { GroupMessageCard } from "./components/GroupMessageCard";
import { LogsPanel } from "./components/LogsPanel";
import { QrCodeBox } from "./components/QrCodeBox";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  botApi,
  getAdminRoutes,
  getAdminUserDetail,
  getAdminUsers,
  getPanelMe,
  getPanelToken,
  getPanelUserEmail,
  getPanelUserRole,
  isAuthError,
  panelLogin,
  saveAdminUser,
  setPanelPassword,
  setPanelToken,
  setPanelUserEmail,
  setPanelUserRole
} from "./api";
import "./styles.css";

type PendingConfirmation = {
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
};

type AppTab = "home" | "messages" | "logs" | "settings";
type GroupEditor = "target" | "test" | undefined;

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
    nuclearMode: false,
    codigosMensagensAlvo: [],
    codigosMensagensTeste: []
  },
  groups: [],
  readinessChecks: [],
  logs: []
};

const tabs: Array<{ id: AppTab; label: string; Icon: typeof Home }> = [
  { id: "home", label: "Inicio", Icon: Home },
  { id: "messages", label: "Mensagens", Icon: MessageSquareText },
  { id: "logs", label: "Logs", Icon: Activity },
  { id: "settings", label: "Ajustes", Icon: Settings }
];

function normalizeMessages(senderName: string, codes: string[]) {
  return codes.map((code) => `${senderName.trim()} ${code.trim().toUpperCase()}`.trim()).filter(Boolean);
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

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(email.trim(), password);
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
        {error ? <p className="login-error">{error}</p> : null}
        <button className="button primary" disabled={!email.trim() || !password} type="submit">
          Entrar
        </button>
      </form>
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

function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}min`;
  if (hours) return `${hours}h`;
  return `${minutes}min`;
}

function CockpitCard({
  title,
  value,
  detail,
  tone,
  Icon
}: {
  title: string;
  value: string | number;
  detail: string;
  tone: "yellow" | "green" | "blue" | "red";
  Icon: typeof Home;
}) {
  return (
    <article className={`cockpit-card cockpit-${tone}`}>
      <span>
        <Icon size={20} />
      </span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
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
  const connectionValue = snapshot.status === "connected" ? "Online" : snapshot.status === "waiting_qr" ? "QR" : "Off";
  const groupValue =
    snapshot.groupState === "closed" ? "Fechado" : snapshot.groupState === "open" ? "Aberto" : "Validando";
  const armedValue = snapshot.monitoringEnabled ? "Armado" : "Parado";
  const lastOpening = getLastLogTime(snapshot.logs, [/ABRIU/i, /Palavra de abertura/i, /Abertura simulada/i]);
  const lastDispatch = getLastLogTime(snapshot.logs, [/Disparo .*conclu/i, /Mensagem alvo \d+ enviada/i, /Mensagem \d+ confirmada/i]);
  const confirmed = countConfirmedMessages(snapshot.logs);

  return (
    <section className="cockpit-grid" aria-label="Cockpit do bot">
      <CockpitCard Icon={Gauge} tone="green" title="Conexão" value={connectionValue} detail={groupLabel} />
      <CockpitCard Icon={ShieldCheck} tone="yellow" title="Grupo" value={groupValue} detail={armedValue} />
      <CockpitCard Icon={Clock3} tone="blue" title="Última abertura" value={lastOpening} detail="real ou simulada" />
      <CockpitCard Icon={Zap} tone="yellow" title="Último disparo" value={lastDispatch} detail={`${confirmed} mensagens confirmadas`} />
    </section>
  );
}

function AdminMetric({ title, value, detail }: { title: string; value: string | number; detail: string }) {
  return (
    <article className="admin-metric">
      <span>{title}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function RouteRow({ route }: { route: RouteDispatch }) {
  const createdAt = new Date(route.createdAt).toLocaleString("pt-BR");
  const lastReaction = route.reactions[0];

  return (
    <article className={route.validated ? "route-row validated" : "route-row"}>
      <div className="route-row-main">
        <div>
          <p className="panel-label">{route.clientEmail || "Cliente"}</p>
          <h2>{route.groupName || route.groupJid || "Grupo sem nome"}</h2>
        </div>
        <span className={route.validated ? "route-status ok" : "route-status"}>{route.validated ? "Validada" : "Pendente"}</span>
      </div>
      <div className="route-meta">
        <span>{createdAt}</span>
        <span>{route.confirmedCount}/{route.totalCount} enviadas</span>
        <span>{route.reactions.length} reações</span>
      </div>
      <div className="route-messages">
        {route.messages.map((message, index) => (
          <span key={`${route.id}-${message}-${index}`}>{message}</span>
        ))}
      </div>
      {lastReaction ? (
        <div className="reaction-line">
          <b>{lastReaction.emoji || "Reação"}</b>
          <span>{lastReaction.senderPhone || "sem telefone"}{lastReaction.isAdmin ? " · admin" : ""}</span>
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
};

const emptyUserEditor: UserEditorState = {
  email: "",
  password: "",
  role: "client",
  blocked: false
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
    <article className={user.blocked ? "user-row blocked" : "user-row"}>
      <div>
        <p className="panel-label">{user.role === "admin" ? "Admin" : "Cliente"}</p>
        <h2>{user.email}</h2>
        <div className="route-meta">
          <span>Último login: {formatDate(user.lastLoginAt)}</span>
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
          <AdminMetric title="Uso" value={formatDuration(detail.totalUsageMs)} detail={`${detail.loginCount} login(s)`} />
          <AdminMetric title="Bot" value={detail.botStatus} detail={detail.monitoringEnabled ? "monitorando" : "parado"} />
          <AdminMetric title="Zap" value={formatDate(detail.lastWhatsAppConnectionAt)} detail="última conexão detectada" />
          <AdminMetric title="Rotas" value={detail.routes.length} detail="histórico salvo" />
        </section>

        <section className="detail-section">
          <p className="panel-label">Configuração do usuário</p>
          <div className="detail-list">
            <span>Nome configurado: <b>{detail.config.nomeEnvio || "Não configurado"}</b></span>
            <span>Grupo alvo: <b>{detail.config.grupoAlvoNome || detail.config.grupoAlvoJid || "Não configurado"}</b></span>
            <span>Grupo teste: <b>{detail.config.grupoTesteNome || detail.config.grupoTesteJid || "Não configurado"}</b></span>
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
          <p className="panel-label">Últimos logs do bot</p>
          <div className="detail-list">
            {detail.logs.length ? detail.logs.slice(0, 8).map((log) => (
              <span key={log.id}>{formatDate(log.timestamp)} · {log.message}</span>
            )) : <span>Nenhum log registrado.</span>}
          </div>
        </section>
      </section>
    </div>
  );
}

function AdminDashboard({ userEmail, onLogout }: { userEmail: string; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<AdminRoutesSnapshot>({
    routes: [],
    totals: { routes: 0, validated: 0, reactions: 0, clients: 0 }
  });
  const [usersDashboard, setUsersDashboard] = useState<AdminUsersSnapshot>({ users: [] });
  const [editor, setEditor] = useState<UserEditorState>();
  const [detail, setDetail] = useState<AdminUserDetail>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function refresh() {
    Promise.all([getAdminRoutes(), getAdminUsers()])
      .then(([nextRoutes, nextUsers]) => {
        setDashboard(nextRoutes);
        setUsersDashboard(nextUsers);
        setError("");
      })
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
    const interval = window.setInterval(refresh, 3000);
    return () => window.clearInterval(interval);
  }, []);

  async function saveUser(nextEditor = editor) {
    if (!nextEditor) return;
    setBusy(true);
    try {
      const nextUsers = await saveAdminUser(nextEditor);
      setUsersDashboard(nextUsers);
      setEditor(undefined);
      setError("");
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

  return (
    <main className="app-shell admin-shell">
      <section className="topbar app-topbar">
        <div>
          <p className="eyebrow">Monitoramento admin</p>
          <h1>Rotas</h1>
        </div>
        <div className="group-pill">
          <span>Administrador</span>
          <strong>{userEmail}</strong>
        </div>
      </section>

      <section className="admin-grid">
        <AdminMetric title="Rotas" value={dashboard.totals.routes} detail="disparos registrados" />
        <AdminMetric title="Validadas" value={dashboard.totals.validated} detail="por reação admin" />
        <AdminMetric title="Reações" value={dashboard.totals.reactions} detail="recebidas no WhatsApp" />
        <AdminMetric title="Usuários" value={usersDashboard.users.length} detail={`${dashboard.totals.clients} com rotas`} />
      </section>

      <section className="quick-panel admin-list-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-label">Acessos</p>
            <h2>Usuários do painel</h2>
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
              onEdit={() => setEditor({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: user.blocked })}
              onToggleBlock={() => saveUser({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: !user.blocked })}
            />
          ))}
        </div>
      </section>

      <section className="quick-panel admin-list-panel">
        <div className="panel-heading">
          <div>
            <p className="panel-label">Histórico</p>
            <h2>Rotas enviadas pelos clientes</h2>
          </div>
          <button className="button" type="button" onClick={onLogout}>
            <Route size={18} />
            Sair
          </button>
        </div>
        {error ? <p className="login-error">{error}</p> : null}
        <div className="route-list">
          {dashboard.routes.length ? (
            dashboard.routes.map((route) => <RouteRow key={route.id} route={route} />)
          ) : (
            <p className="qr-empty">Nenhuma rota enviada ainda.</p>
          )}
        </div>
      </section>

      {detail ? <UserDetailModal detail={detail} onClose={() => setDetail(undefined)} /> : null}
    </main>
  );
}

export default function App() {
  const [snapshot, setSnapshot] = useState<BotSnapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [groupEditor, setGroupEditor] = useState<GroupEditor>();
  const [authenticated, setAuthenticated] = useState(Boolean(window.botApi || getPanelToken()));
  const [userEmail, setUserEmail] = useState(getPanelUserEmail());
  const [userRole, setUserRole] = useState<PanelUserRole>(getPanelUserRole());
  const [sessionChecked, setSessionChecked] = useState(Boolean(window.botApi || !getPanelToken()));
  const [loginError, setLoginError] = useState("");
  const [alertFlash, setAlertFlash] = useState(false);
  const [lastAlertLogId, setLastAlertLogId] = useState("");
  const nuclearArmed = Boolean(snapshot.monitoringEnabled && snapshot.monitoringMode === "target" && snapshot.config.nuclearMode);

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
          logout("Faça login novamente.");
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
          setPanelToken("");
          setPanelUserEmail("");
          setPanelUserRole("");
          setUserEmail("");
          setUserRole("client");
          setAuthenticated(false);
          setLoginError("Faça login para continuar.");
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

  const groupLabel = useMemo(() => {
    return snapshot.config.grupoAlvoNome || "Nenhum grupo alvo";
  }, [snapshot.config]);

  const testGroupLabel = useMemo(() => {
    return snapshot.config.grupoTesteNome || "Nenhum teste salvo";
  }, [snapshot.config]);

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
      return nextSnapshot;
    } catch (error) {
      if (isAuthError(error)) {
        setPanelToken("");
        setPanelUserEmail("");
        setPanelUserRole("");
        setUserEmail("");
        setUserRole("client");
        setPanelPassword("");
        setAuthenticated(false);
        setLoginError("Entre novamente para continuar.");
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

  function buildMessagePreview(senderName = snapshot.config.nomeEnvio, codes = snapshot.config.codigosMensagensAlvo) {
    return normalizeMessages(senderName, codes || []);
  }

  function confirmSaveTarget(group: string, groupId: string | undefined, groupName: string | undefined, senderName: string, codes: string[]) {
    const selectedGroupName = groupName || group;
    const messages = buildMessagePreview(senderName, codes);

    setConfirmation({
      title: "Salvar alvo",
      message: `Grupo alvo: ${selectedGroupName}`,
      details: messages.length ? messages : ["Nenhuma mensagem pronta."],
      confirmLabel: "Salvar alvo",
      onConfirm: async () => {
        await runAction(async () => {
          await botApi.saveGroup({ group, groupId, groupName });
          setGroupEditor(undefined);
          return botApi.saveTargetMessageSettings({ senderName, codes });
        });
      }
    });
  }

  function confirmSaveTest(group: string, groupId: string | undefined, groupName: string | undefined, senderName: string, codes: string[]) {
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
          return botApi.saveWarmupMessageSettings({ senderName, codes });
        });
      }
    });
  }

  function confirmStartMonitoring() {
    const messages = buildMessagePreview();

    setConfirmation({
      title: "Iniciar bot real",
      message: "Deseja iniciar o monitoramento do grupo alvo?",
      details: [
        `Grupo alvo: ${groupLabel}`,
        messages.length ? `Mensagens: ${messages.join(" | ")}` : "Nenhuma mensagem do alvo configurada."
      ],
      confirmLabel: "Iniciar bot",
      onConfirm: async () => {
        await runAction(botApi.startMonitoring);
      }
    });
  }

  function confirmStartNuclearMonitoring() {
    const messages = buildMessagePreview();

    setConfirmation({
      title: "Iniciar modo nuclear",
      message: "Deseja iniciar o grupo alvo com o disparo enxuto?",
      details: [
        `Grupo alvo: ${groupLabel}`,
        messages.length ? `Mensagens: ${messages.join(" | ")}` : "Nenhuma mensagem do alvo configurada."
      ],
      confirmLabel: "Iniciar nuclear",
      onConfirm: async () => {
        await runAction(botApi.startNuclearMonitoring);
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

  function saveGeneralSettings(nuclearMode: boolean) {
    void runAction(() => botApi.saveGeneralSettings({ nuclearMode }));
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

  if (!authenticated) {
    return <LoginScreen error={loginError} onSubmit={login} />;
  }

  if (!sessionChecked) {
    return <LoginScreen error="Validando sessão..." onSubmit={login} />;
  }

  if (userRole === "admin") {
    return (
      <AdminDashboard
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

          <ControlButtons
            busy={busy}
            status={snapshot.status}
            onStart={() => runAction(botApi.startBot)}
            onStop={() => runAction(botApi.stopBot)}
            onStartMonitoring={confirmStartMonitoring}
            onStartTestMonitoring={confirmStartTestMonitoring}
            onStopMonitoring={() => runAction(botApi.stopMonitoring)}
            onSimulateOpening={() => runAction(botApi.simulateOpening)}
            onRestart={() => runAction(botApi.restartBot)}
            onClearSession={() => runAction(botApi.clearSession)}
            monitoringEnabled={snapshot.monitoringEnabled}
            monitoringMode={snapshot.monitoringMode}
          />

          <QrCodeBox qrCode={snapshot.qrCode} status={snapshot.status} />

          <section className="nuclear-mini-panel">
            <div>
              <p className="panel-label">Nuclear</p>
              <strong>{nuclearArmed ? "Armado" : snapshot.config.nuclearMode ? "Modo ligado" : "Modo desligado"}</strong>
            </div>
            <button
              className="button"
              disabled={busy || snapshot.status !== "connected" || Boolean(snapshot.monitoringEnabled)}
              type="button"
              onClick={confirmStartNuclearMonitoring}
            >
              <Flame size={18} />
              Iniciar
            </button>
          </section>
        </section>
      ) : null}

      {activeTab === "messages" ? (
        <section className="mobile-home">
          <section className="quick-panel identity-panel">
            <div>
              <p className="panel-label">Nome nas mensagens</p>
              <h2>{snapshot.config.nomeEnvio || "Digite seu nome"}</h2>
            </div>
            <button className="button" type="button" onClick={() => setGroupEditor("target")}>
              Configurar
            </button>
          </section>
          <section className="quick-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-label">Configuração</p>
                <h2>Grupos e mensagens</h2>
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
            <ConfigStrip
              kind="test"
              title="Teste abrir/fechar"
              group={testGroupLabel}
              codes={snapshot.config.codigosMensagensTeste || []}
              onOpen={() => setGroupEditor("test")}
            />
          </section>
          <MessagePreviewStrip
            title="Mensagens alvo"
            group={groupLabel}
            messages={normalizeMessages(snapshot.config.nomeEnvio, snapshot.config.codigosMensagensAlvo || [])}
            onOpen={() => setGroupEditor("target")}
          />
          <MessagePreviewStrip
            title="Mensagens teste"
            group={testGroupLabel}
            messages={normalizeMessages(snapshot.config.nomeEnvio, snapshot.config.codigosMensagensTeste || [])}
            onOpen={() => setGroupEditor("test")}
          />
        </section>
      ) : null}

      {activeTab === "logs" ? (
        <section className="tab-stack">
          <LogsPanel logs={snapshot.logs} />
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="tab-stack">
          <SettingsPanel
            config={snapshot.config}
            busy={busy}
            monitoringEnabled={Boolean(snapshot.monitoringEnabled)}
            userEmail={userEmail}
            onClearLogs={confirmClearLogs}
            onFactoryReset={confirmFactoryReset}
            onToggleNuclearMode={saveGeneralSettings}
            onLogout={() => {
              logout();
            }}
          />
        </section>
      ) : null}

      <nav className="bottom-nav icon-nav" aria-label="Navegação principal">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            aria-label={label}
            className={activeTab === id ? "active" : ""}
            title={label}
            type="button"
            onClick={() => setActiveTab(id)}
          >
            <Icon size={23} />
          </button>
        ))}
      </nav>

      {groupEditor ? (
        <div className="modal-backdrop" role="presentation">
          <section className="sheet-dialog" role="dialog" aria-modal="true" aria-labelledby="group-editor-title">
            <div className="sheet-heading">
              <div>
                <p className="panel-label">Configuração</p>
                <h2 id="group-editor-title">{groupEditor === "target" ? "Grupo alvo" : "Teste abrir/fechar"}</h2>
              </div>
              <button className="icon-button" title="Fechar" type="button" onClick={() => setGroupEditor(undefined)}>
                <X size={20} />
              </button>
            </div>
            <GroupMessageCard
              kind={groupEditor}
              config={snapshot.config}
              groups={snapshot.groups}
              busy={busy}
              onRefresh={() => runAction(botApi.refreshGroups)}
              onSave={groupEditor === "target" ? confirmSaveTarget : confirmSaveTest}
              onWarmup={groupEditor === "test" ? confirmWarmup : undefined}
            />
          </section>
        </div>
      ) : null}

      {confirmation ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
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
    </main>
  );
}
