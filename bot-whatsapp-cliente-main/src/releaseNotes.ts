import { AppRelease } from "./shared/types";

const RELEASE_DETAILS = {
  version: "1.2.0",
  publishedAt: "2026-07-25T12:00:00.000Z",
  title: "Testes mais práticos no painel",
  summary: "O administrador agora consegue conferir a experiência de um cliente de teste sem precisar sair e entrar em outra conta.",
  changes: [
    {
      title: "Modo cliente no painel admin",
      description: "Selecione o cliente de teste ou use a conta de teste identificada pelo sistema para abrir o painel exatamente como ela vê."
    },
    {
      title: "Retorno rápido e seguro",
      description: "Uma faixa no modo de teste permite voltar ao painel administrativo sem informar a senha novamente."
    },
    {
      title: "Avisos também para o administrador",
      description: "As novidades de cada versão agora aparecem uma vez para o admin, além de continuarem disponíveis para cada cliente."
    },
    {
      title: "Proteção contra conta errada",
      description: "O sistema não entra automaticamente em um cliente real: ele exige uma conta de teste reconhecida ou uma seleção feita no filtro."
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
