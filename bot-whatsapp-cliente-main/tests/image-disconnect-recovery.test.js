const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BotService } = require("../dist/bot/connection.js");

function createImageBot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-image-reconnect-"));
  const bot = new BotService({
    authDir: path.join(directory, "auth"),
    configPath: path.join(directory, "config.json"),
    routeStorePath: path.join(directory, "routes.json"),
    dispatchQueuePath: path.join(directory, "queue.json"),
    telemetryPath: path.join(directory, "telemetry.json"),
    logStorePath: path.join(directory, "logs.json"),
    clientEmail: "cliente@teste.com"
  });
  bot.configStore.save({
    grupoAlvoJid: "grupo@g.us",
    grupoAlvoNome: "Grupo alvo",
    targetDispatchMode: "ocr",
    nomeEnvio: "ROTA"
  });
  bot.monitoringEnabled = true;
  bot.monitoringMode = "target";
  bot.preparedTargetDispatchMode = "ocr";
  bot.preparedTargetJid = "grupo@g.us";
  bot.preparedMessages = ["ROTA F-14"];
  bot.pendingOcrMessages = ["ROTA F-14"];
  bot.groupState = "open";
  bot.lastOcrInsight = {
    analysisId: "cliente@teste.com:imagem-1",
    source: "test",
    text: "",
    line: "F-14",
    route: "Rota teste",
    code: "F-14",
    confidence: 99,
    processedAt: new Date().toISOString()
  };
  bot.ocrRouteSelection = {
    status: "confirmed",
    options: [],
    preparedMessages: ["ROTA F-14"],
    message: "Rota pronta"
  };
  return { bot, directory };
}

test("imagem analisada durante queda fica armada e dispara depois da reconexão", async () => {
  const { bot, directory } = createImageBot();
  try {
    bot.status = "reconnecting";
    bot.sock = undefined;

    const beforeReconnect = await bot.dispatchPreparedOcrIfGroupOpen("automatic");

    assert.equal(beforeReconnect, false);
    assert.equal(bot.monitoringEnabled, true);
    assert.equal(bot.pendingOcrReconnectDispatch.analysisId, "cliente@teste.com:imagem-1");
    assert.match(bot.ocrRouteSelection.message, /aguardando o WhatsApp reconectar/i);

    let dispatches = 0;
    bot.status = "connected";
    bot.sock = {};
    bot.prepareSendPlan = () => true;
    bot.enviarMensagensRapidas = () => {
      dispatches += 1;
      return true;
    };

    const recovered = await bot.resumeOcrDispatchAfterReconnect();

    assert.equal(recovered, true);
    assert.equal(dispatches, 1);
    assert.equal(bot.pendingOcrReconnectDispatch, undefined);
    assert.equal(bot.monitoringEnabled, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("queda durante disparo não desarma o bot imagem antes da recuperação", () => {
  const { bot, directory } = createImageBot();
  try {
    bot.deferOcrDispatchUntilReconnect("automatic", 7);

    bot.stopMonitoringAfterTargetDispatch(7);

    assert.equal(bot.monitoringEnabled, true);
    assert.equal(bot.pendingOcrReconnectDispatch.interruptedCycleId, 7);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("recuperação não reenvia imagem que já teve mensagem aceita", async () => {
  const { bot, directory } = createImageBot();
  try {
    bot.status = "connected";
    bot.sock = {};
    bot.deferOcrDispatchUntilReconnect("automatic", 9);
    bot.routeStore.create({
      id: "rota-confirmada",
      clientEmail: "cliente@teste.com",
      groupJid: "grupo@g.us",
      groupName: "Grupo alvo",
      mode: "target",
      trigger: "automatic",
      messages: ["ROTA F-14"],
      sentMessageIds: ["mensagem-1"],
      confirmedCount: 1,
      totalCount: 1,
      status: "sent",
      ocr: bot.lastOcrInsight
    });
    let dispatches = 0;
    bot.enviarMensagensRapidas = () => {
      dispatches += 1;
      return true;
    };

    await bot.resumeOcrDispatchAfterReconnect();

    assert.equal(dispatches, 0);
    assert.equal(bot.pendingOcrReconnectDispatch, undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("falha temporária de aquecimento não reinicia uma sessão conectada", async () => {
  const { bot, directory } = createImageBot();
  try {
    let restarts = 0;
    bot.status = "connected";
    bot.sock = {};
    bot.measureEventLoopLag = async () => 0;
    bot.prewarmConnection = async () => {
      throw new Error("metadata timeout");
    };
    bot.restart = async () => {
      restarts += 1;
    };

    await bot.runHealthCheck();
    await bot.runHealthCheck();
    await bot.runHealthCheck();

    assert.equal(restarts, 0);
    assert.equal(bot.consecutiveHealthCheckFailures, 3);
    assert.equal(bot.status, "connected");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
