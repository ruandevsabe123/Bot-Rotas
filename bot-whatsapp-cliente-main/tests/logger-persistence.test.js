const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BotLogger } = require("../dist/bot/logger.js");

test("persistência automática de logs usa o caminho assíncrono e preserva conteúdo", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-logger-"));
  const filePath = path.join(directory, "logs.json");
  try {
    const logger = new BotLogger(undefined, filePath);
    logger.info("preparação concluída");
    logger.saveInBackground();
    await logger.saveInFlight;

    const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].message, "preparação concluída");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
