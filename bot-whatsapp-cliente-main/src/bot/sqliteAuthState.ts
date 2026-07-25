import fs from "fs";
import path from "path";

type BaileysAuthHelpers = {
  BufferJSON: {
    replacer: (key: string, value: unknown) => unknown;
    reviver: (key: string, value: unknown) => unknown;
  };
  proto: any;
  useMultiFileAuthState: (folder: string) => Promise<any>;
};

type PendingKeyMirror = Record<string, Record<string, unknown>>;

export type SqliteAuthStateResult = {
  state: any;
  saveCreds: () => Promise<void>;
  flush: () => Promise<void>;
  close: () => Promise<void>;
  destroy: () => void;
  backend: "sqlite";
  migratedFiles: number;
};

const SQLITE_FILE = "auth.sqlite";
const LEGACY_MIRROR_DELAY_MS = 2_000;

export async function useSqliteAuthState(
  folder: string,
  helpers: BaileysAuthHelpers
): Promise<SqliteAuthStateResult> {
  fs.mkdirSync(folder, { recursive: true });
  const legacy = await helpers.useMultiFileAuthState(folder);
  const BetterSqlite3 = require("better-sqlite3") as any;
  const databasePath = path.join(folder, SQLITE_FILE);
  const database = new BetterSqlite3(databasePath);

  database.pragma("journal_mode = WAL");
  database.pragma("synchronous = NORMAL");
  database.pragma("temp_store = MEMORY");
  database.pragma("busy_timeout = 5000");
  database.pragma("cache_size = -8192");
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_creds (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_keys (
      key_id TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  const readCreds = database.prepare("SELECT value FROM auth_creds WHERE id = 1");
  const writeCreds = database.prepare(`
    INSERT INTO auth_creds (id, value, updated_at)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const readKey = database.prepare("SELECT value FROM auth_keys WHERE key_id = ?");
  const writeKey = database.prepare(`
    INSERT INTO auth_keys (key_id, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const deleteKey = database.prepare("DELETE FROM auth_keys WHERE key_id = ?");
  const writeMeta = database.prepare(`
    INSERT INTO auth_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `);

  const stringify = (value: unknown) => JSON.stringify(value, helpers.BufferJSON.replacer);
  const parse = (value: string) => JSON.parse(value, helpers.BufferJSON.reviver);
  let migratedFiles = 0;

  const migrateLegacy = database.transaction(() => {
    const existing = readCreds.get();
    if (existing?.value) return;

    writeCreds.run(stringify(legacy.state.creds), Date.now());
    for (const fileName of fs.readdirSync(folder)) {
      if (!fileName.endsWith(".json") || fileName === "creds.json") continue;
      const filePath = path.join(folder, fileName);
      try {
        const raw = fs.readFileSync(filePath, "utf8");
        parse(raw);
        writeKey.run(fileName.slice(0, -5), raw, Date.now());
        migratedFiles += 1;
      } catch {
        // Arquivo legado inválido fica preservado, mas não entra no banco ativo.
      }
    }
    writeMeta.run("legacy_migrated_at", new Date().toISOString());
    writeMeta.run("legacy_migrated_files", String(migratedFiles));
  });
  let creds: any;
  try {
    migrateLegacy();
    const credsRow = readCreds.get();
    if (!credsRow?.value) throw new Error("SQLite auth não conseguiu inicializar credenciais.");
    creds = parse(credsRow.value);
  } catch (error) {
    database.close();
    throw error;
  }

  let pendingKeyMirror: PendingKeyMirror = {};
  let pendingCredsMirror = false;
  let mirrorTimer: NodeJS.Timeout | undefined;
  let mirrorInFlight: Promise<void> | undefined;
  let closed = false;

  const flushLegacyMirror = async () => {
    if (mirrorTimer) {
      clearTimeout(mirrorTimer);
      mirrorTimer = undefined;
    }
    if (mirrorInFlight) {
      await mirrorInFlight;
      if (Object.keys(pendingKeyMirror).length || pendingCredsMirror) {
        await flushLegacyMirror();
      }
      return;
    }

    const keyBatch = pendingKeyMirror;
    const mirrorCreds = pendingCredsMirror;
    pendingKeyMirror = {};
    pendingCredsMirror = false;
    if (!Object.keys(keyBatch).length && !mirrorCreds) return;

    mirrorInFlight = (async () => {
      try {
        if (Object.keys(keyBatch).length) await legacy.state.keys.set(keyBatch);
        if (mirrorCreds) {
          Object.assign(legacy.state.creds, creds);
          await legacy.saveCreds();
        }
      } catch (error) {
        for (const [category, entries] of Object.entries(keyBatch)) {
          pendingKeyMirror[category] = {
            ...(entries || {}),
            ...(pendingKeyMirror[category] || {})
          };
        }
        pendingCredsMirror ||= mirrorCreds;
        throw error;
      }
    })().finally(() => {
      mirrorInFlight = undefined;
    });
    await mirrorInFlight;
  };

  const scheduleLegacyMirror = () => {
    if (closed || mirrorTimer) return;
    mirrorTimer = setTimeout(() => {
      mirrorTimer = undefined;
      void flushLegacyMirror().catch(() => undefined);
    }, LEGACY_MIRROR_DELAY_MS);
    mirrorTimer.unref?.();
  };

  const mergeMirrorBatch = (data: PendingKeyMirror) => {
    for (const [category, entries] of Object.entries(data || {})) {
      pendingKeyMirror[category] = {
        ...(pendingKeyMirror[category] || {}),
        ...(entries || {})
      };
    }
    scheduleLegacyMirror();
  };

  const writeKeyBatch = database.transaction((data: PendingKeyMirror) => {
    const now = Date.now();
    for (const [category, entries] of Object.entries(data || {})) {
      for (const [id, value] of Object.entries(entries || {})) {
        const keyId = storageKey(category, id);
        if (value === null || value === undefined) {
          deleteKey.run(keyId);
        } else {
          writeKey.run(keyId, stringify(value), now);
        }
      }
    }
  });

  const state = {
    creds,
    keys: {
      get: async (type: string, ids: string[]) => {
        const result: Record<string, unknown> = {};
        for (const id of ids) {
          const row = readKey.get(storageKey(type, id));
          let value = row?.value ? parse(row.value) : undefined;
          if (type === "app-state-sync-key" && value) {
            value = helpers.proto.Message.AppStateSyncKeyData.fromObject(value);
          }
          result[id] = value;
        }
        return result;
      },
      set: async (data: PendingKeyMirror) => {
        if (closed) throw new Error("SQLite auth já foi fechado.");
        writeKeyBatch(data);
        mergeMirrorBatch(data);
      }
    }
  };

  const saveCreds = async () => {
    if (closed) throw new Error("SQLite auth já foi fechado.");
    writeCreds.run(stringify(creds), Date.now());
    pendingCredsMirror = true;
    scheduleLegacyMirror();
  };

  const close = async () => {
    if (closed) return;
    await flushLegacyMirror().catch(() => undefined);
    closed = true;
    database.close();
  };

  const destroy = () => {
    if (mirrorTimer) clearTimeout(mirrorTimer);
    mirrorTimer = undefined;
    pendingKeyMirror = {};
    pendingCredsMirror = false;
    closed = true;
    try {
      database.close();
    } catch {
      // Banco já estava fechado.
    }
  };

  return {
    state,
    saveCreds,
    flush: flushLegacyMirror,
    close,
    destroy,
    backend: "sqlite",
    migratedFiles
  };
}

function storageKey(type: string, id: string) {
  return `${type}-${String(id || "").replace(/\//g, "__").replace(/:/g, "-")}`;
}
