import { shutdownRouteOcrEngine, warmupRouteOcrEngine } from "./ocr";
import { readRouteImageOcrCoordinated } from "./ocrCoordinator";
import { acquireGlobalOcrLock } from "./ocrGlobalLock";

let analysisQueue = Promise.resolve();

process.on("message", (message: any) => {
  if (!message) return;

  if (message.type === "warmup") {
    analysisQueue = analysisQueue.then(async () => {
      let release: (() => Promise<void>) | undefined;
      try {
        release = await acquireGlobalOcrLock();
        await warmupRouteOcrEngine();
      } catch {
        // A análise real tentará novamente e devolverá o erro completo.
      } finally {
        await release?.();
      }
    });
    return;
  }

  if (message.type !== "analyze" || typeof message.id !== "string") return;

  analysisQueue = analysisQueue.then(async () => {
    try {
      const result = await readRouteImageOcrCoordinated(String(message.imagePath || ""), message.options || {});
      process.send?.({ type: "result", id: message.id, result });
    } catch (error) {
      process.send?.({
        type: "result",
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });
});

process.on("disconnect", () => {
  void shutdownRouteOcrEngine().finally(() => process.exit(0));
});
