import fs from "fs";
import path from "path";
import { RouteDispatch, RouteReaction } from "../shared/types";

const MAX_ROUTES = 100;

export class RouteStore {
  private routes?: RouteDispatch[];
  private flushTimer?: NodeJS.Timeout;
  private dirty = false;

  constructor(private readonly filePath: string) {}

  all(): RouteDispatch[] {
    return [...this.getRoutes()];
  }

  clear() {
    this.routes = [];
    this.scheduleSave(0);
  }

  create(input: Omit<RouteDispatch, "createdAt" | "updatedAt" | "validated" | "reactions">) {
    const now = new Date().toISOString();
    const route: RouteDispatch = {
      ...input,
      createdAt: now,
      updatedAt: now,
      validated: false,
      decisionStatus: "pending",
      reactions: []
    };

    this.routes = [route, ...this.getRoutes()].slice(0, MAX_ROUTES);
    this.scheduleSave();
    return route;
  }

  update(id: string, patch: Partial<Pick<RouteDispatch, "confirmedCount" | "status" | "sentMessageIds">>) {
    this.routes =
      this.getRoutes().map((route) =>
        route.id === id
          ? {
              ...route,
              ...patch,
              updatedAt: new Date().toISOString()
            }
          : route
      );
    this.scheduleSave();
  }

  validate(id: string, validatedBy: string) {
    let changed = false;
    const now = new Date().toISOString();
    this.routes =
      this.getRoutes().map((route) => {
        if (route.id !== id) return route;
        changed = true;
        return {
          ...route,
          validated: true,
          decisionStatus: "validated",
          validatedAt: route.validatedAt || now,
          validatedBy,
          updatedAt: now
        };
      });
    if (changed) this.scheduleSave();
    return changed;
  }

  reject(id: string, rejectedBy: string) {
    let changed = false;
    const now = new Date().toISOString();
    this.routes =
      this.getRoutes().map((route) => {
        if (route.id !== id) return route;
        changed = true;
        return {
          ...route,
          validated: false,
          decisionStatus: "rejected" as const,
          rejectedAt: route.rejectedAt || now,
          rejectedBy,
          updatedAt: now
        };
      });
    if (changed) this.scheduleSave();
    return changed;
  }

  addReaction(messageId: string, reaction: RouteReaction) {
    let changed = false;
    const routes = this.getRoutes().map((route) => {
      if (!route.sentMessageIds.includes(messageId)) return route;

      changed = true;
      const alreadySaved = route.reactions.some((item) => item.id === reaction.id);
      return {
        ...route,
        reactions: alreadySaved ? route.reactions : [reaction, ...route.reactions],
        updatedAt: reaction.timestamp
      };
    });

    if (changed) {
      this.routes = routes;
      this.scheduleSave();
    }
    return changed;
  }

  flush() {
    this.saveNow(this.getRoutes());
  }

  private getRoutes() {
    if (!this.routes) this.routes = this.load();
    return this.routes;
  }

  private load(): RouteDispatch[] {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return Array.isArray(data) ? data.map((item) => this.normalize(item)).filter(Boolean) as RouteDispatch[] : [];
    } catch {
      return [];
    }
  }

  private saveNow(routes: RouteDispatch[]) {
    this.dirty = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(routes, null, 2));
  }

  private scheduleSave(delayMs = 250) {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      if (!this.dirty) return;
      this.saveNow(this.getRoutes());
    }, delayMs);
  }

  private normalize(input: any): RouteDispatch | undefined {
    if (!input || typeof input.id !== "string") return undefined;

    return {
      id: input.id,
      clientEmail: typeof input.clientEmail === "string" ? input.clientEmail : "",
      groupJid: typeof input.groupJid === "string" ? input.groupJid : "",
      groupName: typeof input.groupName === "string" ? input.groupName : "",
      mode: input.mode === "test" ? "test" : "target",
      trigger: ["automatic", "manual", "warmup", "target-simulation", "simulation"].includes(input.trigger)
        ? input.trigger
        : input.mode === "test"
        ? "warmup"
        : "automatic",
      messages: Array.isArray(input.messages) ? input.messages.filter((item: unknown) => typeof item === "string") : [],
      sentMessageIds: Array.isArray(input.sentMessageIds)
        ? input.sentMessageIds.filter((item: unknown) => typeof item === "string")
        : [],
      confirmedCount: Number(input.confirmedCount || 0),
      totalCount: Number(input.totalCount || 0),
      status: ["sending", "sent", "partial", "failed"].includes(input.status) ? input.status : "sending",
      createdAt: typeof input.createdAt === "string" ? input.createdAt : new Date().toISOString(),
      updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : new Date().toISOString(),
      validated: Boolean(input.validated),
      decisionStatus: input.decisionStatus === "rejected" ? "rejected" : Boolean(input.validated) ? "validated" : "pending",
      validatedAt: typeof input.validatedAt === "string" ? input.validatedAt : undefined,
      validatedBy: typeof input.validatedBy === "string" ? input.validatedBy : undefined,
      rejectedAt: typeof input.rejectedAt === "string" ? input.rejectedAt : undefined,
      rejectedBy: typeof input.rejectedBy === "string" ? input.rejectedBy : undefined,
      reactions: Array.isArray(input.reactions)
        ? input.reactions.map((item: any) => ({
            id: typeof item.id === "string" ? item.id : "",
            timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
            emoji: typeof item.emoji === "string" ? item.emoji : "",
            senderJid: typeof item.senderJid === "string" ? item.senderJid : "",
            senderPhone: typeof item.senderPhone === "string" ? item.senderPhone : "",
            senderIdentifiers: Array.isArray(item.senderIdentifiers)
              ? item.senderIdentifiers.filter((identifier: unknown) => typeof identifier === "string")
              : undefined,
            isAdmin: Boolean(item.isAdmin),
            leaderName: typeof item.leaderName === "string" ? item.leaderName : undefined
          })).filter((item: RouteReaction) => item.id)
        : []
    };
  }
}
