import { readRouteImageOcr } from "./ocr";

process.on("message", (message: any) => {
  if (!message || message.type !== "analyze" || typeof message.id !== "string") return;

  void readRouteImageOcr(String(message.imagePath || ""), message.options || {})
    .then((result) => {
      process.send?.({ type: "result", id: message.id, result });
    })
    .catch((error) => {
      process.send?.({
        type: "result",
        id: message.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });
});

process.on("disconnect", () => process.exit(0));
