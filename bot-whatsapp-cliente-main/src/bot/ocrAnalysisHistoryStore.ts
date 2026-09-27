import fs from "fs";
import { writeJsonAtomicAsync } from "../storageJson";
import { OcrRouteSelectionState } from "../shared/types";

const MAX_ANALYSES = 30;

export class OcrAnalysisHistoryStore {
  private items: OcrRouteSelectionState[];
  private saveTimer?: NodeJS.Timeout;
  private saveChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    this.items = this.load();
  }

  all() {
    return this.items;
  }

  upsert(selection: OcrRouteSelectionState) {
    if (["idle", "analyzing"].includes(selection.status)) return;
    const key = selection.analysisId || selection.processedAt;
    if (!key) return;
    const snapshot = JSON.parse(JSON.stringify(selection)) as OcrRouteSelectionState;
    this.items = [snapshot, ...this.items.filter((item) => (item.analysisId || item.processedAt) !== key)].slice(0, MAX_ANALYSES);
    this.scheduleSave();
  }

  private load(): OcrRouteSelectionState[] {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item === "object" && Array.isArray(item.options) && !["idle", "analyzing"].includes(item.status)).slice(0, MAX_ANALYSES);
    } catch {
      return [];
    }
  }

  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const snapshot = JSON.parse(JSON.stringify(this.items)) as OcrRouteSelectionState[];
    this.saveChain = this.saveChain.catch(() => undefined).then(() => writeJsonAtomicAsync(this.filePath, snapshot));
    return this.saveChain;
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.flush().catch(() => console.error("Não foi possível persistir o histórico de análises."));
    }, 100);
    this.saveTimer.unref?.();
  }
}
