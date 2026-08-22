import { ChildProcess, fork } from "child_process";
import os from "os";
import path from "path";
import { readRouteImageOcr, RouteOcrResult } from "./ocr";

type OcrOptions = { maxReadings?: number; fastFirst?: boolean; preferCageCrop?: boolean };
type PendingRequest = {
  resolve: (result: RouteOcrResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

const OCR_WORKER_TIMEOUT_MS = 120_000;
const RETRYABLE_WORKER_ERROR = /SIGBUS|encerrou inesperadamente|worker da IA falhou|EPIPE|excedeu/i;
const pendingRequests = new Map<string, PendingRequest>();
let worker: ChildProcess | undefined;
let requestSequence = 0;

export function shouldUseIsolatedOcr(env = process.env) {
  if (env.OCR_ISOLATED_PROCESS === "false") return false;
  return env.OCR_ISOLATED_PROCESS === "true" || Boolean(env.RENDER);
}

export async function readRouteImageOcrWithoutBlockingSocket(imagePath: string, options: OcrOptions = {}) {
  if (!shouldUseIsolatedOcr()) return readRouteImageOcr(imagePath, options);

  try {
    return await requestIsolatedOcr(imagePath, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!RETRYABLE_WORKER_ERROR.test(message)) throw error;
    recycleWorker();
    await new Promise((resolve) => setTimeout(resolve, 100));
    return requestIsolatedOcr(imagePath, options);
  }
}

function requestIsolatedOcr(imagePath: string, options: OcrOptions) {
  const activeWorker = getWorker();
  const id = `${process.pid}-${Date.now()}-${++requestSequence}`;
  return new Promise<RouteOcrResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Worker da IA excedeu ${Math.round(OCR_WORKER_TIMEOUT_MS / 1000)} segundos.`));
      recycleWorker();
    }, OCR_WORKER_TIMEOUT_MS);
    timer.unref?.();
    pendingRequests.set(id, { resolve, reject, timer });
    activeWorker.send?.({ type: "analyze", id, imagePath, options }, (error) => {
      if (!error) return;
      settleRequest(id, undefined, error.message);
    });
  });
}

export function warmupIsolatedOcrWorker() {
  if (shouldUseIsolatedOcr()) getWorker();
}

export function shutdownIsolatedOcrWorker() {
  if (!worker) return;
  const current = worker;
  worker = undefined;
  current.removeAllListeners();
  current.kill();
  rejectAllPending("Worker da IA encerrado.");
}

function getWorker() {
  if (worker?.connected) return worker;

  const workerPath = path.join(__dirname, "ocrWorker.js");
  worker = fork(workerPath, [], {
    env: { ...process.env, OCR_ISOLATED_PROCESS: "false", OCR_WORKER_PROCESS: "true" },
    stdio: ["ignore", "inherit", "inherit", "ipc"]
  });
  // OCR consome CPU intensamente. Em contenÃ§Ã£o, mantenha o socket do bot
  // responsivo e deixe o kernel executar o Tesseract como tarefa de fundo.
  if (worker.pid) {
    try {
      os.setPriority(worker.pid, 10);
    } catch {
      // Alguns ambientes nÃ£o permitem alterar nice; o isolamento ainda vale.
    }
  }
  worker.on("message", (message: any) => {
    if (!message || message.type !== "result" || typeof message.id !== "string") return;
    settleRequest(message.id, message.result, message.error);
  });
  worker.on("error", (error) => {
    rejectAllPending(`Worker da IA falhou: ${error.message}`);
  });
  worker.on("exit", (code, signal) => {
    worker = undefined;
    rejectAllPending(`Worker da IA encerrou inesperadamente (${code ?? signal ?? "sem código"}).`);
  });
  return worker;
}

function settleRequest(id: string, result?: RouteOcrResult, error?: string) {
  const pending = pendingRequests.get(id);
  if (!pending) return;
  pendingRequests.delete(id);
  clearTimeout(pending.timer);
  if (error) pending.reject(new Error(error));
  else if (result) pending.resolve(result);
  else pending.reject(new Error("Worker da IA respondeu sem resultado."));
}

function rejectAllPending(message: string) {
  for (const [id, pending] of pendingRequests) {
    pendingRequests.delete(id);
    clearTimeout(pending.timer);
    pending.reject(new Error(message));
  }
}

function recycleWorker() {
  const current = worker;
  worker = undefined;
  current?.removeAllListeners();
  current?.kill();
}
