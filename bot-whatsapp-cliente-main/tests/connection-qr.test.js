const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { BotService, QR_CODE_LIFETIME_MS } = require("../dist/bot/connection.js");

function createBot() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-qr-"));
  const authDir = path.join(directory, "auth");
  const bot = new BotService({
    authDir,
    configPath: path.join(directory, "config.json"),
    routeStorePath: path.join(directory, "routes.json"),
    dispatchQueuePath: path.join(directory, "queue.json"),
    telemetryPath: path.join(directory, "telemetry.json"),
    logStorePath: path.join(directory, "logs.json"),
    clientEmail: "cliente@teste.com"
  });
  return { bot, authDir, directory };
}

test("QR permanece válido por 60 segundos e informa sua geração", async () => {
  const { bot, directory } = createBot();
  try {
    bot.activeConnectionId = 3;
    const before = Date.now();

    await bot.handleConnectionUpdate({ qr: "qr-atual" }, 3);

    const snapshot = bot.getSnapshot();
    const generatedAt = new Date(snapshot.qrGeneratedAt).getTime();
    const expiresAt = new Date(snapshot.qrExpiresAt).getTime();
    assert.equal(QR_CODE_LIFETIME_MS, 60_000);
    assert.equal(snapshot.status, "waiting_qr");
    assert.equal(snapshot.qrCode, "qr-atual");
    assert.equal(snapshot.qrAttempt, 1);
    assert.ok(generatedAt >= before);
    assert.equal(expiresAt - generatedAt, QR_CODE_LIFETIME_MS);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("QR novo substitui o anterior sem manter validade antiga", async () => {
  const { bot, directory } = createBot();
  try {
    bot.activeConnectionId = 8;
    await bot.handleConnectionUpdate({ qr: "qr-antigo" }, 8);
    const firstExpiry = bot.getSnapshot().qrExpiresAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await bot.handleConnectionUpdate({ qr: "qr-novo" }, 8);

    const snapshot = bot.getSnapshot();
    assert.equal(snapshot.qrCode, "qr-novo");
    assert.equal(snapshot.qrAttempt, 2);
    assert.ok(new Date(snapshot.qrExpiresAt).getTime() > new Date(firstExpiry).getTime());
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("confirmação de leitura remove o QR e salva a sessão imediatamente", async () => {
  const { bot, directory } = createBot();
  try {
    let saves = 0;
    bot.activeConnectionId = 4;
    bot.saveCredsNow = async () => {
      saves += 1;
    };
    await bot.handleConnectionUpdate({ qr: "qr-lido" }, 4);

    await bot.handleConnectionUpdate({ isNewLogin: true }, 4);

    const snapshot = bot.getSnapshot();
    assert.equal(snapshot.qrCode, "");
    assert.equal(snapshot.qrGeneratedAt, undefined);
    assert.equal(snapshot.qrExpiresAt, undefined);
    assert.equal(snapshot.status, "reconnecting");
    assert.equal(saves, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("atualizações próximas da sessão são salvas em série", async () => {
  const { bot, directory } = createBot();
  try {
    let saves = 0;
    let activeSaves = 0;
    let maxActiveSaves = 0;
    let releaseFirst;
    bot.saveCredsNow = async () => {
      saves += 1;
      activeSaves += 1;
      maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      if (saves === 1) {
        await new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      activeSaves -= 1;
    };
    bot.credsSaveDirty = true;
    const first = bot.flushCreds();
    await new Promise((resolve) => setImmediate(resolve));
    bot.scheduleCredsSave();
    const second = bot.flushCreds();
    releaseFirst();

    await Promise.all([first, second]);

    assert.equal(saves, 2);
    assert.equal(maxActiveSaves, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("socket fechado nunca deixa QR vencido visível e persiste antes de reiniciar", async () => {
  const { bot, directory } = createBot();
  try {
    let saves = 0;
    let reconnect;
    bot.activeConnectionId = 6;
    bot.saveCredsNow = async () => {
      saves += 1;
    };
    bot.isRestartRequired = () => true;
    bot.isFatalRuntimeError = () => false;
    bot.isConnectionConflict = () => false;
    bot.isQrRefAttemptLimit = () => false;
    bot.isInvalidSession = () => false;
    bot.scheduleReconnect = (freshQr) => {
      reconnect = freshQr;
    };
    bot.sock = {
      ev: { removeAllListeners: () => undefined },
      end: () => undefined,
      ws: { close: () => undefined }
    };
    await bot.handleConnectionUpdate({ qr: "qr-que-nao-pode-ficar" }, 6);

    await bot.handleConnectionUpdate({
      connection: "close",
      lastDisconnect: { error: new Error("restart required") }
    }, 6);

    const snapshot = bot.getSnapshot();
    assert.equal(snapshot.qrCode, "");
    assert.equal(snapshot.qrExpiresAt, undefined);
    assert.equal(saves, 1);
    assert.equal(reconnect, true);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("regenerar QR apaga tentativa parcial antes de abrir outro socket", async () => {
  const { bot, authDir, directory } = createBot();
  try {
    fs.mkdirSync(authDir, { recursive: true });
    fs.writeFileSync(path.join(authDir, "creds.json"), "{}");
    let stopped = 0;
    let started = 0;
    bot.status = "waiting_qr";
    bot.sock = { authState: { creds: { registered: false } } };
    bot.stop = async () => {
      stopped += 1;
      bot.status = "disconnected";
      bot.sock = undefined;
    };
    bot.start = async () => {
      started += 1;
    };

    await bot.refreshQrCode();

    assert.equal(stopped, 1);
    assert.equal(started, 1);
    assert.equal(fs.existsSync(authDir), false);
    assert.equal(bot.getSnapshot().qrCode, "");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
