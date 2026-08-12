import fs from "fs";
import path from "path";
import { LoginEvent, PanelUserRole } from "./shared/types";

export type StoredPanelUser = {
  email: string;
  password: string;
  role: PanelUserRole;
  blocked: boolean;
  color: string;
  dispatchPriorityLevel: number;
  dispatchBeatsEmail?: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string;
  lastSeenAt?: string;
  lastSeenReleaseId?: string;
  lastSeenReleaseAt?: string;
  totalUsageMs: number;
  loginHistory: LoginEvent[];
};

const MAX_LOGIN_HISTORY = 100;
const MAX_USAGE_GAP_MS = 1000 * 60 * 5;

export class PanelUserStore {
  constructor(private readonly filePath: string) {}

  all() {
    return this.load();
  }

  upsert(input: {
    email: string;
    password?: string;
    role?: PanelUserRole;
    blocked?: boolean;
    color?: string;
    dispatchPriorityLevel?: number;
    dispatchBeatsEmail?: string;
  }) {
    const email = input.email.trim().toLowerCase();
    if (!email) throw new Error("Email obrigatório.");

    const now = new Date().toISOString();
    const users = this.load();
    const existing = users.find((user) => user.email === email);
    if (existing) {
      if (input.password !== undefined && input.password.trim()) existing.password = input.password;
      if (input.role) existing.role = input.role;
      if (input.blocked !== undefined) existing.blocked = input.blocked;
      if (input.color !== undefined) existing.color = normalizeUserColor(input.color, existing.email);
      if (input.dispatchPriorityLevel !== undefined) existing.dispatchPriorityLevel = normalizeDispatchPriorityLevel(input.dispatchPriorityLevel);
      if (input.dispatchBeatsEmail !== undefined) existing.dispatchBeatsEmail = normalizeDispatchBeatsEmail(input.dispatchBeatsEmail, email);
      existing.updatedAt = now;
      this.save(users);
      return existing;
    }

    if (!input.password?.trim()) throw new Error("Senha obrigatória para novo usuário.");

    const user: StoredPanelUser = {
      email,
      password: input.password,
      role: input.role || "client",
      blocked: Boolean(input.blocked),
      color: normalizeUserColor(input.color, email),
      dispatchPriorityLevel: normalizeDispatchPriorityLevel(input.dispatchPriorityLevel),
      dispatchBeatsEmail: normalizeDispatchBeatsEmail(input.dispatchBeatsEmail, email),
      createdAt: now,
      updatedAt: now,
      totalUsageMs: 0,
      loginHistory: []
    };
    this.save([...users, user]);
    return user;
  }

  remove(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    this.save(this.load().filter((user) => user.email !== normalizedEmail));
  }

  recordLogin(email: string, ip: string, userAgent: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const now = new Date().toISOString();
    this.save(
      this.load().map((user) => {
        if (user.email !== normalizedEmail) return user;
        return {
          ...user,
          lastLoginAt: now,
          lastSeenAt: now,
          loginHistory: [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
              timestamp: now,
              ip,
              userAgent
            },
            ...user.loginHistory
          ].slice(0, MAX_LOGIN_HISTORY),
          updatedAt: now
        };
      })
    );
  }

  touch(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    this.save(
      this.load().map((user) => {
        if (user.email !== normalizedEmail) return user;
        const lastSeenMs = user.lastSeenAt ? new Date(user.lastSeenAt).getTime() : 0;
        const delta = lastSeenMs && nowMs - lastSeenMs <= MAX_USAGE_GAP_MS ? nowMs - lastSeenMs : 0;
        return {
          ...user,
          lastSeenAt: now,
          totalUsageMs: user.totalUsageMs + delta
        };
      })
    );
  }

  acknowledgeRelease(email: string, releaseId: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedReleaseId = releaseId.trim();
    if (!normalizedEmail || !normalizedReleaseId) return undefined;

    const now = new Date().toISOString();
    let updatedUser: StoredPanelUser | undefined;
    const users = this.load().map((user) => {
      if (user.email !== normalizedEmail) return user;
      updatedUser = {
        ...user,
        lastSeenReleaseId: normalizedReleaseId,
        lastSeenReleaseAt: now,
        updatedAt: now
      };
      return updatedUser;
    });
    if (updatedUser) this.save(users);
    return updatedUser;
  }

  private load(): StoredPanelUser[] {
    if (!fs.existsSync(this.filePath)) return [];

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return Array.isArray(data) ? data.map((item) => this.normalize(item)).filter(Boolean) as StoredPanelUser[] : [];
    } catch {
      return [];
    }
  }

  private save(users: StoredPanelUser[]) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(users, null, 2));
  }

  private normalize(input: any): StoredPanelUser | undefined {
    if (!input || typeof input.email !== "string" || typeof input.password !== "string") return undefined;
    const now = new Date().toISOString();
    return {
      email: input.email.trim().toLowerCase(),
      password: input.password,
      role: input.role === "admin" ? "admin" : "client",
      blocked: Boolean(input.blocked),
      color: normalizeUserColor(input.color, input.email),
      dispatchPriorityLevel: normalizeDispatchPriorityLevel(input.dispatchPriorityLevel),
      dispatchBeatsEmail: normalizeDispatchBeatsEmail(input.dispatchBeatsEmail, input.email),
      createdAt: typeof input.createdAt === "string" ? input.createdAt : now,
      updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now,
      lastLoginAt: typeof input.lastLoginAt === "string" ? input.lastLoginAt : undefined,
      lastSeenAt: typeof input.lastSeenAt === "string" ? input.lastSeenAt : undefined,
      lastSeenReleaseId: typeof input.lastSeenReleaseId === "string" ? input.lastSeenReleaseId : undefined,
      lastSeenReleaseAt: typeof input.lastSeenReleaseAt === "string" ? input.lastSeenReleaseAt : undefined,
      totalUsageMs: Number(input.totalUsageMs || 0),
      loginHistory: Array.isArray(input.loginHistory)
        ? input.loginHistory.map((event: any) => ({
            id: typeof event.id === "string" ? event.id : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            timestamp: typeof event.timestamp === "string" ? event.timestamp : now,
            ip: typeof event.ip === "string" ? event.ip : "",
            userAgent: typeof event.userAgent === "string" ? event.userAgent : ""
          })).slice(0, MAX_LOGIN_HISTORY)
        : []
    };
  }
}

const USER_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#f97316", "#ec4899"];

export function defaultUserColor(email: string) {
  const normalized = String(email || "").toLowerCase();
  const hash = normalized.split("").reduce((total, char) => total + char.charCodeAt(0), 0);
  return USER_COLORS[hash % USER_COLORS.length];
}

export function normalizeUserColor(value: string | undefined, email: string) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : defaultUserColor(email);
}

export function normalizeDispatchPriorityLevel(value: unknown) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return 0;
  return Math.min(5, Math.max(0, Math.floor(numberValue)));
}

export function normalizeDispatchBeatsEmail(value: unknown, ownEmail = "") {
  const email = String(value || "").trim().toLowerCase();
  return email && email !== String(ownEmail || "").trim().toLowerCase() ? email : undefined;
}
