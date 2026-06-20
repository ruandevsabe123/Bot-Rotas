import { BotConfig } from "../../../shared/types";

type Props = {
  config: BotConfig;
  busy: boolean;
  monitoringEnabled: boolean;
  userEmail?: string;
  onClearLogs: () => void;
  onFactoryReset: () => void;
  onToggleNuclearMode: (enabled: boolean) => void;
  onLogout?: () => void;
};

export function SettingsPanel({ config, busy, monitoringEnabled, userEmail, onClearLogs, onFactoryReset, onToggleNuclearMode, onLogout }: Props) {
  return (
    <section className="settings-grid">
      <article className="panel option-panel account-panel">
        <div>
          <p className="panel-label">Conta</p>
          <h2>{userEmail || "Cliente conectado"}</h2>
          <p>Nome nas mensagens: {config.nomeEnvio || "não configurado"}</p>
        </div>
        {onLogout ? (
          <button className="button" disabled={busy} type="button" onClick={onLogout}>
            Sair
          </button>
        ) : null}
      </article>

      <article className="panel option-panel">
        <div>
          <p className="panel-label">Logs</p>
          <h2>Limpar log</h2>
        </div>
        <button className="button danger" disabled={busy} type="button" onClick={onClearLogs}>
          Limpar logs
        </button>
      </article>

      <article className="panel option-panel">
        <div>
          <p className="panel-label">Reset</p>
          <h2>Padrão de fábrica</h2>
          <p>Apaga sessão, grupos, nome e mensagens salvas.</p>
        </div>
        <button className="button danger" disabled={busy} type="button" onClick={onFactoryReset}>
          Resetar tudo
        </button>
      </article>

      <article className="panel option-panel option-panel-nuclear">
        <div>
          <p className="panel-label">Contingência</p>
          <h2>Modo nuclear</h2>
          <p>{monitoringEnabled ? "Pare o bot para trocar de modo." : "Usa um disparo mais enxuto quando o modo principal não estiver confiável."}</p>
        </div>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={config.nuclearMode}
            disabled={busy || monitoringEnabled}
            onChange={(event) => onToggleNuclearMode(event.target.checked)}
          />
          <span>{config.nuclearMode ? "Ativado" : "Desativado"}</span>
        </label>
      </article>
    </section>
  );
}
