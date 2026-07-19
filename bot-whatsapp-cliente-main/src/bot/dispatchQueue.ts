import fs from "fs";
import path from "path";
import { RouteDispatch } from "../shared/types";

export type DispatchQueueStatus = "queued" | "sending" | "sent" | "partial" | "failed" | "abandoned";

export type DispatchQueueItem = {
  id: string;
  cycleId: number;
  clientEmail: string;
  jid: string;
  messages: string[];
  trigger: RouteDispatch["trigger"];
  mode: RouteDispatch["mode"];
  status: DispatchQueueStatus;
  attempts: number;
  confirmedCount: number;
  totalCount: number;
  routeId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
};

const MAX_QUEUE_ITEMS = 250;

export class DispatchQueueStore {
  private items?: DispatchQueueItem[];
  private flushTimer?: NodeJS.Timeout;
  private dirty = false;

  constructor(private readonly filePath: string) {}

  all() {
    return [...this.getItems()];
  }

  clear() {
    this.items = [];
    this.scheduleSave(0);
  }

  pending() {
    return this.getItems().filter((item) => item.status === "queued" || item.status === "sending");
  }

  hasRecentEquivalent(jid: string, messages: string[], maxAgeMs = 30 * 60 * 1000, now = Date.now()) {
    const signature = this.signature(jid, messages);
    return this.getItems().some((item) => {
      if (!["queued", "sending", "sent", "partial"].includes(item.status)) return false;
      if (now - new Date(item.createdAt).getTime() > maxAgeMs) return false;
      return this.signature(item.jid, item.messages) === signature;
    });
  }

  enqueue(input: Omit<DispatchQueueItem, "id" | "status" | "attempts" | "confirmedCount" | "totalCount" | "createdAt" | "updatedAt"> & { id?: string }) {
    const now = new Date().toISOString();
    const existing = input.id ? this.getItems().find((item) => item.id === input.id) : undefined;
    if (existing) return existing;

    const item: DispatchQueueItem = {
      ...input,
      id: input.id || `${Date.now()}-${input.cycleId}`,
      status: "queued",
      attempts: 0,
      confirmedCount: 0,
      totalCount: input.messages.length,
      createdAt: now,
      updatedAt: now
    };

    this.items = [item, ...this.getItems()].slice(0, MAX_QUEUE_ITEMS);
    this.scheduleSave(0);
    return item;
  }

  markSending(id: string, routeId?: string) {
    this.patch(id, {
      status: "sending",
      routeId,
      startedAt: new Date().toISOString()
    }, true);
  }

  markFinished(id: string, status: Extract<DispatchQueueStatus, "sent" | "partial" | "failed">, confirmedCount: number, error?: string) {
    this.patch(id, {
      status,
      confirmedCount,
      error,
      finishedAt: new Date().toISOString()
    });
  }

  markAbandoned(id: string, error: string) {
    this.patch(id, {
      status: "abandoned",
      error,
      finishedAt: new Date().toISOString()
    });
  }

  incrementAttempts(id: string) {
    const item = this.getItems().find((entry) => entry.id === id);
    if (!item) return;
    this.patch(id, { attempts: item.attempts + 1 }, true);
  }

  flush() {
    this.saveNow(this.getItems());
  }

  private patch(id: string, patch: Partial<DispatchQueueItem>, immediate = false) {
    let changed = false;
    this.items = this.getItems().map((item) => {
      if (item.id !== id) return item;
      changed = true;
      return {
        ...item,
        ...patch,
        updatedAt: new Date().toISOString()
      };
    });
    if (changed) this.scheduleSave(immediate ? 0 : 250);
  }

  private getItems() {
    if (!this.items) this.items = this.load();
    return this.items;
  }

  private signature(jid: string, messages: string[]) {
    return `${jid}::${messages.map((message) => message.trim()).join("\u001f")}`;
  }

  private load(): DispatchQueueItem[] {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return Array.isArray(data)
        ? data.map((item) => this.normalize(item)).filter(Boolean) as DispatchQueueItem[]
        : [];
    } catch {
      return [];
    }
  }

  private normalize(input: any): DispatchQueueItem | undefined {
    if (!input || typeof input.id !== "string") return undefined;
    const messages = Array.isArray(input.messages) ? input.messages.filter((item: unknown) => typeof item === "string") : [];
    return {
      id: input.id,
      cycleId: Number(input.cycleId || 0),
      clientEmail: typeof input.clientEmail === "string" ? input.clientEmail : "",
      jid: typeof input.jid === "string" ? input.jid : "",
      messages,
      trigger: ["automatic", "manual", "warmup", "target-simulation", "simulation"].includes(input.trigger) ? input.trigger : "automatic",
      mode: input.mode === "test" ? "test" : "target",
      status: ["queued", "sending", "sent", "partial", "failed", "abandoned"].includes(input.status) ? input.status : "queued",
      attempts: Number(input.attempts || 0),
      confirmedCount: Number(input.confirmedCount || 0),
      totalCount: Number(input.totalCount || messages.length),
      routeId: typeof input.routeId === "string" ? input.routeId : undefined,
      error: typeof input.error === "string" ? input.error : undefined,
      createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
      updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
      startedAt: typeof input.startedAt === "string" ? input.startedAt : undefined,
      finishedAt: typeof input.finishedAt === "string" ? input.finishedAt : undefined
    };
  }

  private saveNow(items: DispatchQueueItem[]) {
    this.dirty = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(items, null, 2));
  }

  private scheduleSave(delayMs = 250) {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      if (!this.dirty) return;
      this.saveNow(this.getItems());
    }, delayMs);
  }
}
