const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PushNotificationStore } = require("../dist/pushNotificationStore");

test("mantém chaves e assinatura de notificação depois de reiniciar", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-push-"));
  const filePath = path.join(directory, "push_notifications.json");
  try {
    const first = new PushNotificationStore(filePath);
    const publicKey = first.publicKey();
    first.upsert("Cliente@Email.com", "client", {
      endpoint: "https://fcm.googleapis.com/subscription-1",
      expirationTime: null,
      keys: { p256dh: "test-p256dh", auth: "test-auth" }
    });

    const restarted = new PushNotificationStore(filePath);
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    assert.equal(restarted.publicKey(), publicKey);
    assert.equal(persisted.subscriptions.length, 1);
    assert.equal(persisted.subscriptions[0].email, "cliente@email.com");
    assert.equal(persisted.subscriptions[0].role, "client");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("recusa uma assinatura de notificação incompleta", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-push-invalid-"));
  try {
    const store = new PushNotificationStore(path.join(directory, "push_notifications.json"));
    assert.throws(
      () => store.upsert("cliente@email.com", "client", { endpoint: "", expirationTime: null, keys: { p256dh: "", auth: "" } }),
      /inválida/i
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
