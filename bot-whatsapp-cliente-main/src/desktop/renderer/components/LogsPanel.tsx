import { BotLog } from "../../../shared/types";

type Props = {
  logs: BotLog[];
};

export function LogsPanel({ logs }: Props) {
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
        <p className="panel-label">Timeline</p>
        <span className="mini-status">{logs.length} eventos</span>
      </div>
      <div className="timeline-list">
        {logs.length ? (
          logs.map((log) => {
            const kind = getTimelineKind(log.message);
            return (
              <div className={`timeline-row timeline-${kind} log-${log.level}`} key={log.id}>
                <span className="timeline-dot" />
                <time>{new Date(log.timestamp).toLocaleTimeString("pt-BR")}</time>
                <p>{log.message}</p>
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
