import crypto from "crypto";
import fs from "fs";
import path from "path";

const POLL_INTERVAL_MS = 75;
const LOCK_TIMEOUT_MS = 120_000;
const STALE_AFTER_MS = 120_000;
const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 8;

type LockRecord = { pid: number; token: string; createdAt: number };

export async function acquireGlobalOcrLock(env = process.env) {
  const dataDir = path.resolve(env.DATA_DIR || process.cwd());
  const concurrency = parseConcurrency(env.OCR_GLOBAL_CONCURRENCY);
  const token = crypto.randomUUID();
  const startedAt = Date.now();
  fs.mkdirSync(dataDir, { recursive: true });

  while (Date.now() - startedAt < LOCK_TIMEOUT_MS) {
    for (let slot = 0; slot < concurrency; slot += 1) {
      const lockPath = path.join(dataDir, `ocr-global-${slot}.lock`);
      const release = await tryAcquireSlot(lockPath, token);
      if (release) return release;
    }
    await delay(POLL_INTERVAL_MS);
  }

  throw new Error("A fila global da IA excedeu 120 segundos.");
}

function parseConcurrency(value?: string) {
  const parsed = Number.parseInt(String(value || DEFAULT_CONCURRENCY), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_CONCURRENCY;
  return Math.max(1, Math.min(MAX_CONCURRENCY, parsed));
}

async function tryAcquireSlot(lockPath: string, token: string): Promise<(() => Promise<void>) | undefined> {
  try {
    const handle = await fs.promises.open(lockPath, "wx");
    const record: LockRecord = { pid: process.pid, token, createdAt: Date.now() };
    try {
      await handle.writeFile(JSON.stringify(record), "utf8");
    } catch (error) {
      await handle.close().catch(() => undefined);
      await fs.promises.unlink(lockPath).catch(() => undefined);
      throw error;
    }

    let released = false;
    const heartbeat = setInterval(() => {
      const now = new Date();
      void fs.promises.utimes(lockPath, now, now).catch(() => undefined);
    }, 5_000);
    heartbeat.unref?.();

    return async () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      await handle.close().catch(() => undefined);
      await unlinkIfOwned(lockPath, token);
    };
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    if (await isAbandonedLock(lockPath)) {
      await fs.promises.unlink(lockPath).catch((unlinkError: any) => {
        if (unlinkError?.code !== "ENOENT") throw unlinkError;
      });
    }
    return undefined;
  }
}

async function unlinkIfOwned(lockPath: string, token: string) {
  try {
    const record = JSON.parse(await fs.promises.readFile(lockPath, "utf8")) as LockRecord;
    if (record.token === token) await fs.promises.unlink(lockPath);
  } catch (error: any) {
    if (error?.code !== "ENOENT") return;
  }
}

async function isAbandonedLock(lockPath: string) {
  try {
    const [contents, stat] = await Promise.all([
      fs.promises.readFile(lockPath, "utf8"),
      fs.promises.stat(lockPath)
    ]);
    if (Date.now() - stat.mtimeMs > STALE_AFTER_MS) return true;
    const record = JSON.parse(contents) as LockRecord;
    if (!Number.isInteger(record.pid) || !record.token) return true;
    try {
      process.kill(record.pid, 0);
      return false;
    } catch (error: any) {
      return error?.code === "ESRCH";
    }
  } catch (error: any) {
    return error?.code !== "ENOENT";
  }
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
