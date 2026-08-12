const test = require("node:test");
const assert = require("node:assert/strict");
const { computeConditionalDispatchPriorities } = require("../dist/services/conditionalDispatchPriority.js");

function client(email, configuredLevel, overrides = {}) {
  return {
    email,
    configuredLevel,
    connected: true,
    monitoringEnabled: true,
    monitoringMode: "target",
    targetGroupKey: "rotas@g.us",
    ...overrides
  };
}

test("cliente sozinho nunca recebe atraso de prioridade", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("guilherme@cliente.com", 2)
  ]);

  assert.equal(priorities.get("guilherme@cliente.com"), 0);
});

test("Alan ganha vantagem somente quando ambos competem no mesmo grupo", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("alan@cliente.com", 0),
    client("guilherme@cliente.com", 1)
  ]);

  assert.equal(priorities.get("alan@cliente.com"), 0);
  assert.equal(priorities.get("guilherme@cliente.com"), 1);
});

test("não altera clientes desconectados, parados ou em outro grupo", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("alan@cliente.com", 0),
    client("guilherme@cliente.com", 3, { monitoringEnabled: false }),
    client("outro@cliente.com", 2, { targetGroupKey: "outro@g.us" })
  ]);

  assert.equal(priorities.get("alan@cliente.com"), 0);
  assert.equal(priorities.get("guilherme@cliente.com"), 0);
  assert.equal(priorities.get("outro@cliente.com"), 0);
});
