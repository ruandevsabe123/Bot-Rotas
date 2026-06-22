import fs from "fs";
import path from "path";
import { RouteDispatch, RouteReaction } from "../shared/types";

const MAX_ROUTES = 500;

export class RouteStore {
  constructor(private readonly filePath: string) {}

  all(): RouteDispatch[] {
    return this.load();
  }

  create(input: Omit<RouteDispatch, "createdAt" | "updatedAt" | "validated" | "reactions">) {
    const now = new Date().toISOString();
    const route: RouteDispatch = {
      ...input,
      createdAt: now,
      updatedAt: now,
      validated: false,
      reactions: []
    };

    this.save([route, ...this.load()].slice(0, MAX_ROUTES));
    return route;
  }

  update(id: string, patch: Partial<Pick<RouteDispatch, "confirmedCount" | "status" | "sentMessageIds">>) {
    this.save(
      this.load().map((route) =>
        route.id === id
          ? {
              ...route,
              ...patch,
              updatedAt: new Date().toISOString()
            }
          : route
      )
    );
  }

  validate(id: string, validatedBy: string) {
    let changed = false;
    const now = new Date().toISOString();
    this.save(
      this.load().map((route) => {
        if (route.id !== id) return route;
        changed = true;
        return {
          ...route,
          validated: true,
          validatedAt: route.validatedAt || now,
          validatedBy,
          updatedAt: now
        };
      })
    );
    return changed;
  }

  addReaction(messageId: string, reaction: RouteReaction) {
    let changed = false;
    const routes = this.load().map((route) => {
      if (!route.sentMessageIds.includes(messageId)) return route;

      changed = true;
      const alreadySaved = route.reactions.some((item) => item.id === reaction.id);
      return {
        ...route,
        reactions: alreadySaved ? route.reactions : [reaction, ...route.reactions].slice(0, 50),
        updatedAt: reaction.timestamp
      };
    });

    if (changed) this.save(routes);
    return changed;
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

  private save(routes: RouteDispatch[]) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(routes, null, 2));
  }

  private normalize(input: any): RouteDispatch | undefined {
    if (!input || typeof input.id !== "string") return undefined;

    return {
      id: input.id,
      clientEmail: typeof input.clientEmail === "string" ? input.clientEmail : "",
      groupJid: typeof input.groupJid === "string" ? input.groupJid : "",
      groupName: typeof input.groupName === "string" ? input.groupName : "",
      mode: input.mode === "test" ? "test" : "target",
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
      validatedAt: typeof input.validatedAt === "string" ? input.validatedAt : undefined,
      validatedBy: typeof input.validatedBy === "string" ? input.validatedBy : undefined,
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
