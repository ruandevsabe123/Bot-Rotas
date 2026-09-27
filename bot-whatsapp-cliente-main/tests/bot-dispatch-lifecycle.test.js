const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BotService } = require("../dist/bot/connection.js");

function deferred() {
  let resolve;
  const promise = new Promise((accept) => { resolve = accept; });
  return { promise, resolve };
}

function createBot(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-lifecycle-"));
  const bot = new BotService({
    configPath: path.join(directory, "config.json"),
    routeStorePath: path.join(directory, "routes.json"),
    dispatchQueuePath: path.join(directory, "queue.json"),
    telemetryPath: path.join(directory, "telemetry.json"),
    ocrAnalysisHistoryPath: path.join(directory, "ocr.json"),
    logStorePath: path.join(directory, "logs.json")
  });
  bot.monitoringEnabled = true;
  bot.sendCycleId = 1;
  bot.sock = {};
  bot.preparedRelayMessages = [
    { key: { id: "first" }, message: { conversation: "first" } },
    { key: { id: "second" }, message: { conversation: "second" } }
  ];
  bot.updateRouteDispatch = () => undefined;
  bot.recordDispatchMetrics = () => undefined;
  bot.stopMonitoringAfterTargetDispatch = () => undefined;
  bot.emitSnapshot = () => undefined;
  bot.addStatusEvent = () => undefined;
  t.after(async () => {
    await bot.logger.flush();
    bot.dispatchQueueStore.flush();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return bot;
}

test("cancelamento durante o ACK impede a segunda mensagem", async (t) => {
  const bot = createBot(t);
  const ack = deferred();
  const relays = [];
  bot.relayPreparedMessage = async (_socket, _jid, message) => {
    relays.push(message.key.id);
    if (message.key.id === "first") await ack.promise;
  };
  const dispatch = bot.sendAggressiveTargetSequence("test@g.us", ["first", "second"], 1);
  assert.deepEqual(relays, ["first"]);
  bot.disableMonitoring();
  ack.resolve();
  await dispatch;
  assert.deepEqual(relays, ["first"]);
});

test("cancelamento durante stagger impede o relay já agendado", async (t) => {
  const bot = createBot(t);
  const delayed = deferred();
  const resume = deferred();
  const relays = [];
  bot.delay = async () => { delayed.resolve(); await resume.promise; };
  bot.relayPreparedMessage = async (_socket, _jid, message) => { relays.push(message.key.id); };
  const dispatch = bot.sendAggressiveTargetSequence("test@g.us", ["first", "second"], 1);
  await delayed.promise;
  bot.disableMonitoring();
  resume.resolve();
  await dispatch;
  assert.deepEqual(relays, ["first"]);
});

test("retry cancelado durante a espera não envia mensagens", async (t) => {
  const bot = createBot(t);
  const waiting = deferred();
  const resume = deferred();
  let relays = 0;
  bot.delay = async () => { waiting.resolve(); await resume.promise; };
  bot.relayTextMessage = async () => { relays += 1; return { key: { id: "retry" } }; };
  const retry = bot.retryTargetMessageAfterFailure("test@g.us", "first", 1, 1, new Error("timeout"), { events: [] });
  await waiting.promise;
  bot.disableMonitoring();
  resume.resolve();
  assert.equal(await retry, false);
  assert.equal(relays, 0);
});

test("falha síncrona da primeira faixa especulativa não prende a segunda", async (t) => {
  const bot = createBot(t);
  bot.shouldUseSpeculativeSecondLane = () => true;
  const relays = [];
  bot.relayPreparedMessage = (_socket, _jid, message) => {
    relays.push(message.key.id);
    if (message.key.id === "first") throw new Error("relay recusado");
    return Promise.resolve();
  };
  await bot.sendAggressiveTargetSequence("test@g.us", ["first", "second"], 1);
  assert.deepEqual(relays, ["first", "second"]);
});

test("falha da segunda mensagem é observada enquanto a primeira aguarda ACK", async (t) => {
  const bot = createBot(t);
  const ack = deferred();
  const failed = deferred();
  bot.shouldUseSpeculativeSecondLane = () => true;
  bot.relayPreparedMessage = async (_socket, _jid, message) => {
    if (message.key.id === "first") await ack.promise;
    else { failed.resolve(); throw new Error("segunda mensagem recusada"); }
  };
  const dispatch = bot.sendAggressiveTargetSequence("test@g.us", ["first", "second"], 1);
  await failed.promise;
  await new Promise((resolve) => setImmediate(resolve));
  ack.resolve();
  await dispatch;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(bot.logger.all().some((entry) => entry.message.includes("segunda mensagem recusada")));
});

test("parar desconectado cancela ciclos e timers e persiste fila", async (t) => {
  const bot = createBot(t);
  bot.sock = undefined;
  bot.status = "disconnected";
  bot.healthCheckTimer = setInterval(() => {}, 10_000);
  bot.reconnectTimer = setTimeout(() => {}, 10_000);
  await bot.stop();
  assert.equal(bot.sendCycleId, 2);
  assert.equal(bot.healthCheckTimer, undefined);
  assert.equal(bot.reconnectTimer, undefined);
  assert.equal(bot.stopping, true);
  bot.scheduleReconnect(false);
  assert.equal(bot.reconnectTimer, undefined);
});

test("falha de persistencia ao parar ainda encerra o socket e cancela reconexao", async (t) => {
  const bot = createBot(t);
  let socketEnded = false;
  let websocketClosed = false;
  bot.sock = {
    ev: { removeAllListeners() {} },
    end() { socketEnded = true; },
    ws: { close() { websocketClosed = true; } }
  };
  bot.routeStore.flush = () => { throw new Error("storage unavailable"); };
  bot.reconnectTimer = setTimeout(() => {}, 10_000);

  await assert.rejects(bot.stop(), /falha ao persistir/);

  assert.equal(socketEnded, true);
  assert.equal(websocketClosed, true);
  assert.equal(bot.sock, undefined);
  assert.equal(bot.status, "disconnected");
  assert.equal(bot.reconnectTimer, undefined);
  bot.scheduleReconnect(false);
  assert.equal(bot.reconnectTimer, undefined);
});
