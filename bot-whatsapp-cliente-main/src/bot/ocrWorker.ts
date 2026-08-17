import { readRouteImageOcr, shutdownRouteOcrEngine } from "./ocr";
import { acquireGlobalOcrLock } from "./ocrGlobalLock";

let analysisQueue = Promise.resolve();

process.on("message", (message: any) => {
  if (!message || message.type !== "analyze" || typeof message.id !== "string") return;

  analysisQueue = analysisQueue.then(async () => {
    let release: (() => Promise<void>) | undefined;
    try {
      release = await acquireGlobalOcrLock();
      const result = await readRouteImageOcr(String(message.imagePath || ""), message.options || {});
      process.send?.({ type: "result", id: message.id, result });
    } catch (error) {
      process.send?.({
        type: "result",
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      await shutdownRouteOcrEngine();
      await release?.();
    }
  });
});

process.on("disconnect", () => process.exit(0));
