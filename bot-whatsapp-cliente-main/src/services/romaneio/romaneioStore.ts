import fs from "fs";
import path from "path";
import { RomaneioDetectedInfo, RomaneioRouteSummary, RomaneioSettings, RomaneioSnapshot, RomaneioStatus } from "../../shared/types";
import { parseRomaneioXlsx } from "./parseRomaneio";
import { DEFAULT_ROMANEIO_SETTINGS, rankRoutes } from "./rankRoutes";
import { formatOutOfFilterMessage, formatRouteOptionsMessage } from "./formatRomaneioMessage";

type ProcessedRomaneio = RomaneioStatus & {
  routes: RomaneioRouteSummary[];
};

export class RomaneioStore {
  private latestPath: string;
  private processedPath: string;
  private settingsPath: string;
  private cachedProcessed?: ProcessedRomaneio;
  private cachedProcessedSignature = "";

  constructor(private dir: string) {
    this.latestPath = path.join(dir, "latest.xlsx");
    this.processedPath = path.join(dir, "processed.json");
    this.settingsPath = path.join(dir, "settings.json");
  }

  all(): RomaneioSnapshot {
    const processed = this.loadProcessed();
    return {
      status: processed ? toStatus(processed) : emptyStatus(),
      settings: this.getSettings(),
      routes: processed?.routes || []
    };
  }

  status() {
    return this.all().status;
  }

  routes() {
    return this.all().routes;
  }

