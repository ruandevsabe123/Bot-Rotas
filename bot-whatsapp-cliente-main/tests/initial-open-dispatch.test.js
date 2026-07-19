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
