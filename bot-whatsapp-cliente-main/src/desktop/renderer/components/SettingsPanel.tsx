import { Bell, HelpCircle, LogOut, MessageCircle, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { BotConfig } from "../../../shared/types";
import { sendSupportMessage } from "../api";

type Props = {
  config: BotConfig;
  busy: boolean;
  monitoringEnabled: boolean;
  userEmail?: string;
  onClearLogs: () => void;
  onFactoryReset: () => void;
  onSaveGeneralSettings?: (settings: { nuclearMode?: boolean; alwaysWarmMode?: boolean; keepAliveIntervalMs?: number }) => void;
  onEnableNotifications?: () => void | Promise<void>;
  notificationStatus?: string;
  onLogout?: () => void;
};

export function SettingsPanel({ config, busy, monitoringEnabled, userEmail, onClearLogs, onFactoryReset, onSaveGeneralSettings, onEnableNotifications, notificationStatus, onLogout }: Props) {
  const [supportMessage, setSupportMessage] = useState("");
  const [supportStatus, setSupportStatus] = useState("");

  async function sendMessage() {
    setSupportStatus("");
    try {
      await sendSupportMessage({
        email: userEmail || "cliente-sem-email",
        message: supportMessage
      });
      setSupportMessage("");
      setSupportStatus("Mensagem enviada para o admin.");
    } catch (error) {
      setSupportStatus(error instanceof Error ? error.message : "Não consegui enviar a mensagem.");
    }
  }

  return (
    <section className="settings-grid">
      <article className="panel option-panel account-panel">
        <div>
          <p className="panel-label">Conta</p>
          <h2>{userEmail || "Cliente conectado"}</h2>
          <p>Nome configurado: {config.nomeEnvio || "não configurado"}</p>
        </div>
        {onLogout ? (
          <button className="button" disabled={busy} type="button" onClick={onLogout}>
            <LogOut size={18} />
            Sair
          </button>
        ) : null}
      </article>

      <article className="panel support-card">
        <div>
          <span className="support-icon">
            <MessageCircle size={22} />
          </span>
          <p className="panel-label">Suporte</p>
          <h2>Precisa de ajuda?</h2>
          <p>Envie uma mensagem direto para o painel do admin. Não precisa sair daqui.</p>
        </div>
        <div className="support-form">
          <textarea
            value={supportMessage}
            onChange={(event) => setSupportMessage(event.target.value)}
            placeholder="Descreva o erro ou pedido para o admin"
          />
          <button className="button primary" disabled={busy || !supportMessage.trim()} type="button" onClick={sendMessage}>
            <MessageCircle size={18} />
            Enviar
          </button>
          {supportStatus ? <span>{supportStatus}</span> : null}
        </div>
      </article>

      <article className="panel option-panel">
        <div>
          <p className="panel-label">Status</p>
          <h2>{monitoringEnabled ? "Bot em execução" : "Bot parado"}</h2>
          <p>Grupo alvo: {config.grupoAlvoNome || config.grupoAlvoJid || "não configurado"}</p>
        </div>
        <span className={monitoringEnabled ? "mini-badge ok" : "mini-badge"}>{monitoringEnabled ? "Ativo" : "Aguardando"}</span>
      </article>

      <article className="panel option-panel">
        <div>
          <p className="panel-label">Alertas importantes</p>
          <h2>Notificações em segundo plano</h2>
          <p>Receba avisos quando a IA exigir uma decisão, o WhatsApp desconectar ou o bot precisar de atenção.</p>
          {notificationStatus ? <span className="settings-inline-status">{notificationStatus}</span> : null}
        </div>
        <button className="button primary" disabled={busy || !onEnableNotifications} type="button" onClick={onEnableNotifications}>
          <Bell size={18} />
          Ativar alertas
        </button>
      </article>

      <article className="panel option-panel warm-mode-panel">
        <div>
          <p className="panel-label">Performance</p>
          <h2>Modo sempre quente</h2>
          <p>Mantém o grupo e o plano de disparo renovados em silêncio para reduzir a primeira mensagem depois de muito tempo parado.</p>
        </div>
        <label className="toggle-row">
          <input
            checked={config.alwaysWarmMode}
            disabled={busy || !onSaveGeneralSettings}
            type="checkbox"
            onChange={(event) => onSaveGeneralSettings?.({ alwaysWarmMode: event.target.checked })}
          />
          {config.alwaysWarmMode ? "Ligado" : "Desligado"}
        </label>
        <label className="keepalive-select">
          Intervalo
          <select
            disabled={busy || !onSaveGeneralSettings}
            value={config.keepAliveIntervalMs}
            onChange={(event) => onSaveGeneralSettings?.({ keepAliveIntervalMs: Number(event.target.value) })}
          >
            <option value={60000}>1 min</option>
            <option value={180000}>3 min</option>
            <option value={300000}>5 min</option>
            <option value={480000}>8 min</option>
            <option value={600000}>10 min</option>
          </select>
        </label>
      </article>

      <article className="panel option-panel">
        <div>
          <p className="panel-label">Histórico local</p>
          <h2>Limpar avisos</h2>
          <p>Remove apenas os logs exibidos no painel. Não apaga grupos nem mensagens.</p>
        </div>
        <button className="button danger" disabled={busy} type="button" onClick={onClearLogs}>
          <Trash2 size={18} />
          Limpar
        </button>
      </article>

      <article className="panel option-panel">
        <div>
          <p className="panel-label">Reset</p>
          <h2>Padrão de fábrica</h2>
          <p>Apaga sessão, grupos, nome e mensagens salvas deste usuário.</p>
        </div>
        <button className="button danger" disabled={busy} type="button" onClick={onFactoryReset}>
          <RotateCcw size={18} />
          Resetar
        </button>
      </article>

      <article className="panel support-note">
        <span className="support-icon muted">
          <HelpCircle size={22} />
        </span>
        <div>
          <p className="panel-label">Dica rápida</p>
          <h2>Antes de iniciar</h2>
          <p>Confira a rota, o nome e as mensagens na tela inicial. Se algo estiver errado, toque em editar e salve antes de iniciar o bot.</p>
        </div>
      </article>
    </section>
  );
}