  getSettings(): RomaneioSettings {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.settingsPath, "utf-8"));
      return sanitizeSettings(parsed);
    } catch {
      return { ...DEFAULT_ROMANEIO_SETTINGS };
    }
  }

  saveSettings(input: Partial<RomaneioSettings>) {
    const settings = sanitizeSettings({ ...this.getSettings(), ...input });
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2));
    return settings;
  }

  saveUpload(fileName: string, buffer: Buffer) {
    fs.mkdirSync(this.dir, { recursive: true });
    writeFileAtomic(this.latestPath, buffer);

    try {
      const parsed = parseRomaneioXlsx(this.latestPath);
      const processed: ProcessedRomaneio = {
        loaded: true,
        uploadedAt: new Date().toISOString(),
        fileName,
        sheetName: parsed.sheetName,
        totalRows: parsed.rowCount,
        totalRoutes: parsed.routes.length,
        totalPackages: parsed.routes.reduce((total, route) => total + route.pacotes, 0),
        columns: parsed.columns,
        headerRow: parsed.headerRow,
        columnMapping: parsed.columnMapping,
        warnings: parsed.warnings,
        routes: parsed.routes
      };
      writeFileAtomic(this.processedPath, JSON.stringify(processed, null, 2));
      this.cachedProcessed = processed;
      this.cachedProcessedSignature = fileSignature(this.processedPath);
      return this.all();
    } catch (error) {
      const failed: ProcessedRomaneio = {
        loaded: false,
        uploadedAt: new Date().toISOString(),
        fileName,
        totalRows: 0,
        totalRoutes: 0,
        totalPackages: 0,
        columns: [],
        error: error instanceof Error ? error.message : String(error),
        routes: []
      };
      writeFileAtomic(this.processedPath, JSON.stringify(failed, null, 2));
      this.cachedProcessed = failed;
      this.cachedProcessedSignature = fileSignature(this.processedPath);
      throw error;
    }
  }

  clear() {
    fs.rmSync(this.latestPath, { force: true });
    fs.rmSync(this.processedPath, { force: true });
    this.cachedProcessed = undefined;
    this.cachedProcessedSignature = "";
    return this.all();
  }

  searchByNeighborhood(bairro: string) {
    const snapshot = this.all();
    return rankRoutes(snapshot.routes, { bairro }, snapshot.settings);
  }

  rankForDetected(detectedInfo: RomaneioDetectedInfo) {
    const snapshot = this.all();
    if (!snapshot.status.loaded || !snapshot.routes.length) return [];
    return rankRoutes(snapshot.routes, detectedInfo, snapshot.settings);
  }

  buildMessageForDetected(detectedInfo: RomaneioDetectedInfo) {
    const snapshot = this.all();
    if (!snapshot.status.loaded || !snapshot.routes.length) return undefined;
    const ranked = rankRoutes(snapshot.routes, detectedInfo, snapshot.settings);
    if (!ranked.length) return undefined;
    const first = ranked[0];
    if (!first.passedFilters && (detectedInfo.gaiola || detectedInfo.rota)) {
      const fallbackDetected = detectedInfo.bairro ? { bairro: detectedInfo.bairro } : {};
      const fallbackRanked = rankRoutes(snapshot.routes, fallbackDetected, snapshot.settings)
        .filter((route) => route.rota !== first.rota || route.gaiola !== first.gaiola);
      const suggestions = fallbackRanked.filter((route) => route.passedFilters);
      return formatOutOfFilterMessage(first, suggestions.length ? suggestions : fallbackRanked.slice(0, 3));
    }
    return formatRouteOptionsMessage(ranked, detectedInfo);
  }

  private loadProcessed(): ProcessedRomaneio | undefined {
    const signature = fileSignature(this.processedPath);
    if (this.cachedProcessed && signature && signature === this.cachedProcessedSignature) return this.cachedProcessed;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.processedPath, "utf-8"));
      const processed = {
        ...emptyStatus(),
        ...parsed,
        routes: Array.isArray(parsed.routes) ? parsed.routes : []
      };
      this.cachedProcessed = processed;
      this.cachedProcessedSignature = signature;
      return processed;
    } catch {
      if (this.cachedProcessed) return this.cachedProcessed;
      return this.recoverFromLatestUpload();
    }
  }

  private recoverFromLatestUpload(): ProcessedRomaneio | undefined {
    if (!fs.existsSync(this.latestPath)) return undefined;
    try {
      const parsed = parseRomaneioXlsx(this.latestPath);
      const stat = fs.statSync(this.latestPath);
      const recovered: ProcessedRomaneio = {
        loaded: true,
        uploadedAt: stat.mtime.toISOString(),
        fileName: "latest.xlsx",
        sheetName: parsed.sheetName,
        totalRows: parsed.rowCount,
        totalRoutes: parsed.routes.length,
        totalPackages: parsed.routes.reduce((total, route) => total + route.pacotes, 0),
        columns: parsed.columns,
        headerRow: parsed.headerRow,
        columnMapping: parsed.columnMapping,
        warnings: parsed.warnings,
        routes: parsed.routes
      };
      fs.mkdirSync(this.dir, { recursive: true });
      writeFileAtomic(this.processedPath, JSON.stringify(recovered, null, 2));
      this.cachedProcessed = recovered;
      this.cachedProcessedSignature = fileSignature(this.processedPath);
      return recovered;
    } catch {
      return undefined;
    }
  }
}

function fileSignature(filePath: string) {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "";
  }
}

function writeFileAtomic(filePath: string, contents: string | Buffer) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporaryPath, contents);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
}

function emptyStatus(): RomaneioStatus {
  return {
    loaded: false,
    totalRows: 0,
    totalRoutes: 0,
    totalPackages: 0,
    columns: []
  };
}

function toStatus(processed: ProcessedRomaneio): RomaneioStatus {
  const { routes: _routes, ...status } = processed;
  return status;
}

function sanitizeSettings(input: Partial<RomaneioSettings>): RomaneioSettings {
  const priorities = new Set<RomaneioSettings["prioridade"]>([
    "menor_distancia",
    "menos_paradas",
    "menos_pacotes",
    "maior_concentracao_bairro",
    "equilibrio_geral"
  ]);
  return {
    distanciaMaxKm: positiveNumber(input.distanciaMaxKm),
    paradasMax: positiveNumber(input.paradasMax),
    pacotesMax: positiveNumber(input.pacotesMax),
    prioridade: priorities.has(input.prioridade as RomaneioSettings["prioridade"]) ? input.prioridade as RomaneioSettings["prioridade"] : "equilibrio_geral"
  };
}

function positiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
