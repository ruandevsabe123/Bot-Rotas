const test = require("node:test");
const assert = require("node:assert/strict");
const { computeConditionalDispatchPriorities } = require("../dist/services/conditionalDispatchPriority.js");

function client(email, beatsEmail, overrides = {}) {
  return {
    email,
    configuredLevel: 0,
    beatsEmail,
    connected: true,
    monitoringEnabled: true,
    monitoringMode: "target",
    targetGroupKey: "rotas@g.us",
    ...overrides
  };
}

test("cliente sozinho nunca recebe atraso de prioridade", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("guilherme@cliente.com", "alan@cliente.com")
  ]);

  assert.equal(priorities.get("guilherme@cliente.com"), 0);
});

test("Alan ganha vantagem somente quando ambos competem no mesmo grupo", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("alan@cliente.com", "guilherme@cliente.com"),
    client("guilherme@cliente.com", undefined)
  ]);

  assert.equal(priorities.get("alan@cliente.com"), 0);
  assert.equal(priorities.get("guilherme@cliente.com"), 1);
});

test("não altera clientes desconectados, parados ou em outro grupo", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("alan@cliente.com", "guilherme@cliente.com"),
    client("guilherme@cliente.com", undefined, { monitoringEnabled: false }),
    client("outro@cliente.com", "alan@cliente.com", { targetGroupKey: "outro@g.us" })
  ]);

  assert.equal(priorities.get("alan@cliente.com"), 0);
  assert.equal(priorities.get("guilherme@cliente.com"), 0);
  assert.equal(priorities.get("outro@cliente.com"), 0);
});

test("confronto invertido nunca anula o vencedor configurado por último", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("alan@cliente.com", "guilherme@cliente.com", { priorityUpdatedAt: "2026-08-12T22:00:00.000Z" }),
    client("guilherme@cliente.com", "alan@cliente.com", { priorityUpdatedAt: "2026-08-12T21:00:00.000Z" })
  ]);

  assert.equal(priorities.get("alan@cliente.com"), 0);
  assert.equal(priorities.get("guilherme@cliente.com"), 1);
});
