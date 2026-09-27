const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ConfigStore } = require("../dist/bot/config.js");

test("preserva gaiolas legadas sem truncar, migrando o envio para bairros", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desired-cages-"));
  const store = new ConfigStore(path.join(directory, "config.json"));
  const cages = Array.from({ length: 350 }, (_, index) => `g-${index + 1}`);

  const saved = store.save({
    ocrSelectionMode: "cages",
    ocrDesiredCages: [...cages, "G-1", "  g-2  "]
  });

  assert.equal(saved.ocrSelectionMode, "neighborhoods");
  assert.equal(saved.ocrManualRouteSelection, false);
  assert.equal(saved.ocrDesiredCages.length, 350);
  assert.deepEqual(saved.ocrDesiredCages.slice(0, 3), ["G-1", "G-2", "G-3"]);
  assert.equal(store.load().ocrDesiredCages.length, 350);
  assert.equal(saved.ocrCageMessageLimit, 0);
});

test("salva o limite personalizado de mensagens por gaiola", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desired-cages-limit-"));
  const store = new ConfigStore(path.join(directory, "config.json"));
  const saved = store.save({ ocrSelectionMode: "cages", ocrDesiredCages: ["C-30", "B-29"], ocrCageMessageLimit: 2 });
  assert.equal(saved.ocrCageMessageLimit, 2);
  assert.equal(store.load().ocrCageMessageLimit, 2);
});

test("migra a configuração antiga de escolha automática para bairros", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desired-cages-legacy-"));
  const configPath = path.join(directory, "config.json");
  fs.writeFileSync(configPath, JSON.stringify({ ocrManualRouteSelection: false }));

  const config = new ConfigStore(configPath).load();

  assert.equal(config.ocrSelectionMode, "neighborhoods");
});

test("preserva a seleção legado por gaiolas quando o cliente configurou explicitamente", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "desired-cages-legacy-mode-"));
  const configPath = path.join(directory, "config.json");
  const store = new ConfigStore(configPath);

  const config = store.save({
    ocrSelectionMode: "cages",
    ocrDesiredCages: ["C-30", "B-29"],
    ocrCageMessageLimit: 2
  });

  assert.equal(config.ocrSelectionMode, "cages");
  assert.equal(config.ocrManualRouteSelection, false);
  assert.deepEqual(config.ocrDesiredCages, ["C-30", "B-29"]);
  assert.equal(config.ocrCageMessageLimit, 2);
});
