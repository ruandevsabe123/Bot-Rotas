const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ConfigStore, DEFAULT_CONFIG } = require("../dist/bot/config.js");

test("preserva a escolha e limita o intervalo de aquecimento do cliente", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-optional-warm-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify({
    ...DEFAULT_CONFIG,
    alwaysWarmMode: false,
    keepAliveIntervalMs: 900000
  }));

  const store = new ConfigStore(file);
  const loaded = store.load();
  assert.equal(loaded.alwaysWarmMode, false);
  assert.equal(loaded.keepAliveIntervalMs, 600000);

  const saved = store.save({ alwaysWarmMode: true, keepAliveIntervalMs: 60000 });
  assert.equal(saved.alwaysWarmMode, true);
  assert.equal(saved.keepAliveIntervalMs, 60000);
});
