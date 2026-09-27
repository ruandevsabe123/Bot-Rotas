import crypto from "crypto";

export type DispatchGateBlocker = {
  email: string;
  delayMs: number;
  strict?: boolean;
};

export type DispatchGateRequest = {
  clientEmail: string;
  groupKey: string;
  eventDetectedAt: number;
  eventKey?: string;
  blockers: DispatchGateBlocker[];
};

export type DispatchGateGrant = {
  token: string;
  waitedMs: number;
};

export type DispatchRaceEventState = "processing" | "ready" | "unavailable";

export type DispatchRaceEvent = {
  clientEmail: string;
  groupKey: string;
  eventDetectedAt: number;
  eventKey: string;
  state: DispatchRaceEventState;
};

type PendingGate = {
  token: string;
  clientEmail: string;
  blockers: DispatchGateBlocker[];
  requestedAt: number;
  resolve: (grant: DispatchGateGrant) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  joinTimer?: NodeJS.Timeout;
  releaseTimer?: NodeJS.Timeout;
};

type RaceCycle = {
  id: string;
  groupKey: string;
  eventKey?: string;
  anchorAt: number;
  createdAt: number;
  tokens: Map<string, string>;
  requests: Map<string, Promise<DispatchGateGrant>>;
  relayedAt: Map<string, number>;
  failed: Set<string>;
  participantStates: Map<string, DispatchRaceEventState | "intent" | "relayed">;
  pending: Map<string, PendingGate>;
};

const DEFAULT_CYCLE_WINDOW_MS = 15_000;
const DEFAULT_GATE_TIMEOUT_MS = 120_000;
const DEFAULT_BLOCKER_JOIN_TIMEOUT_MS = 750;
const CYCLE_RETENTION_MS = 180_000;

export class DispatchRaceCoordinator {
  private readonly cycles = new Map<string, RaceCycle>();
  private readonly cycleByToken = new Map<string, RaceCycle>();
  // Keep each client's latest image declaration until a newer image replaces
  // it: groups can remain closed much longer than the normal cycle retention.
  private readonly latestImageCycleByClient = new Map<string, string>();

  constructor(
    private readonly cycleWindowMs = DEFAULT_CYCLE_WINDOW_MS,
    private readonly gateTimeoutMs = DEFAULT_GATE_TIMEOUT_MS,
    private readonly blockerJoinTimeoutMs = DEFAULT_BLOCKER_JOIN_TIMEOUT_MS
  ) {}

  announce(input: DispatchRaceEvent) {
    this.prune();
    const clientEmail = normalizeEmail(input.clientEmail);
    const groupKey = String(input.groupKey || "").trim().toLowerCase();
    const eventKey = normalizeEventKey(input.eventKey);
    if (!clientEmail || !groupKey || !eventKey) return false;
    const detectedAt = Number.isFinite(input.eventDetectedAt) ? input.eventDetectedAt : Date.now();
    const cycle = this.findOrCreateCycle(groupKey, detectedAt, eventKey);
    this.rememberImageCycle(clientEmail, cycle);
    // Analysis notifications can arrive after a relay notification. They must
    // never replace a confirmed send with an earlier processing state.
    if (cycle.relayedAt.has(clientEmail)) return true;
    cycle.participantStates.set(clientEmail, input.state);
    if (input.state === "unavailable") cycle.failed.add(clientEmail);
    else cycle.failed.delete(clientEmail);
    // A participant announcing a different image can also unblock a request
    // which arrived before its analysis announcement reached the server.
    this.evaluateGroupCycles(groupKey);
    return true;
  }

