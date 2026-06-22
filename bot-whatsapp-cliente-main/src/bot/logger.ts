import fs from "fs";
import path from "path";
import { BotLog, LogLevel } from "../shared/types";

export class BotLogger {
  private logs: BotLog[] = [];

  constructor(private readonly onChange?: () => void, private readonly filePath?: string) {
    this.logs = this.load();
  }

  all() {
    return this.logs;
  }

  clear() {
    this.logs = [];
    this.save();
    this.onChange?.();
  }

  add(level: LogLevel, message: string) {
    this.logs = [
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        timestamp: new Date().toISOString(),
        level,
        message
      },
      ...this.logs
    ].slice(0, 250);

    this.save();
    this.onChange?.();
  }

  info(message: string) {
    this.add("info", message);
  }

  success(message: string) {
    this.add("success", message);
  }

  warning(message: string) {
    this.add("warning", message);
  }

  error(message: string) {
    this.add("error", message);
  }

  private load() {
    if (!this.filePath || !fs.existsSync(this.filePath)) return [];

    try {
      const data = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));
      return Array.isArray(data)
        ? data
            .map((item: any) => ({
              id: typeof item.id === "string" ? item.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              timestamp: typeof item.timestamp === "string" ? item.timestamp : new Date().toISOString(),
              level: ["info", "success", "warning", "error"].includes(item.level) ? item.level : "info",
              message: typeof item.message === "string" ? item.message : ""
            }))
            .filter((item: BotLog) => item.message)
            .slice(0, 250)
        : [];
    } catch {
      return [];
    }
  }

  private save() {
    if (!this.filePath) return;
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.logs, null, 2));
  }
}
