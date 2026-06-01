import { useEffect, useMemo, useState } from "react";
import { BotSnapshot } from "../../shared/types";
import { ControlButtons } from "./components/ControlButtons";
import { GroupMessageCard } from "./components/GroupMessageCard";
import { LogsPanel } from "./components/LogsPanel";
import { QrCodeBox } from "./components/QrCodeBox";
import { SettingsPanel } from "./components/SettingsPanel";
import { StatusCard } from "./components/StatusCard";
import "./styles.css";

type PendingConfirmation = {
  title: string;
  message: string;
  details: string[];
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
};

type AppTab = "connection" | "nuclear" | "settings";

const emptySnapshot: BotSnapshot = {
  status: "disconnected",
  groupState: "unknown",
  qrCode: "",
  config: {
    grupoAlvoJid: "",
    grupoAlvoNome: "",
    grupoTesteJid: "",
    grupoTesteNome: "",
    nomeEnvio: "Alan da Silva Alves",
    nuclearMode: false,
    codigosMensagensAlvo: [],
    codigosMensagensTeste: []
  },
  groups: [],
  readinessChecks: [],
  logs: []
};

const tabs: Array<{ id: AppTab; label: string }> = [
  { id: "connection", label: "Conexão" },
  { id: "nuclear", label: "Nuclear" },
  { id: "settings", label: "Configurações" }
];

function normalizeMessages(senderName: string, codes: string[]) {
  return codes.map((code) => `${senderName.trim()} ${code.trim().toUpperCase()}`.trim()).filter(Boolean);
}

