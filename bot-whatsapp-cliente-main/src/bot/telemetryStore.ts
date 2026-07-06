import fs from "fs";
import path from "path";
import { RouteDispatchTimeline } from "../shared/types";

export type DispatchTelemetryEvent = {
  id: string;
  timestamp: string;
  clientEmail: string;
  trigger?: string;
  mode: "target" | "test";
  confirmed: number;
  total: number;
  firstRelayMs?: number;
  firstAckMs?: number;
  totalDurationMs?: number;
  notAcceptableCount: number;
};

export type DispatchTelemetrySummary = {
  count: number;
  averageFirstRelayMs: number;
  p95FirstRelayMs: number;
  averageFirstAckMs: number;
  p95FirstAckMs: number;
  notAcceptableCount: number;
  lastNotAcceptableAt?: string;
};

const MAX_EVENTS = 1000;

export class TelemetryStore {
  private events?: DispatchTelemetryEvent[];
  private flushTimer?: NodeJS.Timeout;
  private dirty = false;

  constructor(private readonly filePath: string) {}

  all() {
    return [...this.getEvents()];
  }

  record(input: {
    clientEmail: string;
    trigger?: string;
    mode: "target" | "test";
    confirmed: number;
    total: number;
    timeline?: RouteDispatchTimeline;
  }) {
    const now = new Date().toISOString();
    const event: DispatchTelemetryEvent = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: now,
      clientEmail: input.clientEmail,
      trigger: input.trigger,
      mode: input.mode,
      confirmed: input.confirmed,
      total: input.total,
      firstRelayMs: input.timeline?.firstRelayCallMs,
      firstAckMs: input.timeline?.firstAckMs,
      totalDurationMs: input.timeline?.totalDurationMs,
      notAcceptableCount: input.timeline?.notAcceptableCount || 0
    };

    this.events = [event, ...this.getEvents()].slice(0, MAX_EVENTS);
    this.scheduleSave();
    return event;
  }

  summary(windowMs = 1000 * 60 * 60 * 24 * 30): DispatchTelemetrySummary {
    const cutoff = Date.now() - windowMs;
    const events = this.getEvents().filter((event) => new Date(event.timestamp).getTime() >= cutoff);
    const firstRelay = events.map((event) => event.firstRelayMs).filter((value): value is number => Number.isFinite(value));
    const firstAck = events.map((event) => event.firstAckMs).filter((value): value is number => Number.isFinite(value));
    const notAcceptableEvents = events.filter((event) => event.notAcceptableCount > 0);

    return {
      count: events.length,
      averageFirstRelayMs: average(firstRelay),
      p95FirstRelayMs: percentile(firstRelay, 95),
      averageFirstAckMs: average(firstAck),
      p95FirstAckMs: percentile(firstAck, 95),
      notAcceptableCount: events.reduce((total, event) => total + event.notAcceptableCount, 0),
      lastNotAcceptableAt: notAcceptableEvents[0]?.timestamp
    };
  }

  flush() {
    this.saveNow(this.getEvents());
  }

  private getEvents() {
    if (!this.events) this.events = this.load();
    return this.events;
  }

  private load(): DispatchTelemetryEvent[] {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return Array.isArray(data)
        ? data.map((item) => this.normalize(item)).filter(Boolean) as DispatchTelemetryEvent[]
        : [];
    } catch {
      return [];
    }
  }

  private normalize(input: any): DispatchTelemetryEvent | undefined {
    if (!input || typeof input.id !== "string" || typeof input.timestamp !== "string") return undefined;
    return {
      id: input.id,
      timestamp: input.timestamp,
      clientEmail: typeof input.clientEmail === "string" ? input.clientEmail : "",
      trigger: typeof input.trigger === "string" ? input.trigger : undefined,
      mode: input.mode === "test" ? "test" : "target",
      confirmed: Number(input.confirmed || 0),
      total: Number(input.total || 0),
      firstRelayMs: Number.isFinite(Number(input.firstRelayMs)) ? Number(input.firstRelayMs) : undefined,
      firstAckMs: Number.isFinite(Number(input.firstAckMs)) ? Number(input.firstAckMs) : undefined,
      totalDurationMs: Number.isFinite(Number(input.totalDurationMs)) ? Number(input.totalDurationMs) : undefined,
      notAcceptableCount: Number(input.notAcceptableCount || 0)
    };
  }

  private saveNow(events: DispatchTelemetryEvent[]) {
    this.dirty = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(events, null, 2));
  }

  private scheduleSave(delayMs = 250) {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      if (!this.dirty) return;
      this.saveNow(this.getEvents());
    }, delayMs);
  }
}

function average(values: number[]) {
  if (!values.length) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function percentile(values: number[], pct: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return Math.round(sorted[index] || 0);
}
