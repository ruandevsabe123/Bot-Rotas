import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { BotStatus } from "../../../shared/types";

type Props = {
  qrCode: string;
  pairingCode?: string;
  status: BotStatus;
};

export function QrCodeBox({ qrCode, pairingCode, status }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const formattedPairingCode = pairingCode ? pairingCode.replace(/(.{4})(.{1,4})/, "$1-$2") : "";

  useEffect(() => {
    if (!qrCode || !canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qrCode, {
      width: 260,
      margin: 2,
      color: {
        dark: "#0d1117",
        light: "#ffffff"
      }
    });
  }, [qrCode]);

  return (
    <article className="panel qr-panel">
      <div className="panel-heading">
        <p className="panel-label">QR Code</p>
        <span className="mini-status">{status === "waiting_qr" ? "Aguardando leitura" : "Sem QR ativo"}</span>
      </div>
      <div className="qr-box">
        {pairingCode ? (
          <div className="pairing-code-box">
            <span>Código de pareamento</span>
            <strong>{formattedPairingCode}</strong>
            <small>WhatsApp &gt; Aparelhos conectados &gt; Conectar com número de telefone</small>
          </div>
        ) : qrCode ? (
          <canvas ref={canvasRef} aria-label="QR Code do WhatsApp" />
        ) : (
          <div className="qr-empty">O QR Code aparece aqui quando uma nova autenticação for necessária.</div>
        )}
      </div>
    </article>
  );
}
