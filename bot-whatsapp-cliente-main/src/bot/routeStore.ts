import fs from "fs";
import path from "path";
import { RouteClientIncident, RouteDispatch, RouteDispatchTimeline, RouteReaction, RouteReactionFinalState, RouteReactionHistoryEvent } from "../shared/types";

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
      reactions: [],
      reactionsHistory: [],
      lastReactionState: { status: "none" }
    };

    this.routes = [route, ...this.getRoutes()].slice(0, MAX_ROUTES);
    this.scheduleSave();
    return route;
  }

  update(id: string, patch: Partial<Pick<RouteDispatch, "confirmedCount" | "status" | "sentMessageIds" | "dispatchTimeline">>) {
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

  reject(id: string, rejectedBy: string, reason?: string) {
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
          decisionReason: reason?.trim() || route.decisionReason,
          updatedAt: now
        };
      });
    if (changed) this.scheduleSave();
    return changed;
  }

  requireClientIncident(messageId: string, incident: Omit<RouteClientIncident, "required" | "createdAt"> & { createdAt?: string }) {
    let changed = false;
    const now = new Date().toISOString();
    this.routes = this.getRoutes().map((route) => {
      if (!route.sentMessageIds.includes(messageId)) return route;
      if (route.clientIncident?.required && !route.clientIncident.answeredAt) return route;
      changed = true;
      return {
        ...route,
        clientIncident: {
          ...incident,
          required: true,
          createdAt: incident.createdAt || now
        },
        updatedAt: incident.createdAt || now
      };
    });
    if (changed) this.scheduleSave();
    return changed;
  }

  answerClientIncident(routeId: string, answer: { valid: boolean; reason: string }) {
    let changed = false;
    const now = new Date().toISOString();
    this.routes = this.getRoutes().map((route) => {
      if (route.id !== routeId || !route.clientIncident?.required || route.clientIncident.answeredAt) return route;
      changed = true;
      return {
        ...route,
        clientIncident: {
          ...route.clientIncident,
          valid: answer.valid,
          reason: answer.reason.trim(),
          answeredAt: now,
          required: false
        },
        updatedAt: now
      };
    });
    if (changed) this.scheduleSave();
    return changed;
  }

  recordDeletedMessage(messageId: string) {
    let changed = false;
    const now = new Date().toISOString();
    this.routes = this.getRoutes().map((route) => {
      if (!route.sentMessageIds.includes(messageId)) return route;
      changed = true;
      const deletedMessageIds = route.deletedMessageIds?.includes(messageId)
        ? route.deletedMessageIds
        : [messageId, ...(route.deletedMessageIds || [])];
      return {
        ...route,
        deletedMessageIds,
        updatedAt: now
      };
    });
    if (changed) this.scheduleSave();
    return changed;
  }

  addReaction(messageId: string, reaction: RouteReaction) {
    return this.recordReactionEvent(messageId, reaction, reaction.emoji ? "add" : "remove");
  }

  recordReactionEvent(messageId: string, reaction: RouteReaction, action: RouteReactionHistoryEvent["action"]) {
    let changed = false;
    const routes = this.getRoutes().map((route) => {
      if (!route.sentMessageIds.includes(messageId)) return route;

      changed = true;
      const alreadySaved = route.reactions.some((item) => item.id === reaction.id);
      const event: RouteReactionHistoryEvent = {
        ...reaction,
        id: `${reaction.id}:${action}`,
        action
      };
      const historyAlreadySaved = (route.reactionsHistory || []).some((item) => item.id === event.id);
      const lastReactionState: RouteReactionFinalState = {
        status: action === "remove" ? "removed" : "active",
        updatedAt: reaction.timestamp,
        emoji: reaction.emoji,
        senderPhone: reaction.senderPhone,
        leaderName: reaction.leaderName,
        isAdmin: reaction.isAdmin
      };

      return {
        ...route,
        reactions: action === "remove" || alreadySaved ? route.reactions : [reaction, ...route.reactions],
        reactionsHistory: historyAlreadySaved ? route.reactionsHistory : [event, ...(route.reactionsHistory || [])],
        lastReactionState,
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
      decisionReason: typeof input.decisionReason === "string" ? input.decisionReason : undefined,
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
        : [],
      reactionsHistory: Array.isArray(input.reactionsHistory)
        ? input.reactionsHistory.map((item: any) => ({
            id: typeof item.id === "string" ? item.id : "",
            timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
            action: item.action === "remove" ? "remove" as const : "add" as const,
            emoji: typeof item.emoji === "string" ? item.emoji : "",
            senderJid: typeof item.senderJid === "string" ? item.senderJid : "",
            senderPhone: typeof item.senderPhone === "string" ? item.senderPhone : "",
            senderIdentifiers: Array.isArray(item.senderIdentifiers)
              ? item.senderIdentifiers.filter((identifier: unknown) => typeof identifier === "string")
              : undefined,
            isAdmin: Boolean(item.isAdmin),
            leaderName: typeof item.leaderName === "string" ? item.leaderName : undefined
          })).filter((item: RouteReactionHistoryEvent) => item.id)
        : [],
      lastReactionState: input.lastReactionState && typeof input.lastReactionState === "object"
        ? {
            status: input.lastReactionState.status === "removed" ? "removed" : input.lastReactionState.status === "active" ? "active" : "none",
            updatedAt: typeof input.lastReactionState.updatedAt === "string" ? input.lastReactionState.updatedAt : undefined,
            emoji: typeof input.lastReactionState.emoji === "string" ? input.lastReactionState.emoji : undefined,
            senderPhone: typeof input.lastReactionState.senderPhone === "string" ? input.lastReactionState.senderPhone : undefined,
            leaderName: typeof input.lastReactionState.leaderName === "string" ? input.lastReactionState.leaderName : undefined,
            isAdmin: typeof input.lastReactionState.isAdmin === "boolean" ? input.lastReactionState.isAdmin : undefined
          }
        : input.reactions?.length
        ? { status: "active" as const, updatedAt: input.updatedAt }
        : { status: "none" as const },
      ocr: input.ocr && typeof input.ocr === "object"
        ? {
            source: typeof input.ocr.source === "string" ? input.ocr.source : "",
            text: typeof input.ocr.text === "string" ? input.ocr.text : undefined,
            line: typeof input.ocr.line === "string" ? input.ocr.line : undefined,
            route: typeof input.ocr.route === "string" ? input.ocr.route : undefined,
            cidade: typeof input.ocr.cidade === "string" ? input.ocr.cidade : undefined,
            bairro: typeof input.ocr.bairro === "string" ? input.ocr.bairro : undefined,
            code: typeof input.ocr.code === "string" ? input.ocr.code : undefined,
            confidence: Number.isFinite(Number(input.ocr.confidence)) ? Number(input.ocr.confidence) : undefined,
            processedAt: typeof input.ocr.processedAt === "string" ? input.ocr.processedAt : new Date().toISOString(),
            imagePreviewUrl: typeof input.ocr.imagePreviewUrl === "string" ? input.ocr.imagePreviewUrl : undefined
          }
        : undefined,
      clientIncident: input.clientIncident && typeof input.clientIncident === "object"
        ? {
            required: Boolean(input.clientIncident.required),
            kind: input.clientIncident.kind === "message_deleted" ? "message_deleted" : "leader_reaction_removed",
            createdAt: typeof input.clientIncident.createdAt === "string" ? input.clientIncident.createdAt : new Date().toISOString(),
            message: typeof input.clientIncident.message === "string" ? input.clientIncident.message : "",
            answeredAt: typeof input.clientIncident.answeredAt === "string" ? input.clientIncident.answeredAt : undefined,
            valid: typeof input.clientIncident.valid === "boolean" ? input.clientIncident.valid : undefined,
            reason: typeof input.clientIncident.reason === "string" ? input.clientIncident.reason : undefined
          }
        : undefined,
      deletedMessageIds: Array.isArray(input.deletedMessageIds)
        ? input.deletedMessageIds.filter((item: unknown) => typeof item === "string")
        : [],
      dispatchTimeline: this.normalizeTimeline(input.dispatchTimeline)
    };
  }

  private normalizeTimeline(input: any): RouteDispatchTimeline | undefined {
    if (!input || typeof input !== "object") return undefined;
    const events = Array.isArray(input.events)
      ? input.events.map((event: any) => ({
          id: typeof event.id === "string" ? event.id : `${Date.now()}-${Math.random()}`,
          label: typeof event.label === "string" ? event.label : "",
          at: typeof event.at === "string" ? event.at : new Date().toISOString(),
          offsetMs: Number.isFinite(Number(event.offsetMs)) ? Number(event.offsetMs) : 0,
          level: ["info", "success", "warning", "error"].includes(event.level) ? event.level : "info",
          detail: typeof event.detail === "string" ? event.detail : undefined
        })).filter((event) => event.label)
      : [];

    return {
      eventDetectedAt: typeof input.eventDetectedAt === "string" ? input.eventDetectedAt : new Date().toISOString(),
      sendStartedAt: typeof input.sendStartedAt === "string" ? input.sendStartedAt : new Date().toISOString(),
      firstRelayCalledAt: typeof input.firstRelayCalledAt === "string" ? input.firstRelayCalledAt : undefined,
      firstAckAt: typeof input.firstAckAt === "string" ? input.firstAckAt : undefined,
      finishedAt: typeof input.finishedAt === "string" ? input.finishedAt : undefined,
      detectionDelayMs: Number.isFinite(Number(input.detectionDelayMs)) ? Number(input.detectionDelayMs) : 0,
      firstRelayCallMs: Number.isFinite(Number(input.firstRelayCallMs)) ? Number(input.firstRelayCallMs) : undefined,
      firstAckMs: Number.isFinite(Number(input.firstAckMs)) ? Number(input.firstAckMs) : undefined,
      ackWaitMs: Number.isFinite(Number(input.ackWaitMs)) ? Number(input.ackWaitMs) : undefined,
      totalDurationMs: Number.isFinite(Number(input.totalDurationMs)) ? Number(input.totalDurationMs) : undefined,
      timeoutUsed: Boolean(input.timeoutUsed),
      retryUsed: Boolean(input.retryUsed),
      notAcceptableCount: Number.isFinite(Number(input.notAcceptableCount)) ? Number(input.notAcceptableCount) : 0,
      mode: input.mode === "race" ? "race" : "normal",
      events
    };
  }
}
