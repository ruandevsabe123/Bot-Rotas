const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ConfigStore, DEFAULT_CONFIG } = require("../dist/bot/config.js");

test("mantém o aquecimento obrigatório mesmo se uma configuração antiga tentar desligá-lo", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-forced-warm-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({
    ...DEFAULT_CONFIG,
    alwaysWarmMode: false,
    keepAliveIntervalMs: 900000
  }));

  const store = new ConfigStore(file);
  const loaded = store.load();
  assert.equal(loaded.alwaysWarmMode, true);
  assert.equal(loaded.keepAliveIntervalMs, DEFAULT_CONFIG.keepAliveIntervalMs);

  const saved = store.save({ alwaysWarmMode: false, keepAliveIntervalMs: 900000 });
  assert.equal(saved.alwaysWarmMode, true);
  assert.equal(saved.keepAliveIntervalMs, DEFAULT_CONFIG.keepAliveIntervalMs);
});
