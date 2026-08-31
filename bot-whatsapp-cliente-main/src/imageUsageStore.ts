import fs from "fs";
import path from "path";
import { AdminImageUsageSnapshot, ClientImageUsageSnapshot, ImageAnalysisResult, ImageUsageDecision, ImageUsageEntry } from "./shared/types";

type StoredImageUsage = {
  entries: ImageUsageEntry[];
  defaultAmounts: Record<string, number>;
  monthlyTotalOverrides: Record<string, number>;
};

type RecordAnalysisInput = {
  id: string;
  clientEmail: string;
  messageId: string;
  result: ImageAnalysisResult;
  route?: string;
  bairro?: string;
  gaiola?: string;
  confidence?: number;
  groupJid?: string;
  groupName?: string;
  analysisStartedAt?: string;
  analysisFinishedAt?: string;
  analysisDurationMs?: number;
};

type ValidatedRouteUsageInput = Omit<RecordAnalysisInput, "id"> & {
  analysisId?: string;
  routeDispatchId: string;
};

const MAX_ENTRIES = 50_000;

export class ImageUsageStore {
  private data: StoredImageUsage;

  constructor(private readonly filePath: string) {
    this.data = this.load();
  }

  record(input: RecordAnalysisInput) {
    const normalizedEmail = input.clientEmail.trim().toLowerCase();
    const existing = this.data.entries.find((entry) => entry.id === input.id);
    if (existing) return existing;
    const now = new Date().toISOString();
    const entry: ImageUsageEntry = {
      ...input,
      clientEmail: normalizedEmail,
      decision: "pending",
      amountCents: this.defaultAmount(normalizedEmail),
      createdAt: now,
      updatedAt: now
    };
    this.data.entries = [entry, ...this.data.entries].slice(0, MAX_ENTRIES);
    this.save();
    return entry;
  }

  get(id: string) {
    return this.data.entries.find((entry) => entry.id === id);
  }

  decide(id: string, decision: ImageUsageDecision, adminEmail: string, amountCents?: number, note?: string) {
    let changed = false;
    const now = new Date().toISOString();
    this.data.entries = this.data.entries.map((entry) => {
      if (entry.id !== id) return entry;
      changed = true;
      return {
        ...entry,
        decision,
        amountCents: amountCents === undefined ? entry.amountCents : this.normalizeAmount(amountCents),
        note: note?.trim() || undefined,
        reviewedAt: now,
        reviewedBy: adminEmail,
        updatedAt: now
      };
    });
    if (changed) this.save();
    return changed;
  }

  decideForRoute(analysisId: string | undefined, routeDispatchId: string, decision: Exclude<ImageUsageDecision, "pending">, adminEmail: string) {
    if (!analysisId) return false;
    let changed = false;
    const now = new Date().toISOString();
    this.data.entries = this.data.entries.map((entry) => {
      if (entry.id !== analysisId) return entry;
      if (entry.decision === decision && entry.routeDispatchId === routeDispatchId) return entry;
      changed = true;
      return {
        ...entry,
        routeDispatchId,
        decision,
        amountCents: decision === "billable" && entry.amountCents <= 0 ? this.defaultAmount(entry.clientEmail) : entry.amountCents,
        reviewedAt: now,
        reviewedBy: adminEmail,
        updatedAt: now
      };
    });
    if (changed) this.save();
    return changed;
  }

  decideValidatedRoute(input: ValidatedRouteUsageInput, reviewedBy: string) {
    const normalizedEmail = input.clientEmail.trim().toLowerCase();
    const exact = this.data.entries.find((entry) =>
      (input.analysisId && entry.id === input.analysisId) || entry.routeDispatchId === input.routeDispatchId
    );
    const legacy = exact || (!input.analysisId ? this.findLegacyAnalysisForRoute(input, normalizedEmail) : undefined);
    const entry = legacy || this.record({
      ...input,
      id: input.analysisId || `validated-route:${normalizedEmail}:${input.routeDispatchId}`,
      clientEmail: normalizedEmail
    });
    return this.decideForRoute(entry.id, input.routeDispatchId, "billable", reviewedBy);
  }

  setDefaultAmount(clientEmail: string, amountCents: number) {
    const email = clientEmail.trim().toLowerCase();
    this.data.defaultAmounts[email] = this.normalizeAmount(amountCents);
    this.save();
  }

  setMonthlyTotal(clientEmail: string, amountCents: number, month = this.currentMonth()) {
    const email = clientEmail.trim().toLowerCase();
    this.data.monthlyTotalOverrides[this.monthlyTotalKey(email, month)] = this.normalizeAmount(amountCents);
    this.save();
  }

