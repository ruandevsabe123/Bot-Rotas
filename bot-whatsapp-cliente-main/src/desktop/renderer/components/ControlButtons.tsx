import { LogOut, Play, QrCode, Square } from "lucide-react";
import { BotStatus } from "../../../shared/types";

type Props = {
  busy: boolean;
  status: BotStatus;
  onStart: () => void;
  onStop: () => void;
  onStartMonitoring: () => void;
  onStopMonitoring: () => void;
  monitoringEnabled?: boolean;
  monitoringMode?: "target" | "test";
};

export function ControlButtons({
  busy,
  status,
  onStart,
  onStop,
  onStartMonitoring,
  onStopMonitoring,
  monitoringEnabled,
  monitoringMode
}: Props) {
  const isConnectingFlow = status === "connecting" || status === "waiting_qr" || status === "reconnecting";
  const isConnected = status === "connected";
  const isDisconnected = status === "disconnected";
  const isError = status === "error";
  const isRunning = isConnectingFlow || isConnected;

  const canConnect = !busy && (isDisconnected || isError);
  const canStop = !busy && isRunning;
  const canStartMonitoring = !busy && isConnected && !Boolean(monitoringEnabled);
  const canStopMonitoring = !busy && isConnected && Boolean(monitoringEnabled);

  return (
    <article className="panel">
      <p className="panel-label">Operação</p>
      <div className="button-grid">
        <button className="button primary" disabled={!canConnect} onClick={onStart}>
          <QrCode size={18} />
          Conectar WhatsApp
        </button>
        <button className="button" disabled={!canStop} onClick={onStop}>
          <LogOut size={18} />
          Desconectar
        </button>
        <button className="button primary" disabled={!canStartMonitoring} onClick={onStartMonitoring}>
          <Play size={18} />
          Iniciar bot
        </button>
        <button className="button" disabled={!canStopMonitoring} onClick={onStopMonitoring}>
          <Square size={18} />
          Parar bot{monitoringMode === "test" ? " teste" : ""}
        </button>
      </div>
    </article>
  );
}

