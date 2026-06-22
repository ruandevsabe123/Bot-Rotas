import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Ban,
  Bot,
  CheckCircle2,
  Clock3,
  Edit3,
  Gauge,
  Home,
  Info,
  LockKeyhole,
  Mail,
  MessageSquareText,
  RefreshCw,
  Route,
  Save,
  Send,
  Settings,
  ShieldCheck,
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
  AdminSupportMessagesSnapshot,
  AdminUserDetail,
  AdminUserSummary,
  AdminUsersSnapshot,
  BotSnapshot,
  PanelUserRole,
  RouteDispatch,
  SupportMessage
} from "../../shared/types";
import { ControlButtons } from "./components/ControlButtons";
import { GroupMessageCard } from "./components/GroupMessageCard";
import { LogsPanel } from "./components/LogsPanel";
import { QrCodeBox } from "./components/QrCodeBox";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  botApi,
  getAdminRoutes,
  getAdminSupportMessages,
  getAdminUserDetail,
  getAdminUsers,
  getPanelMe,
  getPanelToken,
  getPanelUserEmail,
  getPanelUserRole,
  isAuthError,
  markSupportMessageRead,
  panelLogin,
  saveAdminUser,
  sendSupportMessage,
  setPanelPassword,
  setPanelToken,
  setPanelUserEmail,
  setPanelUserRole,
  validateAdminRoute
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

