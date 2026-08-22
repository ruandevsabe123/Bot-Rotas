const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PanelUserStore } = require("../dist/panelUserStore.js");

test("persiste múltiplos confrontos e permite zerar todos", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-matchups-"));
  const filePath = path.join(directory, "users.json");
  try {
    const store = new PanelUserStore(filePath);
    store.upsert({
      email: "alan@cliente.com",
      password: "teste",
      dispatchMatchups: [
        { opponentEmail: "guilherme@cliente.com", outcome: "wins", delayMs: 400 },
        { opponentEmail: "terceiro@cliente.com", outcome: "loses", delayMs: 650 }
      ]
    });
    assert.equal(new PanelUserStore(filePath).all()[0].dispatchMatchups.length, 2);

    store.upsert({ email: "alan@cliente.com", dispatchMatchups: [] });
    assert.deepEqual(new PanelUserStore(filePath).all()[0].dispatchMatchups, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("migra confronto único antigo para a nova lista", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-legacy-"));
  const filePath = path.join(directory, "users.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify([{
      email: "alan@cliente.com",
      password: "teste",
      role: "client",
      dispatchBeatsEmail: "guilherme@cliente.com",
      dispatchAdvantageMs: 500
    }]));
    assert.deepEqual(new PanelUserStore(filePath).all()[0].dispatchMatchups, [{
      opponentEmail: "guilherme@cliente.com",
      outcome: "wins",
      delayMs: 500
    }]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
