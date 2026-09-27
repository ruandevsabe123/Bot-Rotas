const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const xlsx = require("xlsx");
const { RomaneioStore } = require("../dist/services/romaneio/romaneioStore.js");
const { parseRomaneioXlsx } = require("../dist/services/romaneio/parseRomaneio.js");
const { buildRouteSummaries } = require("../dist/services/romaneio/buildRouteSummaries.js");
const { RouteStore } = require("../dist/bot/routeStore.js");
const { BotLogger } = require("../dist/bot/logger.js");
const { acquireGlobalOcrLock } = require("../dist/bot/ocrGlobalLock.js");
const { createSharedOcrCacheKey, getOrCreateSharedOcrResult } = require("../dist/bot/ocrSharedCache.js");

function temporaryDirectory(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "audit-storage-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function workbookBuffer(origin) {
  const workbook = xlsx.utils.book_new();
  const sheet = {};
  xlsx.utils.sheet_add_json(sheet, [{ Gaiola: "A-1", Bairro: "Centro" }], { origin: origin || "A1" });
  xlsx.utils.book_append_sheet(workbook, sheet, "Dados");
  return xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
}

test("upload invalido preserva o romaneio anterior e sua recuperacao apos reinicio", (t) => {
  const directory = temporaryDirectory(t);
  const store = new RomaneioStore(directory);
  const buffer = workbookBuffer();
  store.saveUpload("valid.xlsx", buffer);
  const processed = fs.readFileSync(path.join(directory, "processed.json"));
  assert.throws(() => store.saveUpload("invalid.xlsx", Buffer.from("arquivo invalido")));
  assert.equal(fs.readFileSync(path.join(directory, "latest.xlsx")).equals(buffer), true);
  assert.deepEqual(fs.readFileSync(path.join(directory, "processed.json")), processed);
  assert.equal(new RomaneioStore(directory).all().routes[0].gaiola, "A-1");
});

test("cabecalho de planilha com primeira celula em C8 usa a linha fisica correta", () => {
  const parsed = parseRomaneioXlsx(workbookBuffer("C8"));
  assert.equal(parsed.headerRow, 8);
  assert.equal(parsed.routes[0].gaiola, "A-1");
});

test("limpeza por outra instancia invalida o cache do romaneio", (t) => {
  const directory = temporaryDirectory(t);
  const writer = new RomaneioStore(directory);
  writer.saveUpload("valid.xlsx", workbookBuffer());
  const reader = new RomaneioStore(directory);
  assert.equal(reader.all().routes.length, 1);
  writer.clear();
  assert.equal(reader.all().status.loaded, false);
  assert.deepEqual(reader.all().routes, []);
});

test("resumo de rota grande nao estoura limite de argumentos nem copia o grupo a cada linha", () => {
  const rows = Array.from({ length: 150_000 }, () => ({ rota: "R1", gaiola: "A-1", bairro: "Centro", distanciaKm: 12, stop: 4 }));
  const routes = buildRouteSummaries(rows);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].pacotes, rows.length);
  assert.equal(routes[0].distanciaKm, 12);
});

test("entradas nulas em reacoes, timeline e logs nao descartam o historico valido", (t) => {
  const directory = temporaryDirectory(t);
  const routePath = path.join(directory, "routes.json");
  fs.writeFileSync(routePath, JSON.stringify([
    { id: "kept", reactions: [] },
    { id: "mixed", reactions: [null, { id: "reaction" }], reactionsHistory: [null], dispatchTimeline: { events: [null, { label: "ok" }] } }
  ]));
  const routes = new RouteStore(routePath).all();
  assert.deepEqual(routes.map((route) => route.id), ["kept", "mixed"]);
  assert.equal(routes[1].reactions.length, 1);
  assert.equal(routes[1].dispatchTimeline.events.length, 1);
  const logPath = path.join(directory, "logs.json");
  fs.writeFileSync(logPath, JSON.stringify([null, { message: "preservado", level: "info" }]));
  assert.equal(new BotLogger(undefined, logPath).all()[0].message, "preservado");
});

test("trava global incompleta e recente nao pode ser roubada durante inicializacao", async (t) => {
  const directory = temporaryDirectory(t);
  const lockPath = path.join(directory, "ocr-global-0.lock");
  fs.writeFileSync(lockPath, "");
  let acquired = false;
  const pending = acquireGlobalOcrLock({ DATA_DIR: directory, OCR_GLOBAL_CONCURRENCY: "1" }).then(async (release) => {
    acquired = true;
    await release();
  });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const acquiredBeforeRelease = acquired;
  fs.rmSync(lockPath, { force: true });
  await pending;
  assert.equal(acquiredBeforeRelease, false);
});

test("trava do cache incompleta e recente preserva single flight", async (t) => {
  const directory = temporaryDirectory(t);
  const imagePath = path.join(directory, "image.png");
  fs.writeFileSync(imagePath, "fixture");
  const key = await createSharedOcrCacheKey(imagePath);
  const cacheDirectory = path.join(directory, "ocr-result-cache");
  fs.mkdirSync(cacheDirectory);
  const lockPath = path.join(cacheDirectory, `${key}.lock`);
  fs.writeFileSync(lockPath, "");
  let executions = 0;
  const pending = getOrCreateSharedOcrResult(imagePath, {}, async () => {
    executions++;
    return { text: "A-1", lines: [], source: "fixture" };
  }, { DATA_DIR: directory });
  await new Promise((resolve) => setTimeout(resolve, 180));
  const executionsBeforeRelease = executions;
  fs.rmSync(lockPath, { force: true });
  await pending;
  assert.equal(executionsBeforeRelease, 0);
});
