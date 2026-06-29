import fs from "fs";
import path from "path";
import { LeaderContact } from "./shared/types";

export class LeaderStore {
  constructor(private readonly filePath: string, private readonly defaults: LeaderContact[] = []) {}

  all() {
    const stored = this.load();
    if (stored.length) return stored;
    this.save(this.normalizeMany(this.defaults));
    return this.load();
  }

  upsert(input: LeaderContact) {
    const leader = this.normalize(input);
    if (!leader) throw new Error("Informe nome e telefone do líder.");
    const leaders = this.load();
    const next = [
      leader,
      ...leaders.filter((item) => item.phone !== leader.phone)
    ];
    this.save(next);
    return leader;
  }

  remove(phone: string) {
    const normalizedPhone = normalizePhone(phone);
    this.save(this.load().filter((leader) => leader.phone !== normalizedPhone));
  }

  private load() {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return Array.isArray(data) ? this.normalizeMany(data) : [];
    } catch {
      return [];
    }
  }

  private save(leaders: LeaderContact[]) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(leaders, null, 2));
  }

  private normalizeMany(input: unknown[]) {
    const seen = new Set<string>();
    return input
      .map((item) => this.normalize(item))
      .filter((item): item is LeaderContact => Boolean(item))
      .filter((item) => {
        if (seen.has(item.phone)) return false;
        seen.add(item.phone);
        return true;
      });
  }

  private normalize(input: unknown): LeaderContact | undefined {
    const record = input as Partial<LeaderContact>;
    const name = String(record?.name || "").trim();
    const phone = normalizePhone(String(record?.phone || ""));
    if (!name || !phone) return undefined;
    return { name, phone };
  }
}

export function normalizePhone(value: string) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}
