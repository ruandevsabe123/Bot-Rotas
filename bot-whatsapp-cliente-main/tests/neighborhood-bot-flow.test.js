const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BotService } = require("../dist/bot/connection");
const isolated = require("../dist/bot/ocrIsolated");

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function reading(rows) {
  const lines = rows.map((text, index) => {
    const words = text.split(" ").map((word, column) => ({ text: word, top: 40 + index * 40, left: column * 130, width: 100, height: 20, confidence: 95 }));
    return { text, words, top: 40 + index * 40, left: 0, width: 600, height: 20, confidence: 95 };
  });
  return { text: rows.join("\n"), lines, source: "fixture", variants: [0, 1].map((index) => ({ text: rows.join("\n"), lines: structuredClone(lines), source: `fixture-${index}` })) };
}

function createBot(t, email = "client@test.com") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "neighborhood-flow-"));
  const bot = new BotService({
    clientEmail: email,
    configPath: path.join(directory, "config.json"),
    routeStorePath: path.join(directory, "routes.json"),
    dispatchQueuePath: path.join(directory, "queue.json"),
    telemetryPath: path.join(directory, "telemetry.json"),
    ocrAnalysisHistoryPath: path.join(directory, "ocr.json"),
    logStorePath: path.join(directory, "logs.json")
  });
  bot.configStore.save({ targetDispatchMode: "ocr", nomeEnvio: "Cliente", grupoAlvoJid: "group@g.us", rotasMonitoradasDetalhadas: [{ cidade: "Cidade", bairro: "Centro" }, { cidade: "Cidade", bairro: "Jardim Azul" }] });
  bot.sock = {};
  bot.status = "connected";
  bot.monitoringEnabled = true;
  bot.preparedTargetDispatchMode = "ocr";
  bot.latestRouteImageSequence = 1;
  bot.downloadRouteImage = async () => Buffer.from(email);
  bot.rebuildPreparedRelayMessages = () => undefined;
  bot.emitSnapshot = () => undefined;
  bot.dispatchPreparedOcrIfGroupOpen = async () => false;
  const states = [];
  bot.dispatchRaceEventReporter = (event) => states.push(event);
  t.after(async () => {
    bot.cancelPendingRouteImageBatch();
    await bot.logger.flush();
    await bot.ocrAnalysisHistoryStore.flush();
    bot.dispatchQueueStore.flush();
    bot.routeStore.flush();
    bot.telemetryStore.flush();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { bot, states };
}

function mockReading(t, callback) {
  const original = isolated.readRouteImageOcrWithoutBlockingSocket;
  isolated.readRouteImageOcrWithoutBlockingSocket = callback;
  t.after(() => { isolated.readRouteImageOcrWithoutBlockingSocket = original; });
}

function batch(...ids) {
  return ids.map((messageId) => ({ messageId, msg: {}, groupJid: "group@g.us" }));
}

test("IA escolhe apenas o primeiro bairro preferido, sem arquivo ou consulta de romaneio", async (t) => {
  const { bot, states } = createBot(t);
  // The lower preference is the first physical row. Configuration order wins.
  mockReading(t, async (_imagePath, options) => {
    assert.equal(options.preferCageCrop, false);
    assert.equal(options.fastFirst, false);
    return reading(["B-2 Cidade Jardim Azul", "A-1 Cidade Centro"]);
  });
  bot.romaneioStore = { routes() { throw new Error("No romaneio should be read"); }, getSettings() { throw new Error("No ranking should be used"); } };
  await bot.processRouteImageBatch(batch("image-1"), 1);
  assert.deepEqual(bot.pendingOcrMessages, ["Cliente A-1"]);
  assert.equal(bot.ocrRouteSelection.options[0].bairro, "Centro");
  assert.equal(bot.ocrRouteSelection.status, "confirmed");
  assert.deepEqual(states.map((event) => event.state), ["processing", "ready"]);
});

test("painel recebe previa compacta enquanto OCR usa a imagem completa", async (t) => {
  const { bot } = createBot(t);
  const sharp = require("sharp");
  const source = await sharp({ create: { width: 1200, height: 500, channels: 3, background: "white" } }).png().toBuffer();
  bot.downloadRouteImage = async () => source;
  mockReading(t, async (_imagePath, options) => {
    assert.equal(options.preferCageCrop, false);
    assert.equal(options.fastFirst, false);
    return reading(["A-1 Cidade Centro"]);
  });
  await bot.processRouteImageBatch(batch("preview"), 1);
  assert.match(bot.ocrRouteSelection.imagePreviewUrl, /^data:image\/jpeg;base64,/);
});

test("bairro repetido prepara somente a primeira gaiola visual confirmada", async (t) => {
  const { bot, states } = createBot(t);
  mockReading(t, async () => reading(["A-1 Cidade Centro", "B-2 Cidade Centro", "C-3 Cidade Jardim Azul"]));
  await bot.processRouteImageBatch(batch("ambiguous"), 1);
  assert.deepEqual(bot.pendingOcrMessages, ["Cliente A-1"]);
  assert.equal(bot.ocrRouteSelection.status, "confirmed");
  assert.deepEqual(states.map((event) => event.state), ["processing", "ready"]);
});

test("parar durante download descarta a analise e nao prepara envio", async (t) => {
  const { bot, states } = createBot(t);
  const downloadStarted = deferred();
  const downloadRelease = deferred();
  bot.downloadRouteImage = async () => { downloadStarted.resolve(); await downloadRelease.promise; return Buffer.from("fixture"); };
  mockReading(t, async () => { throw new Error("OCR must not start after stop"); });
  const analysis = bot.processRouteImageBatch(batch("cancelled"), 1);
  await downloadStarted.promise;
  bot.disableMonitoring();
  downloadRelease.resolve();
  await analysis;
  assert.deepEqual(bot.pendingOcrMessages, []);
  assert.deepEqual(states.map((event) => event.state), ["processing", "unavailable"]);
});

test("dois clientes com a mesma imagem usam temporarios independentes", async (t) => {
  const first = createBot(t, "first@test.com");
  const second = createBot(t, "second@test.com");
  const secondReadingStarted = deferred();
  const releaseSecond = deferred();
  const paths = [];
  mockReading(t, async (imagePath) => {
    paths.push(imagePath);
    const contents = fs.readFileSync(imagePath, "utf8");
    if (contents === "first@test.com") await secondReadingStarted.promise;
    else { secondReadingStarted.resolve(); await releaseSecond.promise; }
    assert.equal(fs.readFileSync(imagePath, "utf8"), contents);
    return reading(["A-1 Cidade Centro"]);
  });
  const firstAnalysis = first.bot.processRouteImageBatch(batch("shared-id"), 1);
  const secondAnalysis = second.bot.processRouteImageBatch(batch("shared-id"), 1);
  await firstAnalysis;
  releaseSecond.resolve();
  await secondAnalysis;
  assert.equal(new Set(paths).size, 2);
  assert.ok(paths.every((file) => !fs.existsSync(file)));
  assert.deepEqual(first.bot.pendingOcrMessages, ["Cliente A-1"]);
  assert.deepEqual(second.bot.pendingOcrMessages, ["Cliente A-1"]);
});

test("ordem de chegada das fotos nao altera identidade do evento entre clientes", async (t) => {
  const { bot, states } = createBot(t);
  mockReading(t, async () => reading(["A-1 Cidade Centro"]));
  await bot.processRouteImageBatch(batch("image-b", "image-a"), 1);
  assert.equal(states[0].eventKey, "image-a+image-b");
  assert.equal(bot.lastOcrInsight.analysisId, "client@test.com:image-a+image-b");
});

test("IA nao arma sem bairros preferidos mesmo com gaiolas legadas salvas", async (t) => {
  const { bot } = createBot(t);
  bot.configStore.save({ rotasMonitoradasDetalhadas: [], rotasMonitoradas: [], ocrSelectionMode: "cages", ocrDesiredCages: ["A-1"] });
  assert.equal(await bot.enableImageMonitoring(), false);
  assert.equal(bot.hasReadyMessages(), false);
});
