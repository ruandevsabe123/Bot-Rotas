import { LogOut, Play, QrCode, Send, Square } from "lucide-react";
import { BotGroupState, BotStatus } from "../../../shared/types";

type Props = {
  busy: boolean;
  status: BotStatus;
  onStart: () => void;
  onStop: () => void;
  onStartMonitoring: () => void;
  onStopMonitoring: () => void;
  onManualDispatch: () => void;
  startMonitoringLabel?: string;
  hideManualDispatch?: boolean;
  monitoringEnabled?: boolean;
  monitoringMode?: "target" | "test";
  groupState?: BotGroupState;
};

export function ControlButtons({
  busy,
  status,
  onStart,
  onStop,
  onStartMonitoring,
  onStopMonitoring,
  onManualDispatch,
  startMonitoringLabel = "Iniciar bot",
  hideManualDispatch = false,
  monitoringEnabled,
  monitoringMode,
  groupState
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
  const canManualDispatch = !busy && isConnected;

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
          {startMonitoringLabel}
        </button>
        <button className="button" disabled={!canStopMonitoring} onClick={onStopMonitoring}>
          <Square size={18} />
          Parar bot{monitoringMode === "test" ? " teste" : ""}
        </button>
        {!hideManualDispatch ? (
          <button className="button accent" disabled={!canManualDispatch} onClick={onManualDispatch}>
            <Send size={18} />
            Disparo manual{groupState === "closed" ? " (fechado)" : ""}
          </button>
        ) : null}
      </div>
    </article>
  );
}
