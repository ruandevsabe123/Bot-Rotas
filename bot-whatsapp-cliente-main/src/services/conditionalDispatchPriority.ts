import { DispatchMatchupRule } from "../shared/types";

export type ConditionalPriorityClient = {
  email: string;
  configuredLevel: number;
  beatsEmail?: string;
  advantageMs?: number;
  matchups?: DispatchMatchupRule[];
  priorityUpdatedAt?: string;
  connected: boolean;
  monitoringEnabled: boolean;
  monitoringMode?: "target" | "test";
  targetGroupKey: string;
};

type Edge = { winner: string; loser: string; delayMs: number; updatedAt: string; owner: string };

export type ConditionalDispatchBlocker = { email: string; delayMs: number };

export function computeConditionalDispatchPriorities(clients: ConditionalPriorityClient[]) {
  const plan = computeConditionalDispatchPlan(clients);
  return new Map([...plan].map(([email, item]) => [email, item.delayMs]));
}

export function computeConditionalDispatchBlockers(clients: ConditionalPriorityClient[]) {
  const plan = computeConditionalDispatchPlan(clients);
  return new Map([...plan].map(([email, item]) => [email, item.blockers]));
}

function computeConditionalDispatchPlan(clients: ConditionalPriorityClient[]) {
  const normalized = clients.map((client) => ({ ...client, email: client.email.trim().toLowerCase() }));
  const plan = new Map(normalized.map((client) => [client.email, { delayMs: 0, blockers: [] as ConditionalDispatchBlocker[] }]));
  const competitorsByGroup = new Map<string, ConditionalPriorityClient[]>();

  for (const client of normalized) {
    if (!client.connected || !client.monitoringEnabled || client.monitoringMode !== "target" || !client.targetGroupKey) continue;
    const competitors = competitorsByGroup.get(client.targetGroupKey) || [];
    competitors.push(client);
    competitorsByGroup.set(client.targetGroupKey, competitors);
  }

  for (const competitors of competitorsByGroup.values()) {
    if (competitors.length < 2) continue;
    const emails = new Set(competitors.map((client) => client.email));
    const candidates = competitors.flatMap((client) => rulesFor(client).flatMap((rule): Edge[] => {
      const opponent = rule.opponentEmail.trim().toLowerCase();
      if (!emails.has(opponent) || opponent === client.email) return [];
      return [{
        winner: rule.outcome === "loses" ? opponent : client.email,
        loser: rule.outcome === "loses" ? client.email : opponent,
        delayMs: normalizeDelay(rule.delayMs),
        updatedAt: String(client.priorityUpdatedAt || ""),
        owner: client.email
      }];
    })).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.owner.localeCompare(right.owner));

    const selectedByPair = new Map<string, Edge>();
    for (const edge of candidates) {
      const pair = [edge.winner, edge.loser].sort().join("::");
      if (!selectedByPair.has(pair)) selectedByPair.set(pair, edge);
    }

    const graph = new Map<string, Edge[]>();
    for (const edge of selectedByPair.values()) {
      if (hasPath(graph, edge.loser, edge.winner)) continue;
      graph.set(edge.winner, [...(graph.get(edge.winner) || []), edge]);
    }

    const groupPriorities = longestDelays(Array.from(emails), graph);
    const blockersByLoser = new Map<string, ConditionalDispatchBlocker[]>();
    for (const [winner, edges] of graph) {
      for (const edge of edges) {
        blockersByLoser.set(edge.loser, [
          ...(blockersByLoser.get(edge.loser) || []),
          { email: winner, delayMs: edge.delayMs }
        ]);
      }
    }
    for (const [email, delayMs] of groupPriorities) {
      plan.set(email, { delayMs, blockers: blockersByLoser.get(email) || [] });
    }
  }

  return plan;
}

function rulesFor(client: ConditionalPriorityClient): DispatchMatchupRule[] {
  if (client.matchups) return client.matchups;
  const legacyOpponent = String(client.beatsEmail || "").trim().toLowerCase();
  return legacyOpponent ? [{ opponentEmail: legacyOpponent, outcome: "wins", delayMs: normalizeDelay(client.advantageMs) }] : [];
}

function longestDelays(emails: string[], graph: Map<string, Edge[]>) {
  const delays = new Map(emails.map((email) => [email, 0]));
  for (let pass = 0; pass < emails.length; pass += 1) {
    let changed = false;
    for (const [winner, edges] of graph) {
      for (const edge of edges) {
        const next = (delays.get(winner) || 0) + edge.delayMs;
        if (next <= (delays.get(edge.loser) || 0)) continue;
        delays.set(edge.loser, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return delays;
}

function hasPath(graph: Map<string, Edge[]>, from: string, target: string, visited = new Set<string>()): boolean {
  if (from === target) return true;
  if (visited.has(from)) return false;
  visited.add(from);
  return (graph.get(from) || []).some((edge) => hasPath(graph, edge.loser, target, visited));
}

function normalizeDelay(value: unknown) {
  const parsed = Number(value);
  return Math.min(10_000, Math.max(400, Number.isFinite(parsed) ? Math.round(parsed) : 400));
}
