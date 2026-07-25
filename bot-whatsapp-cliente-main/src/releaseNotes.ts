import { AppRelease } from "./shared/types";

const RELEASE_DETAILS = {
  version: "1.1.0",
  publishedAt: "2026-07-25T12:00:00.000Z",
  title: "Atualização da conexão e do painel",
  summary: "Melhoramos a conexão do WhatsApp e deixamos as novidades de cada versão mais claras no painel.",
  changes: [
    {
      title: "Novidades no primeiro acesso",
      description: "Depois de cada atualização, o painel mostrará uma única vez um resumo simples do que mudou."
    },
    {
      title: "QR Code com mais tempo",
      description: "Agora cada código permanece válido por 60 segundos, inclusive depois da primeira tentativa."
    },
    {
      title: "Leitura mais fácil no iPhone",
      description: "O código ficou maior, com contraste melhor e mostra na tela quanto tempo ainda falta."
    },
    {
      title: "Tentativas antigas descartadas",
      description: "Códigos vencidos somem automaticamente e o botão de atualizar inicia uma tentativa realmente nova."
    },
    {
      title: "Sessão mais protegida",
      description: "A conexão agora salva os dados do WhatsApp antes de reiniciar, diminuindo desconexões e pedidos de QR repetidos."
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
