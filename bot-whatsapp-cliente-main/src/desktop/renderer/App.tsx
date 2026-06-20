import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Flame,
  Home,
  LockKeyhole,
  Mail,
  MessageSquareText,
  Power,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  TestTube2,
  X
} from "lucide-react";
import { BotSnapshot } from "../../shared/types";
import { ControlButtons } from "./components/ControlButtons";
import { GroupMessageCard } from "./components/GroupMessageCard";
import { LogsPanel } from "./components/LogsPanel";
import { QrCodeBox } from "./components/QrCodeBox";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusCard } from "./components/StatusCard";
import { botApi, getPanelToken, getPanelUserEmail, isAuthError, panelLogin, setPanelPassword, setPanelToken, setPanelUserEmail } from "./api";
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

export default function App() {
  const [snapshot, setSnapshot] = useState<BotSnapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();
  const [activeTab, setActiveTab] = useState<AppTab>("home");
  const [groupEditor, setGroupEditor] = useState<GroupEditor>();
  const [authenticated, setAuthenticated] = useState(Boolean(window.botApi || getPanelToken()));
  const [userEmail, setUserEmail] = useState(getPanelUserEmail());
  const [loginError, setLoginError] = useState("");
  const [pairingPhoneNumber, setPairingPhoneNumber] = useState("");
  const nuclearArmed = Boolean(snapshot.monitoringEnabled && snapshot.monitoringMode === "target" && snapshot.config.nuclearMode);

  useEffect(() => {
    if (!authenticated) return;

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
          setUserEmail("");
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
  }, [authenticated]);

  const groupLabel = useMemo(() => {
    return snapshot.config.grupoAlvoNome || snapshot.config.grupoAlvoJid || "Nenhum grupo alvo";
  }, [snapshot.config]);

  const testGroupLabel = useMemo(() => {
    return snapshot.config.grupoTesteNome || snapshot.config.grupoTesteJid || "Nenhum grupo teste";
  }, [snapshot.config]);

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
        setUserEmail("");
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
      title: "Iniciar teste real",
      message: "Deseja ouvir abertura e fechamento do grupo teste?",
      details: [
        `Grupo teste: ${testGroupLabel}`,
        messages.length ? `Base das 15 mensagens: ${messages.join(" | ")}` : "Nenhuma mensagem de teste configurada."
      ],
      confirmLabel: "Iniciar teste",
      onConfirm: async () => {
        await runAction(botApi.startTestMonitoring);
      }
    });
  }

  function confirmWarmup() {
    const config = snapshot.config;
    setConfirmation({
      title: "Enviar 15 mensagens de teste",
      message: "Deseja disparar agora a sequência imediata de aquecimento no grupo teste?",
      details: [
        config.grupoTesteNome || config.grupoTesteJid
          ? `Grupo teste: ${config.grupoTesteNome || config.grupoTesteJid}`
          : "Nenhum grupo de teste configurado.",
        `${snapshot.warmupMessagesSent || 0}/${snapshot.warmupRequiredMessages || 15} mensagens no último aquecimento.`
      ],
      confirmLabel: "Enviar 15 mensagens",
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
      setAuthenticated(true);
      setLoginError("");
    } catch (error) {
      setPanelToken("");
      setLoginError(error instanceof Error ? error.message : "Não consegui fazer login.");
    }
  }

  if (!authenticated) {
    return <LoginScreen error={loginError} onSubmit={login} />;
  }

  return (
    <main className="app-shell">
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
          <section className="command-hero">
            <div>
              <p className="eyebrow">Pronto para pegar rota</p>
              <h2>{snapshot.monitoringEnabled ? "Bot armado no grupo" : "Conecte e arme o bot"}</h2>
              <p>
                {snapshot.monitoringEnabled
                  ? "Monitorando abertura em tempo real."
                  : "Use os controles para conectar o WhatsApp e iniciar o monitoramento."}
              </p>
            </div>
            <span className={snapshot.monitoringEnabled ? "hero-pulse active" : "hero-pulse"}>
              <Power size={24} />
            </span>
          </section>

          <StatusCard
            status={snapshot.status}
            error={snapshot.error}
            groupState={snapshot.groupState}
            monitoringEnabled={snapshot.monitoringEnabled}
            readinessChecks={snapshot.readinessChecks}
          />

          <section className="pairing-panel">
            <div>
              <p className="panel-label">Conexão por número</p>
              <h2>Código no celular</h2>
              <p>Digite DDI + DDD + número. Exemplo: 5511999999999.</p>
            </div>
            <input
              inputMode="tel"
              placeholder="5511999999999"
              value={pairingPhoneNumber}
              onChange={(event) => setPairingPhoneNumber(event.target.value.replace(/\D/g, ""))}
            />
          </section>

          <ControlButtons
            busy={busy}
            status={snapshot.status}
            onStart={() => runAction(() => botApi.startBot({ pairingPhoneNumber }))}
            onStop={() => runAction(botApi.stopBot)}
            onStartMonitoring={confirmStartMonitoring}
            onStartTestMonitoring={confirmStartTestMonitoring}
            onStopMonitoring={() => runAction(botApi.stopMonitoring)}
            onRestart={() => runAction(botApi.restartBot)}
            onClearSession={() => runAction(botApi.clearSession)}
            monitoringEnabled={snapshot.monitoringEnabled}
            monitoringMode={snapshot.monitoringMode}
          />

          <QrCodeBox qrCode={snapshot.qrCode} pairingCode={snapshot.pairingCode} status={snapshot.status} />

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
              title="Config grupo teste"
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
            onToggleNuclearMode={saveGeneralSettings}
            onLogout={() => {
              setPanelToken("");
              setPanelUserEmail("");
              setUserEmail("");
              setAuthenticated(false);
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
                <h2 id="group-editor-title">{groupEditor === "target" ? "Grupo alvo" : "Grupo teste"}</h2>
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

