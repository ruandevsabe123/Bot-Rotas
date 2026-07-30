import fs from "fs";
import path from "path";
import { BotLog, LogLevel } from "../shared/types";

export class BotLogger {
  private logs: BotLog[] = [];
  private flushTimer?: NodeJS.Timeout;
  private saveInFlight?: Promise<void>;
  private dirty = false;

  constructor(private readonly onChange?: () => void, private readonly filePath?: string) {
    this.logs = this.load();
  }

  all() {
    return this.logs;
  }

  clear() {
    this.logs = [];
    this.scheduleSave(0);
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

    this.scheduleSave();
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

  flush() {
    if (!this.filePath) return;
    if (this.saveInFlight) {
      this.dirty = true;
      return;
    }
    this.dirty = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.logs, null, 2));
  }

  private scheduleSave(delayMs = 250) {
    if (!this.filePath) return;
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      if (!this.dirty) return;
      this.saveInBackground();
    }, delayMs);
  }

  private saveInBackground() {
    if (!this.filePath || this.saveInFlight) return;
    this.dirty = false;
    const payload = JSON.stringify(this.logs, null, 2);
    const directory = path.dirname(this.filePath);

    this.saveInFlight = fs.promises.mkdir(directory, { recursive: true })
      .then(() => fs.promises.writeFile(this.filePath!, payload))
      .catch(() => {
        this.dirty = true;
      })
      .finally(() => {
        this.saveInFlight = undefined;
        if (this.dirty) this.scheduleSave();
      });
  }
}
