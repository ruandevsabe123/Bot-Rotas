import { AppRelease } from "./shared/types";

const RELEASE_DETAILS = {
  version: "1.3.0",
  publishedAt: "2026-07-25T12:00:00.000Z",
  title: "Bot imagem protegido durante reconexões",
  summary: "O envio da rota agora continua protegido mesmo quando o WhatsApp oscila durante a análise da imagem.",
  changes: [
    {
      title: "Rota preservada durante a queda",
      description: "Se a imagem terminar de ser analisada sem conexão, o bot mantém a rota pronta e continua armado."
    },
    {
      title: "Envio retomado após reconectar",
      description: "Quando o WhatsApp volta, o bot verifica o grupo e envia a rota preservada se ele estiver aberto."
    },
    {
      title: "Proteção contra mensagem duplicada",
      description: "Se o WhatsApp já tiver aceitado a mensagem antes da queda, o sistema cancela o reenvio automático."
    },
    {
      title: "Menos reinícios desnecessários",
      description: "Uma falha temporária ao consultar o grupo não reinicia mais uma sessão que continua conectada."
    }
  ]
} satisfies Omit<AppRelease, "id">;

export function getCurrentRelease(environment: NodeJS.ProcessEnv = process.env): AppRelease {
  const deployId =
    environment.RENDER_GIT_COMMIT ||
    environment.APP_RELEASE_ID ||
    `local-${RELEASE_DETAILS.version}`;

  return {
    id: deployId.trim() || `local-${RELEASE_DETAILS.version}`,
    ...RELEASE_DETAILS,
    changes: RELEASE_DETAILS.changes.map((change) => ({ ...change }))
  };
}
