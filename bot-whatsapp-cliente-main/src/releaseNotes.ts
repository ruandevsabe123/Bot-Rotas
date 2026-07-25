import { AppRelease } from "./shared/types";

const RELEASE_DETAILS = {
  version: "1.6.0",
  publishedAt: "2026-07-25T22:00:00.000Z",
  title: "Faixa exclusiva para o disparo",
  summary: "Durante a espera pela abertura, o processo do bot agora fica mais livre para reagir imediatamente ao evento.",
  changes: [
    {
      title: "Espera praticamente ociosa",
      description: "Verificações com cache válido não geram snapshots, remontagem de mensagens ou leitura repetida de configuração."
    },
    {
      title: "Dispositivos atualizados ao armar",
      description: "O bot consulta uma lista fresca dos dispositivos do grupo ao iniciar e usa cache nos ciclos seguintes."
    },
    {
      title: "Logs sem bloquear o envio",
      description: "A gravação automática do histórico agora usa disco de forma assíncrona e não segura o callback do WhatsApp."
    },
    {
      title: "Saúde mais leve",
      description: "O monitoramento verifica o WebSocket sem repetir consultas pesadas já cobertas pelo aquecimento."
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