function LaunchReviewPanel({
  snapshot,
  groupLabel,
  messages,
  onEditTarget,
  onEditTest
}: {
  snapshot: BotSnapshot;
  groupLabel: string;
  messages: string[];
  onEditTarget: () => void;
  onEditTest: () => void;
}) {
  const hasGroup = Boolean(snapshot.config.grupoAlvoJid || snapshot.config.grupoAlvoNome);
  const hasName = Boolean(snapshot.config.nomeEnvio);
  const hasMessages = messages.length > 0;

  return (
    <section className="quick-panel launch-review-panel">
      <div className="panel-heading">
        <div>
          <p className="panel-label">Revisão antes de iniciar</p>
          <h2>Rota e mensagens</h2>
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
          <span>Mensagens</span>
          <strong>{messages.length ? `${messages.length} pronta(s)` : "Nenhuma"}</strong>
        </article>
      </div>
      <div className="review-messages">
        {messages.length ? messages.map((message, index) => <span key={`${message}-${index}`}>{message}</span>) : <span>Configure as mensagens que serão enviadas antes de iniciar.</span>}
      </div>
      <div className="review-actions">
        <button className="button" type="button" onClick={onEditTarget}>
          Configurar envio real
        </button>
        <button className="button accent" type="button" onClick={onEditTest}>
          Configurar teste
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

function RouteRow({ route, onValidate }: { route: RouteDispatch; onValidate?: () => void }) {
  const createdAt = new Date(route.createdAt).toLocaleString("pt-BR");

  return (
    <article className={route.validated ? "route-row validated" : "route-row"} style={colorStyle(route.clientColor)}>
      <div className="route-row-main">
        <span className={route.validated ? "route-state-icon ok" : "route-state-icon"}>
          {route.validated ? <CheckCircle2 size={19} /> : <Clock3 size={19} />}
        </span>
        <div>
          <p className="panel-label client-label">
            <span className="client-color-dot" />
            {route.clientEmail || "Cliente"}
          </p>
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
      {!route.validated && onValidate ? (
        <button className="button accent route-validate-button" type="button" onClick={onValidate}>
          <CheckCircle2 size={18} />
          Validar rota
        </button>
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

function AdminDashboard({ userEmail, onLogout }: { userEmail: string; onLogout: () => void }) {
  const [dashboard, setDashboard] = useState<AdminRoutesSnapshot>({
    routes: [],
    pendingReactionRoutes: [],
    totals: { routes: 0, validated: 0, reactions: 0, clients: 0 }
  });
  const [usersDashboard, setUsersDashboard] = useState<AdminUsersSnapshot>({ users: [] });
  const [supportDashboard, setSupportDashboard] = useState<AdminSupportMessagesSnapshot>({ messages: [], unread: 0 });
  const [editor, setEditor] = useState<UserEditorState>();
  const [detail, setDetail] = useState<AdminUserDetail>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastNotifiedSupportId, setLastNotifiedSupportId] = useState("");
  const [leaderAlert, setLeaderAlert] = useState("");
  const [lastLeaderReactionId, setLastLeaderReactionId] = useState("");

  function refresh() {
    Promise.all([getAdminRoutes(), getAdminUsers(), getAdminSupportMessages()])
      .then(([nextRoutes, nextUsers, nextSupport]) => {
        setDashboard(nextRoutes);
        setUsersDashboard(nextUsers);
        setSupportDashboard(nextSupport);
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
    const interval = window.setInterval(refresh, 1000);
    return () => window.clearInterval(interval);
  }, []);

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
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui marcar a mensagem.");
    }
  }

  async function validateRoute(routeId: string) {
    try {
      setDashboard(await validateAdminRoute(routeId));
      setError("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Não consegui validar a rota.");
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
        <AdminMetric Icon={Route} tone="blue" title="Rotas" value={dashboard.totals.routes} detail="disparos registrados" />
        <AdminMetric Icon={CheckCircle2} tone="green" title="Validadas" value={dashboard.totals.validated} detail="por reação admin" />
        <AdminMetric Icon={Zap} tone="yellow" title="Reações" value={dashboard.totals.reactions} detail="recebidas no WhatsApp" />
        <AdminMetric Icon={ShieldCheck} tone="blue" title="Usuários" value={usersDashboard.users.length} detail={`${dashboard.totals.clients} com rotas`} />
        <AdminMetric Icon={MessageSquareText} tone={supportDashboard.unread ? "red" : "green"} title="Mensagens" value={supportDashboard.unread} detail="não lidas" />
      </section>

      <section className="admin-workspace">
        <section className={supportDashboard.unread ? "quick-panel admin-list-panel support-inbox has-unread" : "quick-panel admin-list-panel support-inbox"}>
          <div className="panel-heading">
            <div>
              <p className="panel-label">Chat interno</p>
              <h2>Mensagens dos clientes</h2>
            </div>
            <button className="button" type="button" onClick={enableNotifications}>
              Ativar notificação
            </button>
          </div>
          <div className="support-message-list">
            {supportDashboard.messages.length ? supportDashboard.messages.slice(0, 8).map((message) => (
              <SupportMessageRow key={message.id} message={message} onMarkRead={() => readSupportMessage(message.id)} />
            )) : <p className="qr-empty">Nenhuma mensagem de cliente ainda.</p>}
          </div>
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
                onEdit={() => setEditor({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: user.blocked, color: user.color })}
                onToggleBlock={() => saveUser({ originalEmail: user.email, email: user.email, password: "", role: user.role, blocked: !user.blocked, color: user.color })}
              />
            ))}
          </div>
        </section>

        <section className="quick-panel admin-list-panel admin-routes-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-label">Validação</p>
              <h2>Reações para validar</h2>
            </div>
            <span className="mini-badge ok">{dashboard.pendingReactionRoutes.length}</span>
          </div>
          <div className="route-list">
            {dashboard.pendingReactionRoutes.length ? (
              dashboard.pendingReactionRoutes.map((route) => <RouteRow key={`pending-${route.id}`} route={route} onValidate={() => validateRoute(route.id)} />)
            ) : (
              <p className="qr-empty">Nenhuma reação pendente de validação.</p>
            )}
          </div>
        </section>

        <section className="quick-panel admin-list-panel admin-routes-panel">
          <div className="panel-heading">
            <div>
              <p className="panel-label">Histórico</p>
              <h2>Últimos 100 disparos</h2>
            </div>
            <button className="button" type="button" onClick={onLogout}>
              <Route size={18} />
              Sair
            </button>
          </div>
          {error ? <p className="login-error">{error}</p> : null}
          <div className="route-list">
            {dashboard.routes.length ? (
              dashboard.routes.map((route) => <RouteRow key={route.id} route={route} onValidate={() => validateRoute(route.id)} />)
            ) : (
              <p className="qr-empty">Nenhuma rota enviada ainda.</p>
            )}
          </div>
        </section>
      </section>

      {detail ? <UserDetailModal detail={detail} onClose={() => setDetail(undefined)} /> : null}
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
    const hasGroup = Boolean(snapshot.config.grupoAlvoJid || snapshot.config.grupoAlvoNome);
    const hasName = Boolean(snapshot.config.nomeEnvio);

    if (!hasGroup || !hasName || !messages.length) {
      setGroupEditor("target");
      setConfirmation({
        title: "Revise o envio",
        message: "Falta configurar a rota, o nome ou as mensagens antes de iniciar.",
        details: [
          hasGroup ? `Rota: ${groupLabel}` : "Rota ainda não configurada.",
          hasName ? `Nome: ${snapshot.config.nomeEnvio}` : "Nome ainda não configurado.",
          messages.length ? `Mensagens: ${messages.join(" | ")}` : "Nenhuma mensagem configurada."
        ],
        confirmLabel: "Entendi",
        onConfirm: () => undefined
      });
      return;
    }

    setConfirmation({
      title: "Iniciar bot",
      message: "Confira a rota e as mensagens que serão enviadas.",
      details: [
        `Grupo alvo: ${groupLabel}`,
        `Nome: ${snapshot.config.nomeEnvio}`,
        `Mensagens: ${messages.join(" | ")}`
      ],
      confirmLabel: "Iniciar bot",
      onConfirm: async () => {
        await runAction(botApi.startMonitoring);
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
        messages.length ? `Mensagens: ${messages.join(" | ")}` : "Nenhuma mensagem configurada."
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

  if (!sessionChecked) {
    return <LoadingScreen />;
  }

  if (!authenticated) {
    return <LoginScreen error={loginError} onSubmit={login} />;
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

          <LaunchReviewPanel
            snapshot={snapshot}
            groupLabel={groupLabel}
            messages={normalizeMessages(snapshot.config.nomeEnvio, snapshot.config.codigosMensagensAlvo || [])}
            onEditTarget={() => setGroupEditor("target")}
            onEditTest={() => setGroupEditor("test")}
          />

          <ControlButtons
            busy={busy}
            status={snapshot.status}
            onStart={() => runAction(botApi.startBot)}
            onStop={() => runAction(botApi.stopBot)}
            onStartMonitoring={confirmStartMonitoring}
            onStopMonitoring={() => runAction(botApi.stopMonitoring)}
            onManualDispatch={confirmManualDispatch}
            onWarmup={confirmWarmup}
            onSimulateTargetDispatch={confirmSimulateTargetDispatch}
            monitoringEnabled={snapshot.monitoringEnabled}
            monitoringMode={snapshot.monitoringMode}
            groupState={snapshot.groupState}
          />

          {snapshot.qrCode || snapshot.status === "waiting_qr" ? <QrCodeBox qrCode={snapshot.qrCode} status={snapshot.status} /> : null}
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
