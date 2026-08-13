import { BotLog } from "../../../shared/types";
import { Trash2 } from "lucide-react";
import { uiText } from "../uiText";

type Props = {
  logs: BotLog[];
  onClear?: () => void;
  clearDisabled?: boolean;
};

export function LogsPanel({ logs, onClear, clearDisabled }: Props) {
  function getTimelineKind(message: string) {
    if (/FECHADO|Bot .*ARMADO|armado/i.test(message)) return "armed";
    if (/ABRIU|Palavra de abertura|Abertura simulada/i.test(message)) return "open";
    if (/Mensagem .*?(confirmada|enviada)|Disparo .*conclu/i.test(message)) return "sent";
    if (/falhou|erro|cancelad/i.test(message)) return "error";
    return "info";
  }

  return (
    <article className="panel logs-panel timeline-panel">
      <div className="panel-heading">
        <div>
          <p className="panel-label">Timeline</p>
          <span className="mini-status">{logs.length} eventos</span>
        </div>
        {onClear ? (
          <button className="icon-button timeline-clear-button" disabled={clearDisabled || !logs.length} title="Limpar timeline" type="button" onClick={onClear}>
            <Trash2 size={17} />
          </button>
        ) : null}
      </div>
      <div className="timeline-list">
        {logs.length ? (
          logs.map((log) => {
            const message = uiText(log.message);
            const kind = getTimelineKind(message);
            return (
              <div className={`timeline-row timeline-${kind} log-${log.level}`} key={log.id}>
                <span className="timeline-dot" />
                <time>{new Date(log.timestamp).toLocaleTimeString("pt-BR")}</time>
                <p>{message}</p>
              </div>
            );
          })
        ) : (
          <div className="log-empty">Nenhum evento registrado ainda.</div>
        )}
      </div>
    </article>
  );
}
