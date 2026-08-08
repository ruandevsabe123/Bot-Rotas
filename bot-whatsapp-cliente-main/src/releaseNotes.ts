import { AppRelease } from "./shared/types";

const RELEASE_DETAILS = {
  version: "1.7.0",
  publishedAt: "2026-07-25T18:42:08.000Z",
  clientVisible: false,
  title: "Sessão mais rápida e diagnóstico profundo",
  summary: "A sessão do WhatsApp ficou mais ágil no primeiro disparo e ganhou novas proteções para continuar conectada após atualizações.",
  changes: [
    {
      title: "Sessão transacional",
      description: "Credenciais e chaves agora usam um armazenamento mais rápido, com migração automática e cópia de segurança do formato anterior."
    },
    {
      title: "Primeiro disparo mais leve",
      description: "Leituras e gravações da sessão deixam de disputar vários arquivos no momento em que a rota precisa ser enviada."
    },
    {
      title: "Faixa rápida adaptativa",
      description: "Quando o histórico recente está saudável, a segunda mensagem pode avançar mais cedo sem perder as proteções contra rejeição."
    },
    {
      title: "Diagnóstico no painel",
      description: "O admin passa a enxergar tempo do socket, acesso às chaves, dispositivos preparados e o modo usado em cada disparo."
    }
  ]
} satisfies Omit<AppRelease, "id"> & { clientVisible: boolean };

export function shouldShowCurrentReleaseToClients() {
  return RELEASE_DETAILS.clientVisible;
}

export function getCurrentRelease(environment: NodeJS.ProcessEnv = process.env): AppRelease {
  const deployId =
    environment.RENDER_GIT_COMMIT ||
    environment.APP_RELEASE_ID ||
    `local-${RELEASE_DETAILS.version}`;

  return {
    id: deployId.trim() || `local-${RELEASE_DETAILS.version}`,
    version: RELEASE_DETAILS.version,
    publishedAt: RELEASE_DETAILS.publishedAt,
    title: RELEASE_DETAILS.title,
    summary: RELEASE_DETAILS.summary,
    changes: RELEASE_DETAILS.changes.map((change) => ({ ...change }))
  };
}