  snapshot(month = this.currentMonth()): AdminImageUsageSnapshot {
    const entries = this.data.entries.filter((entry) => entry.createdAt.slice(0, 7) === month);
    const emails = new Set([...Object.keys(this.data.defaultAmounts), ...entries.map((entry) => entry.clientEmail)]);
    const clients = Array.from(emails).map((email) => this.summary(email, month, entries)).sort((a, b) => b.amountCents - a.amountCents || a.clientEmail.localeCompare(b.clientEmail));
    return {
      month,
      entries,
      clients,
      totals: {
        total: entries.length,
        pending: entries.filter((entry) => entry.decision === "pending").length,
        billable: entries.filter((entry) => entry.decision === "billable").length,
        excluded: entries.filter((entry) => entry.decision === "excluded").length,
        detected: entries.filter((entry) => entry.result === "detected").length,
        amountCents: clients.reduce((total, client) => total + client.amountCents, 0)
      }
    };
  }

  clientSnapshot(clientEmail: string, month = this.currentMonth()): ClientImageUsageSnapshot {
    const email = clientEmail.trim().toLowerCase();
    const entries = this.data.entries.filter((entry) => entry.clientEmail === email && entry.createdAt.slice(0, 7) === month);
    return {
      month,
      amountCents: this.summary(email, month, entries).amountCents
    };
  }

  private summary(clientEmail: string, month: string, entries: ImageUsageEntry[]) {
    const clientEntries = entries.filter((entry) => entry.clientEmail === clientEmail);
    const calculatedAmountCents = clientEntries.filter((entry) => entry.decision === "billable").reduce((total, entry) => total + entry.amountCents, 0);
    const manualTotalAmountCents = this.data.monthlyTotalOverrides[this.monthlyTotalKey(clientEmail, month)];
    return {
      clientEmail,
      month,
      total: clientEntries.length,
      pending: clientEntries.filter((entry) => entry.decision === "pending").length,
      billable: clientEntries.filter((entry) => entry.decision === "billable").length,
      excluded: clientEntries.filter((entry) => entry.decision === "excluded").length,
      detected: clientEntries.filter((entry) => entry.result === "detected").length,
      amountCents: manualTotalAmountCents === undefined ? calculatedAmountCents : manualTotalAmountCents,
      defaultAmountCents: this.defaultAmount(clientEmail),
      manualTotalAmountCents
    };
  }

  private findLegacyAnalysisForRoute(input: ValidatedRouteUsageInput, clientEmail: string) {
    const targetTime = Date.parse(input.analysisFinishedAt || input.analysisStartedAt || "");
    const targetGaiola = String(input.gaiola || "").trim().toLowerCase();
    const targetRoute = String(input.route || "").trim().toLowerCase();
    return this.data.entries
      .filter((entry) => entry.clientEmail === clientEmail && entry.result === "detected" && !entry.routeDispatchId)
      .map((entry) => {
        const entryTime = Date.parse(entry.analysisFinishedAt || entry.analysisStartedAt || entry.createdAt);
        const distanceMs = Number.isFinite(targetTime) && Number.isFinite(entryTime) ? Math.abs(entryTime - targetTime) : Number.MAX_SAFE_INTEGER;
        const sameGaiola = Boolean(targetGaiola && String(entry.gaiola || "").trim().toLowerCase() === targetGaiola);
        const sameRoute = Boolean(targetRoute && String(entry.route || "").trim().toLowerCase() === targetRoute);
        return { entry, distanceMs, sameIdentity: sameGaiola || sameRoute };
      })
      .filter((candidate) => candidate.sameIdentity || candidate.distanceMs <= 2 * 60 * 60_000)
      .sort((left, right) => Number(right.sameIdentity) - Number(left.sameIdentity) || left.distanceMs - right.distanceMs)[0]?.entry;
  }

  private defaultAmount(clientEmail: string) {
    return this.normalizeAmount(this.data.defaultAmounts[clientEmail] ?? 70);
  }

  private monthlyTotalKey(clientEmail: string, month: string) {
    return `${month}:${clientEmail}`;
  }

  private normalizeAmount(value: number) {
    return Math.max(0, Math.min(10_000_000, Math.round(Number(value) || 0)));
  }

  private currentMonth() {
    return new Date().toISOString().slice(0, 7);
  }

  private load(): StoredImageUsage {
    const backupPath = `${this.filePath}.bak`;
    for (const candidate of [this.filePath, backupPath]) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf-8"));
        if (parsed && Array.isArray(parsed.entries) && parsed.defaultAmounts && typeof parsed.defaultAmounts === "object") {
          return {
            entries: parsed.entries,
            defaultAmounts: parsed.defaultAmounts,
            monthlyTotalOverrides: parsed.monthlyTotalOverrides && typeof parsed.monthlyTotalOverrides === "object" ? parsed.monthlyTotalOverrides : {}
          };
        }
      } catch {
        // Tenta o backup antes de iniciar um registro vazio.
      }
    }
    return { entries: [], defaultAmounts: {}, monthlyTotalOverrides: {} };
  }

  private save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2));
    if (this.hasValidData(this.filePath)) fs.copyFileSync(this.filePath, `${this.filePath}.bak`);
    fs.renameSync(tempPath, this.filePath);
  }

  private hasValidData(filePath: string) {
    if (!fs.existsSync(filePath)) return false;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return Boolean(parsed && Array.isArray(parsed.entries));
    } catch {
      return false;
    }
  }
}
