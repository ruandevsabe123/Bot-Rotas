const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { OcrAnalysisHistoryStore } = require("../dist/bot/ocrAnalysisHistoryStore.js");

test("histórico persiste análises concluídas e atualiza o mesmo resultado", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ocr-history-"));
  const filePath = path.join(directory, "history.json");
  try {
    const store = new OcrAnalysisHistoryStore(filePath);
    store.upsert({ status: "ready", analysisId: "foto-1", processedAt: "2026-08-24T09:00:00.000Z", options: [], message: "Nenhuma desejada." });
    store.upsert({ status: "confirmed", analysisId: "foto-1", processedAt: "2026-08-24T09:00:00.000Z", options: [], preparedMessages: ["Ruan C-30"] });
    store.upsert({ status: "analyzing", analysisId: "foto-2", options: [] });
    await new Promise((resolve) => setTimeout(resolve, 180));

    const restored = new OcrAnalysisHistoryStore(filePath).all();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].status, "confirmed");
    assert.deepEqual(restored[0].preparedMessages, ["Ruan C-30"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
