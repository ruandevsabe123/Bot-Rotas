import crypto from "crypto";

export type DispatchGateBlocker = {
  email: string;
  delayMs: number;
};

export type DispatchGateRequest = {
  clientEmail: string;
  groupKey: string;
  eventDetectedAt: number;
  blockers: DispatchGateBlocker[];
};

export type DispatchGateGrant = {
  token: string;
  waitedMs: number;
};

type PendingGate = {
  token: string;
  clientEmail: string;
  blockers: DispatchGateBlocker[];
  requestedAt: number;
  resolve: (grant: DispatchGateGrant) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  releaseTimer?: NodeJS.Timeout;
};

type RaceCycle = {
  id: string;
  groupKey: string;
  anchorAt: number;
  createdAt: number;
  tokens: Map<string, string>;
  relayedAt: Map<string, number>;
  pending: Map<string, PendingGate>;
};

const DEFAULT_CYCLE_WINDOW_MS = 15_000;
const DEFAULT_GATE_TIMEOUT_MS = 120_000;
const CYCLE_RETENTION_MS = 180_000;

export class DispatchRaceCoordinator {
  private readonly cycles = new Map<string, RaceCycle>();
  private readonly cycleByToken = new Map<string, RaceCycle>();

  constructor(
    private readonly cycleWindowMs = DEFAULT_CYCLE_WINDOW_MS,
    private readonly gateTimeoutMs = DEFAULT_GATE_TIMEOUT_MS
  ) {}

  request(input: DispatchGateRequest) {
    this.prune();
    const clientEmail = normalizeEmail(input.clientEmail);
    const groupKey = String(input.groupKey || "").trim().toLowerCase();
    const detectedAt = Number.isFinite(input.eventDetectedAt) ? input.eventDetectedAt : Date.now();
    const cycle = this.findOrCreateCycle(groupKey, detectedAt);
    const token = crypto.randomUUID();
    cycle.tokens.set(clientEmail, token);
    this.cycleByToken.set(token, cycle);

    const blockers = input.blockers
      .map((blocker) => ({ email: normalizeEmail(blocker.email), delayMs: normalizeDelay(blocker.delayMs) }))
      .filter((blocker) => blocker.email && blocker.email !== clientEmail);
    if (!blockers.length) return Promise.resolve({ token, waitedMs: 0 });

    return new Promise<DispatchGateGrant>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cycle.pending.delete(clientEmail);
        reject(new Error("Disparo bloqueado: o cliente configurado para vencer não confirmou o relay deste ciclo."));
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
      this.evaluate(cycle, clientEmail);
    });
  }

  confirmRelay(token: string, clientEmail: string, relayedAt = Date.now()) {
    const cycle = this.cycleByToken.get(token);
    if (!cycle) return false;
    const email = normalizeEmail(clientEmail);
    if (cycle.tokens.get(email) !== token) return false;
    cycle.relayedAt.set(email, relayedAt);
    for (const pendingEmail of cycle.pending.keys()) this.evaluate(cycle, pendingEmail);
    return true;
  }

  cancelClient(clientEmail: string, reason = "Disparo cancelado pelo coordenador.") {
    const email = normalizeEmail(clientEmail);
    for (const cycle of this.cycles.values()) {
      const pending = cycle.pending.get(email);
      if (!pending) continue;
      clearTimeout(pending.timeout);
      if (pending.releaseTimer) clearTimeout(pending.releaseTimer);
      cycle.pending.delete(email);
      pending.reject(new Error(reason));
    }
  }

  private findOrCreateCycle(groupKey: string, detectedAt: number) {
    const existing = [...this.cycles.values()]
      .filter((cycle) => cycle.groupKey === groupKey && Math.abs(cycle.anchorAt - detectedAt) <= this.cycleWindowMs)
      .sort((left, right) => Math.abs(left.anchorAt - detectedAt) - Math.abs(right.anchorAt - detectedAt))[0];
    if (existing) return existing;
    const cycle: RaceCycle = {
      id: crypto.randomUUID(),
      groupKey,
      anchorAt: detectedAt,
      createdAt: Date.now(),
      tokens: new Map(),
      relayedAt: new Map(),
      pending: new Map()
    };
    this.cycles.set(cycle.id, cycle);
    return cycle;
  }

  private evaluate(cycle: RaceCycle, clientEmail: string) {
    const pending = cycle.pending.get(clientEmail);
    if (!pending || pending.releaseTimer) return;
    const relays = pending.blockers.map((blocker) => ({ blocker, relayedAt: cycle.relayedAt.get(blocker.email) }));
    if (relays.some((item) => !item.relayedAt)) return;
    const releaseAt = Math.max(...relays.map((item) => Number(item.relayedAt) + item.blocker.delayMs));
    const remainingMs = Math.max(0, releaseAt - Date.now());
    pending.releaseTimer = setTimeout(() => {
      if (cycle.pending.get(clientEmail) !== pending) return;
      clearTimeout(pending.timeout);
      cycle.pending.delete(clientEmail);
      pending.resolve({ token: pending.token, waitedMs: Math.max(0, Date.now() - pending.requestedAt) });
    }, remainingMs);
    pending.releaseTimer.unref?.();
  }

  private prune() {
    const oldest = Date.now() - CYCLE_RETENTION_MS;
    for (const [id, cycle] of this.cycles) {
      if (cycle.createdAt >= oldest || cycle.pending.size) continue;
      this.cycles.delete(id);
      for (const token of cycle.tokens.values()) this.cycleByToken.delete(token);
    }
  }
}

function normalizeEmail(value: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeDelay(value: unknown) {
  const parsed = Number(value);
  return Math.max(0, Math.min(10_000, Number.isFinite(parsed) ? Math.round(parsed) : 400));
}
