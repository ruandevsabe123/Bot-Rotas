import fs from "fs";
import path from "path";
import { BotConfig } from "../shared/types";

export const DEFAULT_CONFIG: BotConfig = {
  grupoAlvoJid: "",
  grupoAlvoNome: "",
  grupoTesteJid: "",
  grupoTesteNome: "",
  nomeEnvio: "",
  nuclearMode: false,
  codigosMensagensAlvo: [],
  codigosMensagensTeste: [],
  testMessageCount: 15,
  testMessageIntervalMs: 0,
  fastMode: true,
  minSendDelayMs: 0,
  alwaysWarmMode: true,
  keepAliveIntervalMs: 300000
};

export class ConfigStore {
  constructor(private readonly configPath = path.resolve(process.cwd(), "config.json")) {}

  get path() {
    return this.configPath;
  }

  load(): BotConfig {
    this.ensureConfigFile();

    try {
      const content = fs.readFileSync(this.configPath, "utf-8");
      return this.normalize(JSON.parse(content));
    } catch {
      const fallback = { ...DEFAULT_CONFIG };
      this.save(fallback);
      return fallback;
    }
  }

  save(config: Partial<BotConfig>): BotConfig {
    const nextConfig = this.normalize({
      ...this.loadWithoutCreating(),
      ...config
    });

    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
    fs.writeFileSync(this.configPath, JSON.stringify(nextConfig, null, 2));
    return nextConfig;
  }

  saveGroup(group: string): BotConfig {
    const value = group.trim();
    const looksLikeJid = value.includes("@g.us");

    return this.save({
      grupoAlvoJid: looksLikeJid ? value : "",
      grupoAlvoNome: looksLikeJid ? "Grupo salvo por ID" : value
    });
  }

  saveGroupById(groupId: string, groupName: string): BotConfig {
    return this.save({
      grupoAlvoJid: groupId.trim(),
      grupoAlvoNome: groupName.trim() || "Grupo salvo"
    });
  }

  saveTestGroup(group: string): BotConfig {
    const value = group.trim();
    const looksLikeJid = value.includes("@g.us");

    return this.save({
      grupoTesteJid: looksLikeJid ? value : "",
      grupoTesteNome: looksLikeJid ? "Grupo teste por ID" : value
    });
  }

  saveTestGroupById(groupId: string, groupName: string): BotConfig {
    return this.save({
      grupoTesteJid: groupId.trim(),
      grupoTesteNome: groupName.trim() || "Grupo teste"
    });
  }

  private ensureConfigFile() {
    if (!fs.existsSync(this.configPath)) {
      this.save(DEFAULT_CONFIG);
    }
  }

  private loadWithoutCreating(): BotConfig {
    if (!fs.existsSync(this.configPath)) {
      return { ...DEFAULT_CONFIG };
    }

    try {
      return this.normalize(JSON.parse(fs.readFileSync(this.configPath, "utf-8")));
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  private normalize(input: Partial<BotConfig>): BotConfig {
    return {
      grupoAlvoJid: typeof input.grupoAlvoJid === "string" ? input.grupoAlvoJid : "",
      grupoAlvoNome: typeof input.grupoAlvoNome === "string" ? input.grupoAlvoNome : "",
      grupoTesteJid: typeof input.grupoTesteJid === "string" ? input.grupoTesteJid : "",
      grupoTesteNome: typeof input.grupoTesteNome === "string" ? input.grupoTesteNome : "",
      nomeEnvio: typeof input.nomeEnvio === "string" ? input.nomeEnvio.trim() : DEFAULT_CONFIG.nomeEnvio,
      nuclearMode: typeof input.nuclearMode === "boolean" ? input.nuclearMode : DEFAULT_CONFIG.nuclearMode,
      testMessageCount: this.clampNumber(input.testMessageCount, 1, 200, DEFAULT_CONFIG.testMessageCount),
      testMessageIntervalMs: this.clampNumber(input.testMessageIntervalMs, 0, 10000, DEFAULT_CONFIG.testMessageIntervalMs),
      fastMode: typeof input.fastMode === "boolean" ? input.fastMode : DEFAULT_CONFIG.fastMode,
      minSendDelayMs: this.clampNumber(input.minSendDelayMs, 0, 5000, DEFAULT_CONFIG.minSendDelayMs),
      alwaysWarmMode: typeof input.alwaysWarmMode === "boolean" ? input.alwaysWarmMode : DEFAULT_CONFIG.alwaysWarmMode,
      keepAliveIntervalMs: this.clampNumber(input.keepAliveIntervalMs, 60000, 900000, DEFAULT_CONFIG.keepAliveIntervalMs),
      // support legacy `codigosMensagens` if present
      codigosMensagensAlvo: Array.isArray(input.codigosMensagensAlvo)
        ? input.codigosMensagensAlvo.filter((item) => typeof item === "string" && item.trim())
        : Array.isArray((input as any).codigosMensagens)
        ? (input as any).codigosMensagens.filter((item: any) => typeof item === "string" && item.trim())
        : [],
      codigosMensagensTeste: Array.isArray(input.codigosMensagensTeste)
        ? input.codigosMensagensTeste.filter((item) => typeof item === "string" && item.trim())
        : []
    };
  }

  private clampNumber(value: unknown, min: number, max: number, fallback: number) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(numberValue)));
  }
}