  request(input: DispatchGateRequest) {
    this.prune();
    const clientEmail = normalizeEmail(input.clientEmail);
    const groupKey = String(input.groupKey || "").trim().toLowerCase();
    const detectedAt = Number.isFinite(input.eventDetectedAt) ? input.eventDetectedAt : Date.now();
    const eventKey = normalizeEventKey(input.eventKey);
    const cycle = this.findOrCreateCycle(groupKey, detectedAt, eventKey);
    if (eventKey) this.rememberImageCycle(clientEmail, cycle);
    else this.latestImageCycleByClient.delete(clientEmail);
    const existing = cycle.requests.get(clientEmail);
    if (existing) return existing;
    const token = crypto.randomUUID();
    cycle.failed.delete(clientEmail);
    cycle.relayedAt.delete(clientEmail);
    cycle.participantStates.set(clientEmail, "intent");
    cycle.tokens.set(clientEmail, token);
    this.cycleByToken.set(token, cycle);

    const blockers = input.blockers
      .map((blocker) => ({
        email: normalizeEmail(blocker.email),
        delayMs: normalizeDelay(blocker.delayMs),
        strict: blocker.strict === true
      }))
      .filter((blocker) => blocker.email && blocker.email !== clientEmail);
    if (!blockers.length) {
      const grant = Promise.resolve({ token, waitedMs: 0 });
      cycle.requests.set(clientEmail, grant);
      this.evaluateGroupCycles(groupKey);
      return grant;
    }

    const request = new Promise<DispatchGateGrant>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.removePending(cycle, clientEmail);
        this.failRelay(token, clientEmail);
        reject(new Error("O ciclo do grupo expirou antes da confirmação do envio."));
      }, this.gateTimeoutMs);
      timeout.unref?.();
      cycle.pending.set(clientEmail, {
        token,
        clientEmail,
        blockers,
        requestedAt: Date.now(),
        resolve,
        reject,
        timeout
      });
      this.evaluateGroupCycles(groupKey);
    });
    cycle.requests.set(clientEmail, request);
    return request;
  }

  confirmRelay(token: string, clientEmail: string, relayedAt = Date.now()) {
    const cycle = this.cycleByToken.get(token);
    if (!cycle) return false;
    const email = normalizeEmail(clientEmail);
    if (cycle.tokens.get(email) !== token) return false;
    if (cycle.relayedAt.has(email)) return true;
    cycle.relayedAt.set(email, relayedAt);
    cycle.participantStates.set(email, "relayed");
    for (const pendingEmail of cycle.pending.keys()) this.evaluate(cycle, pendingEmail);
    return true;
  }

  failRelay(token: string, clientEmail: string) {
    const cycle = this.cycleByToken.get(token);
    if (!cycle) return false;
    const email = normalizeEmail(clientEmail);
    if (cycle.tokens.get(email) !== token || cycle.relayedAt.has(email)) return false;
    cycle.failed.add(email);
    cycle.participantStates.set(email, "unavailable");
    for (const pendingEmail of cycle.pending.keys()) this.evaluate(cycle, pendingEmail);
    return true;
  }

  cancelClient(clientEmail: string, reason = "Disparo cancelado pelo coordenador.") {
    const email = normalizeEmail(clientEmail);
    this.latestImageCycleByClient.delete(email);
    for (const cycle of this.cycles.values()) {
      const pending = cycle.pending.get(email);
      if (pending) {
        this.removePending(cycle, email);
        pending.reject(new Error(reason));
      }
      if (cycle.tokens.has(email) && !cycle.relayedAt.has(email)) cycle.failed.add(email);
      if (!cycle.relayedAt.has(email)) cycle.participantStates.set(email, "unavailable");
      for (const pendingEmail of cycle.pending.keys()) this.evaluate(cycle, pendingEmail);
    }
  }

  private findOrCreateCycle(groupKey: string, detectedAt: number, eventKey?: string) {
    const existing = [...this.cycles.values()]
      .filter((cycle) => cycle.groupKey === groupKey && (
        eventKey
          ? cycle.eventKey === eventKey
          : !cycle.eventKey && Math.abs(cycle.anchorAt - detectedAt) <= this.cycleWindowMs
      ))
      .sort((left, right) => Math.abs(left.anchorAt - detectedAt) - Math.abs(right.anchorAt - detectedAt))[0];
    if (existing) return existing;
    const cycle: RaceCycle = {
      id: crypto.randomUUID(),
      groupKey,
      eventKey,
      anchorAt: detectedAt,
      createdAt: Date.now(),
      tokens: new Map(),
      requests: new Map(),
      relayedAt: new Map(),
      failed: new Set(),
      participantStates: new Map(),
      pending: new Map()
    };
    this.cycles.set(cycle.id, cycle);
    return cycle;
  }

  private evaluate(cycle: RaceCycle, clientEmail: string) {
    const pending = cycle.pending.get(clientEmail);
    if (!pending || pending.releaseTimer) return;
    const joinedBlockers = pending.blockers.filter((blocker) => cycle.tokens.has(blocker.email));
    // An image without an eligible route is not a competing send. Even a
    // strict matchup cannot wait for a request that this client will not make.
    const absentBlockers = pending.blockers.filter((blocker) =>
      !cycle.tokens.has(blocker.email) && cycle.participantStates.get(blocker.email) !== "unavailable"
      && !this.isParticipatingInDifferentImage(cycle, blocker.email));
    // O servidor só envia blockers estritos quando confirmou que os dois bots
    // estão conectados, armados e no mesmo grupo. Nesse caso, jamais libere o
    // perdedor apenas porque o processo do vencedor demorou a entrar no ciclo.
    if (absentBlockers.some((blocker) => blocker.strict)) return;
    const knownActiveBlockers = absentBlockers.filter((blocker) => {
      const state = cycle.participantStates.get(blocker.email);
      return state === "processing" || state === "ready";
    });
    if (knownActiveBlockers.length) return;
    const unknownBlockers = absentBlockers.filter((blocker) => !cycle.participantStates.has(blocker.email));
    const joinDeadlineAt = pending.requestedAt + this.blockerJoinTimeoutMs;
    if (unknownBlockers.length && Date.now() < joinDeadlineAt) {
      if (!pending.joinTimer) {
        pending.joinTimer = setTimeout(() => {
          pending.joinTimer = undefined;
          this.evaluate(cycle, clientEmail);
        }, Math.max(0, joinDeadlineAt - Date.now()));
        pending.joinTimer.unref?.();
      }
      return;
    }
    if (pending.joinTimer) {
      clearTimeout(pending.joinTimer);
      pending.joinTimer = undefined;
    }

    // Regras comuns ainda permitem contingência quando o primeiro envio falha.
    // Regras estritas continuam bloqueadas: o cliente marcado para perder não
    // pode virar vencedor por atraso, queda ou diferença de internet.
    const activeBlockers = joinedBlockers.filter((blocker) => blocker.strict || !cycle.failed.has(blocker.email));
    if (!activeBlockers.length) {
      this.resolvePending(cycle, clientEmail, pending);
      return;
    }
    const relays = activeBlockers.map((blocker) => ({ blocker, relayedAt: cycle.relayedAt.get(blocker.email) }));
    if (relays.some((item) => !item.relayedAt)) return;
    const releaseAt = Math.max(...relays.map((item) => Number(item.relayedAt) + item.blocker.delayMs));
    const remainingMs = Math.max(0, releaseAt - Date.now());
    pending.releaseTimer = setTimeout(() => {
      if (cycle.pending.get(clientEmail) !== pending) return;
      this.resolvePending(cycle, clientEmail, pending);
    }, remainingMs);
    pending.releaseTimer.unref?.();
  }

  private evaluateGroupCycles(groupKey: string) {
    for (const cycle of this.cycles.values()) {
      if (cycle.groupKey !== groupKey) continue;
      for (const clientEmail of cycle.pending.keys()) this.evaluate(cycle, clientEmail);
    }
  }

  private rememberImageCycle(clientEmail: string, cycle: RaceCycle) {
    const previous = this.cycles.get(this.latestImageCycleByClient.get(clientEmail) || "");
    if (!previous || previous.anchorAt <= cycle.anchorAt) this.latestImageCycleByClient.set(clientEmail, cycle.id);
  }

  private isParticipatingInDifferentImage(cycle: RaceCycle, clientEmail: string) {
    if (!cycle.eventKey || cycle.participantStates.has(clientEmail)) return false;
    const other = this.cycles.get(this.latestImageCycleByClient.get(clientEmail) || "");
    if (!other || other.groupKey !== cycle.groupKey || !other.eventKey || other.eventKey === cycle.eventKey) return false;
    const state = other.participantStates.get(clientEmail);
    return state === "processing" || state === "ready" || state === "intent";
  }

  private resolvePending(cycle: RaceCycle, clientEmail: string, pending: PendingGate) {
    this.removePending(cycle, clientEmail);
    pending.resolve({ token: pending.token, waitedMs: Math.max(0, Date.now() - pending.requestedAt) });
  }

  private removePending(cycle: RaceCycle, clientEmail: string) {
    const pending = cycle.pending.get(clientEmail);
    if (!pending) return;
    clearTimeout(pending.timeout);
    if (pending.joinTimer) clearTimeout(pending.joinTimer);
    if (pending.releaseTimer) clearTimeout(pending.releaseTimer);
    cycle.pending.delete(clientEmail);
  }

  private prune() {
    const oldest = Date.now() - CYCLE_RETENTION_MS;
    const retainedImageCycles = new Set(this.latestImageCycleByClient.values());
    for (const [id, cycle] of this.cycles) {
      if (cycle.createdAt >= oldest || cycle.pending.size || retainedImageCycles.has(id)) continue;
      this.cycles.delete(id);
      for (const token of cycle.tokens.values()) this.cycleByToken.delete(token);
    }
  }
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEventKey(value: unknown) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function normalizeDelay(value: unknown) {
  const parsed = Number(value);
  return Math.max(0, Math.min(10_000, Number.isFinite(parsed) ? Math.round(parsed) : 400));
}
