import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { BotStatus } from "../../../shared/types";

type Props = {
  qrCode: string;
  status: BotStatus;
  pairingCode?: string;
  busy?: boolean;
  onRequestPairingCode: (phoneNumber: string) => Promise<unknown>;
};

export function QrCodeBox({ qrCode, status, pairingCode, busy, onRequestPairingCode }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phoneNumber, setPhoneNumber] = useState("");

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
        {qrCode ? (
          <canvas ref={canvasRef} aria-label="QR Code do WhatsApp" />
        ) : (
          <div className="qr-empty">O QR Code aparece aqui quando uma nova autenticação for necessária.</div>
        )}
      </div>
      <div className="pairing-code-panel">
        <strong>iPhone não lê o QR?</strong>
        <p>Informe o número com DDI e DDD, sem o sinal de +. Depois, no WhatsApp, abra Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone.</p>
        <div className="pairing-code-action">
          <input
            inputMode="tel"
            placeholder="Ex.: 5522999999999"
            value={phoneNumber}
            onChange={(event) => setPhoneNumber(event.target.value)}
          />
          <button className="button" disabled={busy || phoneNumber.replace(/\D/g, "").length < 10} type="button" onClick={() => onRequestPairingCode(phoneNumber)}>
            Gerar código
          </button>
        </div>
        {pairingCode ? <code className="pairing-code-value">{pairingCode}</code> : null}
      </div>
    </article>
  );
}
