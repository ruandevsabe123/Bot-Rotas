const test = require("node:test");
const assert = require("node:assert/strict");
const { computeConditionalDispatchBlockers, computeConditionalDispatchPriorities } = require("../dist/services/conditionalDispatchPriority.js");

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
  assert.equal(priorities.get("guilherme@cliente.com"), 400);
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
  assert.equal(priorities.get("guilherme@cliente.com"), 400);
});

test("aplica ao perdedor a vantagem configurada pelo vencedor", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("alan@cliente.com", "guilherme@cliente.com", { advantageMs: 850 }),
    client("guilherme@cliente.com", undefined)
  ]);

  assert.equal(priorities.get("alan@cliente.com"), 0);
  assert.equal(priorities.get("guilherme@cliente.com"), 850);
});

test("não ganha de ninguém não atrasa nenhum cliente", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("alan@cliente.com", undefined, { advantageMs: 900 }),
    client("guilherme@cliente.com", undefined)
  ]);

  assert.equal(priorities.get("alan@cliente.com"), 0);
  assert.equal(priorities.get("guilherme@cliente.com"), 0);
});

test("calcula hierarquia cumulativa para cinco clientes", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("a@cliente.com", undefined, { matchups: [{ opponentEmail: "b@cliente.com", outcome: "wins", delayMs: 400 }] }),
    client("b@cliente.com", undefined, { matchups: [{ opponentEmail: "c@cliente.com", outcome: "wins", delayMs: 450 }] }),
    client("c@cliente.com", undefined, { matchups: [{ opponentEmail: "d@cliente.com", outcome: "wins", delayMs: 500 }] }),
    client("d@cliente.com", undefined, { matchups: [{ opponentEmail: "e@cliente.com", outcome: "wins", delayMs: 550 }] }),
    client("e@cliente.com", undefined)
  ]);

  assert.deepEqual(Object.fromEntries(priorities), {
    "a@cliente.com": 0,
    "b@cliente.com": 400,
    "c@cliente.com": 850,
    "d@cliente.com": 1350,
    "e@cliente.com": 1900
  });
});

test("regra perde para produz o mesmo confronto de forma intuitiva", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("alan@cliente.com", undefined),
    client("guilherme@cliente.com", undefined, { matchups: [{ opponentEmail: "alan@cliente.com", outcome: "loses", delayMs: 400 }] })
  ]);
  assert.equal(priorities.get("alan@cliente.com"), 0);
  assert.equal(priorities.get("guilherme@cliente.com"), 400);
});

test("informa ao coordenador exatamente qual vencedor bloqueia cada perdedor", () => {
  const clients = [
    client("alan@cliente.com", undefined, { matchups: [{ opponentEmail: "guilherme@cliente.com", outcome: "wins", delayMs: 450 }] }),
    client("guilherme@cliente.com", undefined)
  ];
  const blockers = computeConditionalDispatchBlockers(clients);

  assert.deepEqual(blockers.get("alan@cliente.com"), []);
  assert.deepEqual(blockers.get("guilherme@cliente.com"), [{ email: "alan@cliente.com", delayMs: 450, strict: true }]);
});

test("hierarquia bloqueia cada cliente pelo vencedor imediatamente anterior", () => {
  const blockers = computeConditionalDispatchBlockers([
    client("a@cliente.com", undefined, { matchups: [{ opponentEmail: "b@cliente.com", outcome: "wins", delayMs: 400 }] }),
    client("b@cliente.com", undefined, { matchups: [{ opponentEmail: "c@cliente.com", outcome: "wins", delayMs: 500 }] }),
    client("c@cliente.com", undefined)
  ]);

  assert.deepEqual(blockers.get("b@cliente.com"), [{ email: "a@cliente.com", delayMs: 400, strict: true }]);
  assert.deepEqual(blockers.get("c@cliente.com"), [{ email: "b@cliente.com", delayMs: 500, strict: true }]);
});

test("ignora a regra que fecharia um ciclo entre clientes", () => {
  const priorities = computeConditionalDispatchPriorities([
    client("a@cliente.com", undefined, { priorityUpdatedAt: "2026-08-21T12:03:00.000Z", matchups: [{ opponentEmail: "b@cliente.com", outcome: "wins", delayMs: 400 }] }),
    client("b@cliente.com", undefined, { priorityUpdatedAt: "2026-08-21T12:02:00.000Z", matchups: [{ opponentEmail: "c@cliente.com", outcome: "wins", delayMs: 400 }] }),
    client("c@cliente.com", undefined, { priorityUpdatedAt: "2026-08-21T12:01:00.000Z", matchups: [{ opponentEmail: "a@cliente.com", outcome: "wins", delayMs: 400 }] })
  ]);

  assert.deepEqual(Object.fromEntries(priorities), {
    "a@cliente.com": 0,
    "b@cliente.com": 400,
    "c@cliente.com": 800
  });
});
