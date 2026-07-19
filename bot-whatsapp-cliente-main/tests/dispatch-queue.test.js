const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DispatchQueueStore } = require("../dist/bot/dispatchQueue.js");

function createStore() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-dispatch-queue-"));
  return { directory, filePath: path.join(directory, "queue.json") };
}

test("bloqueia reenvio equivalente após reinício enquanto o grupo continua aberto", () => {
  const { directory, filePath } = createStore();
  try {
    const first = new DispatchQueueStore(filePath);
    const item = first.enqueue({
      id: "dispatch-1",
      cycleId: 1,
      clientEmail: "cliente@teste.com",
      jid: "motoristas@g.us",
      messages: ["Cliente F-14"],
      trigger: "automatic",
      mode: "target"
    });
    first.markSending(item.id, "route-1");
    first.markFinished(item.id, "sent", 1);
    first.flush();

    const restarted = new DispatchQueueStore(filePath);
    assert.equal(restarted.hasRecentEquivalent("motoristas@g.us", ["Cliente F-14"]), true);
    assert.equal(restarted.hasRecentEquivalent("motoristas@g.us", ["Cliente H-34"]), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("libera assinatura antiga e não bloqueia disparo que falhou", () => {
  const { directory, filePath } = createStore();
  try {
    const store = new DispatchQueueStore(filePath);
    const item = store.enqueue({
      id: "dispatch-failed",
      cycleId: 2,
      clientEmail: "cliente@teste.com",
      jid: "motoristas@g.us",
      messages: ["Cliente F-14"],
      trigger: "automatic",
      mode: "target"
    });
    store.markFinished(item.id, "failed", 0);

    assert.equal(store.hasRecentEquivalent("motoristas@g.us", ["Cliente F-14"]), false);
    assert.equal(store.hasRecentEquivalent("motoristas@g.us", ["Outra rota"], 1, Date.now() + 10), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
