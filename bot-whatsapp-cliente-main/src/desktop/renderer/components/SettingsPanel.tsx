import { HelpCircle, LogOut, MessageCircle, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { BotConfig } from "../../../shared/types";
import { getSupportInfo } from "../api";

type Props = {
  config: BotConfig;
  busy: boolean;
  monitoringEnabled: boolean;
  userEmail?: string;
  onClearLogs: () => void;
  onLogout?: () => void;
};

export function SettingsPanel({ config, busy, monitoringEnabled, userEmail, onClearLogs, onLogout }: Props) {
  const [supportChatUrl, setSupportChatUrl] = useState("");

  useEffect(() => {
    getSupportInfo()
      .then((info) => setSupportChatUrl(info.chatUrl || ""))
      .catch(() => setSupportChatUrl(""));
  }, []);

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
          <p>Se o bot não conectar, não enviar rota ou aparecer algum erro, chama o suporte com uma foto da tela.</p>
        </div>
        {supportChatUrl ? (
          <a className="button primary" href={supportChatUrl} target="_blank" rel="noreferrer">
            <MessageCircle size={18} />
            Abrir chat
          </a>
        ) : (
          <span className="mini-badge">Chat indisponível</span>
        )}
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
          <p className="panel-label">Histórico local</p>
          <h2>Limpar avisos</h2>
          <p>Remove apenas os logs exibidos no painel. Não apaga grupos nem mensagens.</p>
        </div>
        <button className="button danger" disabled={busy} type="button" onClick={onClearLogs}>
          <Trash2 size={18} />
          Limpar
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
