import { BotService } from "./connection";
import { shutdownIsolatedOcrWorker } from "./ocrIsolated";
import { BotWorkerIncomingMessage, BotWorkerOutgoingMessage } from "./botProcessProtocol";

const ALLOWED_METHODS = new Set([
  "start",
  "stop",
  "restart",
  "clearSession",
  "refreshQrCode",
  "factoryReset",
  "clearLogs",
  "clearRouteHistory",
  "refreshGroups",
  "enableMonitoring",
  "enableImageMonitoring",
  "enableNuclearMonitoring",
  "enableTestMonitoring",
  "disableMonitoring",
  "simulateOpening",
  "manualDispatch",
  "simulateTargetDispatchOnTestGroup",
  "runLatencyProbeOnTestGroup",
  "warmupConnection",
  "saveGroup",
  "saveTestGroup",
  "setMessageCodes",
  "setMessageSettings",
  "setWarmupMessageSettings",
  "setDispatchPriorityLevel",
  "saveRoutePreset",
  "deleteRoutePreset",
  "setGeneralSettings",
  "confirmOcrRouteSelection",
  "submitClientIncident",
  "snoozeClientIncident",
  "validateRoute",
  "rejectRoute",
  "setLeaderContacts",
  "locateRomaneioInGroup",
  "confirmRomaneioCandidate"
]);

let bot: BotService | undefined;
let snapshotTimer: NodeJS.Timeout | undefined;
let shuttingDown = false;
let reportedCritical = false;
let callQueue = Promise.resolve();

function send(message: BotWorkerOutgoingMessage) {
  if (process.connected) process.send?.(message);
}

function scheduleSnapshot() {
  if (!bot || snapshotTimer) return;
  const critical = bot.isCriticalDispatchActive();
  if (critical && !reportedCritical) {
    reportedCritical = true;
    send({ type: "snapshot-dirty", critical: true });
  }
  snapshotTimer = setTimeout(() => {
    snapshotTimer = undefined;
    if (!bot) return;
    if (bot.isCriticalDispatchActive()) {
      scheduleSnapshot();
      return;
    }
    reportedCritical = false;
    send({ type: "snapshot", snapshot: bot.getSnapshot() });
  }, critical ? 100 : 20);
  snapshotTimer.unref?.();
}

async function initialize(message: Extract<BotWorkerIncomingMessage, { type: "init" }>) {
  if (bot) return;
  bot = new BotService({ ...message.options, deferSnapshotPayload: true });
  bot.on("snapshot", scheduleSnapshot);
  bot.on("image-analysis", (analysis) => {
    setImmediate(() => send({ type: "image-analysis", analysis }));
  });
  send({ type: "ready", snapshot: bot.getSnapshot() });
}

async function handleCall(message: Extract<BotWorkerIncomingMessage, { type: "call" }>) {
  if (!bot) throw new Error("Worker do bot ainda não foi inicializado.");
  if (!ALLOWED_METHODS.has(message.method)) throw new Error(`Método não permitido no worker: ${message.method}`);
  const method = (bot as any)[message.method];
  if (typeof method !== "function") throw new Error(`Método do bot não encontrado: ${message.method}`);

  const result = await method.apply(bot, message.args || []);
  const snapshot = bot.isCriticalDispatchActive() ? undefined : bot.getSnapshot();
  if (snapshot && snapshotTimer) {
    clearTimeout(snapshotTimer);
    snapshotTimer = undefined;
    reportedCritical = false;
  }
  send({ type: "response", id: message.id, result, snapshot });
  if (!snapshot) scheduleSnapshot();
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  await bot?.stop().catch(() => undefined);
  shutdownIsolatedOcrWorker();
  process.disconnect?.();
  process.exit(0);
}

process.on("message", (message: BotWorkerIncomingMessage) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "init") {
    void initialize(message).catch((error) => {
      console.error("Falha ao inicializar worker do bot:", error);
      process.exit(1);
    });
    return;
  }
  if (message.type === "shutdown") {
    void shutdown();
    return;
  }
  if (message.type === "call") {
    callQueue = callQueue
      .then(() => handleCall(message))
      .catch((error) => {
        send({
          type: "response",
          id: message.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
  }
});

process.on("disconnect", () => void shutdown());
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
