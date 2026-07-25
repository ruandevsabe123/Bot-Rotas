import { AppRelease } from "./shared/types";

const RELEASE_DETAILS = {
  version: "1.5.0",
  publishedAt: "2026-07-25T20:00:00.000Z",
  title: "Primeira mensagem ainda mais rápida",
  summary: "O caminho entre a abertura do grupo e o primeiro envio recebeu uma nova rodada de otimizações internas.",
  changes: [
    {
      title: "Primeiro envio com prioridade máxima",
      description: "O bot agora inicia a primeira mensagem antes de preparar o envelope da segunda."
    },
    {
      title: "Criptografia mantida em memória",
      description: "As informações criptográficas usadas pelo grupo são carregadas antecipadamente e renovadas durante a espera."
    },
    {
      title: "Callback de imagem mais leve",
      description: "A chegada da imagem não faz mais leitura de configuração em disco antes de tratar os eventos do grupo."
    },
    {
      title: "Aquecimento continua silencioso",
      description: "As novas preparações permanecem totalmente internas, sem mensagem de teste e sem ação do cliente."
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
