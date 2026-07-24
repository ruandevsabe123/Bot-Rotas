const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BotService } = require("../dist/bot/connection.js");

function createBot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-initial-open-"));
  const bot = new BotService({
    configPath: path.join(directory, "config.json"),
    routeStorePath: path.join(directory, "routes.json"),
    dispatchQueuePath: path.join(directory, "queue.json"),
    telemetryPath: path.join(directory, "telemetry.json"),
    logStorePath: path.join(directory, "logs.json"),
    clientEmail: "cliente@teste.com"
  });
  return { bot, directory };
}

test("dispara imediatamente ao armar se o grupo já estiver aberto", () => {
  const { bot, directory } = createBot();
  try {
    bot.monitoringEnabled = true;
    bot.monitoringMode = "target";
    bot.groupState = "open";
    bot.preparedTargetDispatchMode = "manual";
    bot.preparedTargetJid = "motoristas@g.us";
    bot.preparedMessages = ["Cliente F-14"];
    let called;
    bot.enviarMensagensRapidas = (...args) => {
      called = args;
      return true;
    };

    assert.equal(bot.dispatchIfGroupAlreadyOpen("armado"), true);
    assert.equal(called[1], "automatic");
    assert.equal(called[3], "already_open");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("primeira mensagem não espera a adaptação aplicada à segunda", async () => {
  const { bot, directory } = createBot();
  try {
    const calls = [];
    bot.monitoringEnabled = true;
    bot.monitoringMode = "target";
    bot.sendCycleId = 7;
    bot.adaptiveOpeningSettleMs = 60;
    bot.sock = {
      relayMessage: async (_jid, _message, options) => {
        calls.push({ id: options.messageId, at: Date.now() });
      }
    };
    bot.preparedRelayMessages = [
      { key: { id: "first" }, message: { conversation: "Cliente A-1" } },
      { key: { id: "second" }, message: { conversation: "Cliente A-2" } }
    ];
    bot.updateRouteDispatch = () => undefined;
    bot.recordDispatchMetrics = () => undefined;
    bot.stopMonitoringAfterTargetDispatch = () => undefined;
    bot.emitSnapshot = () => undefined;
    bot.addStatusEvent = () => undefined;

    const startedAt = Date.now();
    const dispatch = bot.sendAggressiveTargetSequence(
      "motoristas@g.us",
      ["Cliente A-1", "Cliente A-2"],
      7,
      startedAt,
      startedAt,
      "automatic"
    );

    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, "first");

    await dispatch;
    assert.equal(calls.length, 2);
    assert.equal(calls[1].id, "second");
    assert.ok(calls[1].at - calls[0].at >= 60);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("disparo reconstrói envelope com ID e timestamp novos", async () => {
  const { bot, directory } = createBot();
  try {
    bot.monitoringEnabled = true;
    bot.monitoringMode = "target";
    bot.preparedTargetJid = "motoristas@g.us";
    bot.preparedMessages = ["Cliente A-1"];
    bot.preparedNuclearMode = false;
    let rebuilds = 0;
    bot.rebuildPreparedRelayMessages = () => {
      rebuilds += 1;
      bot.preparedRelayMessages = [{ key: { id: "fresh" }, message: { conversation: "Cliente A-1" } }];
    };
    bot.sendAggressiveTargetSequence = async () => undefined;
    bot.enqueueDispatch = () => undefined;
    bot.registerRouteDispatch = () => "route-fresh";
    bot.markQueuedDispatchSending = () => undefined;

    assert.equal(bot.enviarMensagensRapidas(1, "automatic", Date.now(), "group_update"), true);
    assert.equal(rebuilds, 1);
    await bot.activeSendCycle;
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("grupo aberto aguarda a leitura segura quando o modo é imagem", () => {
  const { bot, directory } = createBot();
  try {
    bot.monitoringEnabled = true;
    bot.monitoringMode = "target";
    bot.groupState = "open";
    bot.preparedTargetDispatchMode = "ocr";
    bot.preparedTargetJid = "motoristas@g.us";
    bot.preparedMessages = [];
    bot.pendingOcrMessages = [];
    let calls = 0;
    bot.enviarMensagensRapidas = () => {
      calls += 1;
      return true;
    };

    assert.equal(bot.dispatchIfGroupAlreadyOpen("armado"), false);
    assert.equal(calls, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("imagem nova dispara assim que fica pronta com o grupo aberto", async () => {
  const { bot, directory } = createBot();
  try {
    bot.monitoringEnabled = true;
    bot.monitoringMode = "target";
    bot.groupState = "open";
    bot.preparedTargetDispatchMode = "ocr";
    bot.preparedTargetJid = "motoristas@g.us";
    bot.pendingOcrMessages = ["Cliente B-1"];
    bot.lastOcrInsight = { analysisId: "cliente@teste.com:imagem-nova" };
    bot.getActiveMonitoringGroup = () => ({ jid: "motoristas@g.us", label: "grupo alvo" });
    let called;
    bot.enviarMensagensRapidas = (...args) => {
      called = args;
      return true;
    };

    assert.equal(await bot.dispatchPreparedOcrIfGroupOpen("automatic"), true);
    assert.equal(called[1], "automatic");
    assert.equal(called[3], "image_ready");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("ciclo ativo é liberado mesmo se outro gatilho incrementar o contador", async () => {
  const { bot, directory } = createBot();
  try {
    bot.monitoringEnabled = true;
    bot.monitoringMode = "target";
    bot.preparedTargetJid = "motoristas@g.us";
    bot.preparedMessages = ["Cliente B-1"];
    bot.preparedNuclearMode = false;
    bot.ensurePreparedRelayMessages = () => undefined;
    bot.sendAggressiveTargetSequence = async () => undefined;
    bot.enqueueDispatch = () => undefined;
    bot.registerRouteDispatch = () => "route-1";
    bot.markQueuedDispatchSending = () => undefined;

    assert.equal(bot.enviarMensagensRapidas(1, "automatic", Date.now(), "group_update"), true);
    const active = bot.activeSendCycle;
    bot.sendCycleId = 2;
    await active;

    assert.equal(bot.activeSendCycle, undefined);
    assert.equal(bot.criticalDispatchInProgress, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
