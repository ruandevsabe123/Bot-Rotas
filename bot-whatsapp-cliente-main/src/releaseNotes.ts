import { AppRelease } from "./shared/types";

const RELEASE_DETAILS = {
  version: "1.4.0",
  publishedAt: "2026-07-25T18:00:00.000Z",
  title: "Primeiro disparo mais aquecido",
  summary: "O bot agora mantém internamente o grupo e a sessão preparados para reduzir a demora da primeira mensagem.",
  changes: [
    {
      title: "Preparação automática ao armar",
      description: "Ao iniciar ou reconectar, o bot prepara grupo, dispositivos e mensagens antes de ficar aguardando a abertura."
    },
    {
      title: "Sessões mantidas prontas",
      description: "A preparação interna é renovada durante a espera para diminuir o impacto do primeiro disparo."
    },
    {
      title: "Sem mensagem de aquecimento",
      description: "Todo o processo acontece internamente e não envia testes nem exige qualquer ação do cliente."
    },
    {
      title: "Prontidão visível no painel",
      description: "O painel e a telemetria agora mostram se o disparo começou com a preparação aquecida."
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
