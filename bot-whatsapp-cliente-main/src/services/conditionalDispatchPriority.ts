export type ConditionalPriorityClient = {
  email: string;
  configuredLevel: number;
  beatsEmail?: string;
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
    const competitorEmails = new Set(competitors.map((client) => client.email));
    for (const winner of competitors) {
      const loserEmail = String(winner.beatsEmail || "").trim().toLowerCase();
      if (loserEmail && loserEmail !== winner.email && competitorEmails.has(loserEmail)) priorities.set(loserEmail, 1);
    }
  }

  return priorities;
}
