const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ConfigStore } = require("../dist/bot/config.js");
const { acquireGlobalOcrLock } = require("../dist/bot/ocrGlobalLock.js");

test("configuração permanece em memória depois da primeira leitura", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-config-cache-"));
  const filePath = path.join(directory, "config.json");
  fs.writeFileSync(filePath, JSON.stringify({ nomeEnvio: "Ruan", codigosMensagensAlvo: ["C-30"] }));

  try {
    const store = new ConfigStore(filePath);
    assert.equal(store.load().nomeEnvio, "Ruan");
    fs.unlinkSync(filePath);
    assert.equal(store.load().codigosMensagensAlvo[0], "C-30");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("fila global configurada limita análises pesadas concorrentes", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-ocr-lock-"));
  const env = { ...process.env, DATA_DIR: directory, OCR_GLOBAL_CONCURRENCY: "1" };

  try {
    const releaseFirst = await acquireGlobalOcrLock(env);
    let secondAcquired = false;
    const second = acquireGlobalOcrLock(env).then((release) => {
      secondAcquired = true;
      return release;
    });

    await new Promise((resolve) => setTimeout(resolve, 110));
    assert.equal(secondAcquired, false);
    await releaseFirst();
    const releaseSecond = await second;
    assert.equal(secondAcquired, true);
    await releaseSecond();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
