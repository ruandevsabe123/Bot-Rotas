const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ConfigStore } = require("../dist/bot/config.js");

test("salva uma quantidade ilimitada de gaiolas desejadas sem truncar", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desired-cages-"));
  const store = new ConfigStore(path.join(directory, "config.json"));
  const cages = Array.from({ length: 350 }, (_, index) => `g-${index + 1}`);

  const saved = store.save({
    ocrSelectionMode: "cages",
    ocrDesiredCages: [...cages, "G-1", "  g-2  "]
  });

  assert.equal(saved.ocrSelectionMode, "cages");
  assert.equal(saved.ocrManualRouteSelection, false);
  assert.equal(saved.ocrDesiredCages.length, 350);
  assert.deepEqual(saved.ocrDesiredCages.slice(0, 3), ["G-1", "G-2", "G-3"]);
  assert.equal(store.load().ocrDesiredCages.length, 350);
});

test("migra a configuração antiga de escolha automática para melhor rota", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desired-cages-legacy-"));
  const configPath = path.join(directory, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ ocrManualRouteSelection: false }));

  const config = new ConfigStore(configPath).load();

  assert.equal(config.ocrSelectionMode, "best");
});