export default function App() {
  const [snapshot, setSnapshot] = useState<BotSnapshot>(emptySnapshot);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<PendingConfirmation>();
  const [activeTab, setActiveTab] = useState<AppTab>("connection");
  const nuclearArmed = Boolean(snapshot.monitoringEnabled && snapshot.monitoringMode === "target" && snapshot.config.nuclearMode);

  useEffect(() => {
    window.botApi.getSnapshot().then(setSnapshot);
    return window.botApi.onSnapshot(setSnapshot);
  }, []);

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
          await window.botApi.saveGroup({ group, groupId, groupName });
          return window.botApi.saveTargetMessageSettings({ senderName, codes });
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
          await window.botApi.saveTestGroup({ group, groupId, groupName });
          return window.botApi.saveWarmupMessageSettings({ senderName, codes });
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
        await runAction(window.botApi.startMonitoring);
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
        await runAction(window.botApi.startNuclearMonitoring);
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
        await runAction(window.botApi.startTestMonitoring);
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
        await runAction(window.botApi.warmupGroups);
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
        await runAction(window.botApi.clearLogs);
      }
    });
  }

  function saveGeneralSettings(nuclearMode: boolean) {
    void runAction(() => window.botApi.saveGeneralSettings({ nuclearMode }));
  }

  async function confirmPendingAction() {
    if (!confirmation) return;
    const action = confirmation.onConfirm;
    setConfirmation(undefined);
    await action();
  }

  return (
    <main className="app-shell">
      <section className="topbar">
        <div>
          <p className="eyebrow">Painel desktop</p>
          <h1>Bot WhatsApp</h1>
        </div>
        <div className="group-pill">
          <span>{snapshot.monitoringMode === "test" ? "Teste ativo" : "Grupo alvo"}</span>
          <strong>{snapshot.monitoringMode === "test" ? testGroupLabel : groupLabel}</strong>
        </div>
      </section>

      {activeTab === "connection" ? (
        <section className="dashboard-grid connection-view">
          <div className="primary-column">
            <StatusCard
              status={snapshot.status}
              error={snapshot.error}
              groupState={snapshot.groupState}
              monitoringEnabled={snapshot.monitoringEnabled}
              readinessChecks={snapshot.readinessChecks}
            />
            <ControlButtons
              busy={busy}
              status={snapshot.status}
              onStart={() => runAction(window.botApi.startBot)}
              onStop={() => runAction(window.botApi.stopBot)}
              onStartMonitoring={confirmStartMonitoring}
              onStartTestMonitoring={confirmStartTestMonitoring}
              onStopMonitoring={() => runAction(window.botApi.stopMonitoring)}
              onRestart={() => runAction(window.botApi.restartBot)}
              onClearSession={() => runAction(window.botApi.clearSession)}
              monitoringEnabled={snapshot.monitoringEnabled}
              monitoringMode={snapshot.monitoringMode}
            />
            <section className="connection-config-grid">
              <GroupMessageCard
                kind="target"
                config={snapshot.config}
                groups={snapshot.groups}
                busy={busy}
                onRefresh={() => runAction(window.botApi.refreshGroups)}
                onSave={confirmSaveTarget}
              />
              <GroupMessageCard
                kind="test"
                config={snapshot.config}
                groups={snapshot.groups}
                busy={busy}
                onRefresh={() => runAction(window.botApi.refreshGroups)}
                onSave={confirmSaveTest}
                onWarmup={confirmWarmup}
              />
            </section>
          </div>
          <div className="secondary-column">
            <QrCodeBox qrCode={snapshot.qrCode} status={snapshot.status} />
            <LogsPanel logs={snapshot.logs} />
          </div>
        </section>
      ) : null}

      {activeTab === "settings" ? (
        <section className="tab-stack">
          <SettingsPanel
            config={snapshot.config}
            busy={busy}
            monitoringEnabled={Boolean(snapshot.monitoringEnabled)}
            onClearLogs={confirmClearLogs}
            onToggleNuclearMode={saveGeneralSettings}
          />
        </section>
      ) : null}

      {activeTab === "nuclear" ? (
        <section className="nuclear-view">
          <article className="panel nuclear-controls-panel">
            <div className="nuclear-heading-row">
              <div>
                <p className="panel-label">Modo nuclear</p>
                <h2>Grupo alvo enxuto</h2>
              </div>
              <div className={`nuclear-state ${snapshot.config.nuclearMode ? "active" : ""}`}>
                <span>{snapshot.config.nuclearMode ? "Ligado" : "Desligado"}</span>
                <strong>{nuclearArmed ? "Armado" : "Em espera"}</strong>
              </div>
            </div>
            <div className="nuclear-actions">
              <button
                className="button primary"
                disabled={busy || !["disconnected", "error"].includes(snapshot.status)}
                type="button"
                onClick={() => runAction(window.botApi.startBot)}
              >
                Conectar
              </button>
              <button
                className="button"
                disabled={busy || snapshot.status !== "connected" || Boolean(snapshot.monitoringEnabled)}
                type="button"
                onClick={confirmStartNuclearMonitoring}
              >
                Iniciar nuclear
              </button>
              <button
                className="button danger"
                disabled={busy || !snapshot.monitoringEnabled}
                type="button"
                onClick={() => runAction(window.botApi.stopMonitoring)}
              >
                Parar bot
              </button>
            </div>
          </article>

          <GroupMessageCard
            kind="target"
            config={snapshot.config}
            groups={snapshot.groups}
            busy={busy}
            onRefresh={() => runAction(window.botApi.refreshGroups)}
            onSave={confirmSaveTarget}
          />
          <LogsPanel logs={snapshot.logs} />
        </section>
      ) : null}

      <nav className="bottom-nav" aria-label="Navegação principal">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            className={activeTab === tab.id ? "active" : ""}
            type="button"
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {confirmation ? (
        <div className="modal-backdrop" role="presentation">
          <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
            <p className="panel-label">Confirmação</p>
            <h2 id="confirm-title">{confirmation.title}</h2>
            <p className="confirmation-message">{confirmation.message}</p>
            <div className="confirmation-details">
              {confirmation.details.map((detail, index) => (
                <span key={`${detail}-${index}`}>{detail}</span>
              ))}
            </div>
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
