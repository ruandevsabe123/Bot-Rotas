const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ImageUsageStore } = require("../dist/imageUsageStore.js");
const { RouteStore } = require("../dist/bot/routeStore.js");

function tempFile(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bot-usage-test-"));
  return path.join(dir, name);
}

test("contabiliza somente análises aprovadas e mantém testes excluídos", () => {
  const store = new ImageUsageStore(tempFile("usage.json"));
  store.setDefaultAmount("cliente@teste.com", 750);
  store.record({ id: "foto-1", clientEmail: "cliente@teste.com", messageId: "1", result: "detected", gaiola: "F-14" });
  store.record({ id: "foto-2", clientEmail: "cliente@teste.com", messageId: "2", result: "unreadable" });
  store.decide("foto-1", "billable", "admin@teste.com", 900);
  store.decide("foto-2", "excluded", "admin@teste.com");

  const clientSnapshot = store.clientSnapshot("cliente@teste.com");
  assert.equal(clientSnapshot.amountCents, 900);
  assert.deepEqual(Object.keys(clientSnapshot).sort(), ["amountCents", "month"]);
});

test("não duplica consumo quando o mesmo evento de imagem chega novamente", () => {
  const store = new ImageUsageStore(tempFile("usage.json"));
  const input = { id: "foto-repetida", clientEmail: "cliente@teste.com", messageId: "1", result: "detected" };
  store.record(input);
  store.record(input);
  assert.equal(store.snapshot().totals.total, 1);
});

test("recupera histórico de rotas pelo backup se o arquivo principal ficar inválido", () => {
  const filePath = tempFile("routes.json");
  const store = new RouteStore(filePath);
  store.create({
    id: "rota-1",
    clientEmail: "cliente@teste.com",
    groupJid: "grupo@g.us",
    groupName: "Motoristas",
    mode: "target",
    trigger: "automatic",
    messages: ["Rota F-14"],
    sentMessageIds: [],
    confirmedCount: 0,
    totalCount: 1,
    status: "sending"
  });
  store.flush();
  store.validate("rota-1", "admin@teste.com");
  store.flush();
  fs.writeFileSync(filePath, "{arquivo interrompido");

  const recovered = new RouteStore(filePath).all();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].id, "rota-1");
});
