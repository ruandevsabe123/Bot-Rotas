export type ConditionalPriorityClient = {
  email: string;
  configuredLevel: number;
  connected: boolean;
  monitoringEnabled: boolean;
  monitoringMode?: "target" | "test";
  targetGroupKey: string;
};

export function computeConditionalDispatchPriorities(clients: ConditionalPriorityClient[]) {
  const priorities = new Map(clients.map((client) => [client.email, 0]));
  const competitorsByGroup = new Map<string, ConditionalPriorityClient[]>();

  for (const client of clients) {
    if (!client.connected || !client.monitoringEnabled || client.monitoringMode !== "target" || !client.targetGroupKey) continue;
    const competitors = competitorsByGroup.get(client.targetGroupKey) || [];
    competitors.push(client);
    competitorsByGroup.set(client.targetGroupKey, competitors);
  }

  for (const competitors of competitorsByGroup.values()) {
    if (competitors.length < 2) continue;
    for (const client of competitors) priorities.set(client.email, normalizeLevel(client.configuredLevel));
  }

  return priorities;
}

function normalizeLevel(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(5, Math.max(0, Math.floor(parsed))) : 0;
}
