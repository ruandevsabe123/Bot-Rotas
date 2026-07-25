import { useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import QRCode from "qrcode";
import { BotStatus } from "../../../shared/types";

type Props = {
  qrCode: string;
  status: BotStatus;
  qrGeneratedAt?: string;
  qrExpiresAt?: string;
  qrAttempt?: number;
  busy?: boolean;
  onRefreshQrCode: () => Promise<unknown>;
};

export function QrCodeBox({
  qrCode,
  status,
  qrGeneratedAt,
  qrExpiresAt,
  qrAttempt,
  busy,
  onRefreshQrCode
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!qrCode || !canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, qrCode, {
      width: 320,
      margin: 4,
      errorCorrectionLevel: "M",
      color: {
        dark: "#000000",
        light: "#ffffff"
      }
    });
  }, [qrCode]);

  useEffect(() => {
    setNow(Date.now());
    if (!qrCode) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [qrCode, qrGeneratedAt]);

  const expiresAtMs = useMemo(() => {
    const value = qrExpiresAt ? new Date(qrExpiresAt).getTime() : 0;
    return Number.isFinite(value) ? value : 0;
  }, [qrExpiresAt]);
  const remainingSeconds = expiresAtMs ? Math.max(0, Math.ceil((expiresAtMs - now) / 1000)) : undefined;
  const expired = remainingSeconds === 0;
  const statusLabel = status === "waiting_qr"
    ? expired
      ? "Atualizando QR"
      : remainingSeconds !== undefined
      ? `Válido por ${remainingSeconds}s`
      : "Aguardando leitura"
    : "Preparando conexão";

  return (
    <article className="panel qr-panel">
      <div className="panel-heading">
        <div>
          <p className="panel-label">QR Code</p>
          <span className="mini-status">{statusLabel}{qrAttempt ? ` · tentativa ${qrAttempt}` : ""}</span>
        </div>
        <button
          className="icon-button"
          disabled={busy}
          title="Gerar um QR Code novo"
          type="button"
          onClick={() => void onRefreshQrCode()}
        >
          <RefreshCw size={20} />
        </button>
      </div>
      <div className="qr-box">
        {qrCode && !expired ? (
          <canvas ref={canvasRef} aria-label="QR Code do WhatsApp" />
        ) : (
          <div className="qr-empty">{expired ? "Gerando um QR Code novo..." : "Aguardando o WhatsApp gerar o QR Code..."}</div>
        )}
      </div>
    </article>
  );
}
