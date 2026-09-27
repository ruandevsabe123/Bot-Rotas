import http from "http";

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function readRawBody(request: http.IncomingMessage, maxBytes = 12 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) { chunks = []; reject(error); } else resolve(Buffer.concat(chunks, total));
    };
    const timer = setTimeout(() => finish(new HttpError(408, "Tempo para receber os dados esgotado.")), 30_000);
    timer.unref();
    request.on("data", (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) return finish(new HttpError(413, "Arquivo ou dados muito grandes."));
      chunks.push(chunk);
    });
    request.once("end", () => finish());
    request.once("error", (error) => finish(error));
    request.once("aborted", () => finish(new HttpError(400, "Envio interrompido.")));
    const length = Number(request.headers["content-length"]);
    if (Number.isFinite(length) && length > maxBytes) finish(new HttpError(413, "Arquivo ou dados muito grandes."));
  });
}

export async function readJsonBody<T = Record<string, unknown>>(request: http.IncomingMessage): Promise<T> {
  const buffer = await readRawBody(request, 1024 * 1024);
  try {
    const data: unknown = buffer.toString("utf8").trim() ? JSON.parse(buffer.toString("utf8")) : {};
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("object required");
    return data as T;
  } catch {
    throw new HttpError(400, "Envie um objeto JSON válido.");
  }
}

export class RequestRateLimiter {
  private readonly entries = new Map<string, { count: number; expires: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    for (const [entryKey, entry] of this.entries) if (entry.expires <= now) this.entries.delete(entryKey);
    const current = this.entries.get(key);
    if (current) return ++current.count <= this.limit;
    if (this.entries.size >= 10_000) return false;
    this.entries.set(key, { count: 1, expires: now + this.windowMs });
    return true;
  }
}

export function validateEmail(value: unknown): string {
  if (typeof value !== "string" || value.length > 254 || !/^[^\s@/\\:]+@[^\s@/\\:]+\.[^\s@/\\:]+$/.test(value.trim())) {
    throw new HttpError(400, "Informe um email válido.");
  }
  return value.trim().toLowerCase();
}

export function validateAmount(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 10_000_000) {
    throw new HttpError(400, "Informe um valor em centavos entre 0 e 10000000.");
  }
  return value;
}
