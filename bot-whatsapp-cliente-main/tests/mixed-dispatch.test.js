const test = require("node:test");
const assert = require("node:assert/strict");
const { DispatchRaceCoordinator } = require("../dist/services/dispatchRaceCoordinator.js");
const { computeConditionalDispatchBlockers, computeConditionalDispatchPriorities } = require("../dist/services/conditionalDispatchPriority.js");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const groupKey = "mixed-group@g.us";
function client(email, targetDispatchMode, matchups = []) {
  return { email, targetDispatchMode, matchups, configuredLevel: 0, connected: true,
    monitoringEnabled: true, monitoringMode: "target", targetGroupKey: groupKey };
}

function request(coordinator, blockers, email, eventKey) {
  return coordinator.request({ clientEmail: email, groupKey, eventDetectedAt: Date.now(), eventKey,
    blockers: blockers.get(email) || [] });
}

function announce(coordinator, email, eventKey, state) {
  coordinator.announce({ clientEmail: email, groupKey, eventDetectedAt: Date.now(), eventKey, state });
}

test("3 clientes: abertura envia sem aguardar IA e as duas IAs preservam sua prioridade", async () => {
  const clients = [
    client("target@teste.com", "manual", [{ opponentEmail: "ai-a@teste.com", outcome: "loses", delayMs: 400 },
      { opponentEmail: "ai-b@teste.com", outcome: "wins", delayMs: 400 }]),
    client("ai-a@teste.com", "ocr", [{ opponentEmail: "ai-b@teste.com", outcome: "wins", delayMs: 400 }]),
    client("ai-b@teste.com", "ocr")
  ];
  const blockers = computeConditionalDispatchBlockers(clients);
  const priorities = computeConditionalDispatchPriorities(clients);
  assert.deepEqual(blockers.get("target@teste.com"), []);
  assert.deepEqual(blockers.get("ai-a@teste.com"), []);
  assert.deepEqual(blockers.get("ai-b@teste.com"), [{ email: "ai-a@teste.com", delayMs: 400, strict: true }]);
  assert.equal(priorities.get("target@teste.com"), 0);
  assert.equal(priorities.get("ai-b@teste.com"), 400);

  const coordinator = new DispatchRaceCoordinator(2_000, 1_500, 10);
  const keepAlive = setInterval(() => {}, 100);
  try {
    announce(coordinator, "ai-a@teste.com", "same-image", "processing");
    announce(coordinator, "ai-b@teste.com", "same-image", "ready");
    let aiBReleased = false;
    const aiB = request(coordinator, blockers, "ai-b@teste.com", "same-image").then((grant) => {
      aiBReleased = true;
      return grant;
    });
    const target = await request(coordinator, blockers, "target@teste.com");
    assert.equal(target.waitedMs, 0);
    assert.equal(aiBReleased, false);
    assert.equal(coordinator.confirmRelay(target.token, "target@teste.com"), true);
    await delay(25);
    assert.equal(aiBReleased, false);
    const aiA = await request(coordinator, blockers, "ai-a@teste.com", "same-image");
    const relayedAt = Date.now();
    coordinator.confirmRelay(aiA.token, "ai-a@teste.com", relayedAt);
    await aiB;
    assert.ok(Date.now() - relayedAt >= 390, "configured lead must be preserved");
  } finally { clearInterval(keepAlive); }
});

test("IA sem bairro elegivel libera outra IA mesmo com confronto estrito", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 500, 10);
  announce(coordinator, "ai-a@teste.com", "no-preferred-neighborhood", "processing");
  const waiting = coordinator.request({ clientEmail: "ai-b@teste.com", groupKey, eventDetectedAt: Date.now(),
    eventKey: "no-preferred-neighborhood", blockers: [{ email: "ai-a@teste.com", delayMs: 400, strict: true }] });
  announce(coordinator, "ai-a@teste.com", "no-preferred-neighborhood", "unavailable");
  const grant = await waiting;
  assert.ok(grant.token);
  assert.ok(grant.waitedMs < 400);
});

test("analise de outra imagem nao prende uma disputa estrita, inclusive anuncio tardio", async () => {
  for (const announceBeforeRequest of [true, false]) {
    const coordinator = new DispatchRaceCoordinator(2_000, 500, 10);
    if (announceBeforeRequest) announce(coordinator, "ai-a@teste.com", "other-image", "processing");
    const pending = coordinator.request({ clientEmail: "ai-b@teste.com", groupKey, eventDetectedAt: Date.now(),
      eventKey: "my-image", blockers: [{ email: "ai-a@teste.com", delayMs: 400, strict: true }] });
    if (!announceBeforeRequest) announce(coordinator, "ai-a@teste.com", "other-image", "processing");
    assert.ok((await pending).token);
  }
});

test("anuncio atrasado nao apaga relay confirmado", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 500, 10);
  const winner = await coordinator.request({ clientEmail: "ai-a@teste.com", groupKey, eventDetectedAt: Date.now(),
    eventKey: "confirmed-image", blockers: [] });
  coordinator.confirmRelay(winner.token, "ai-a@teste.com");
  announce(coordinator, "ai-a@teste.com", "confirmed-image", "processing");
  const cycle = coordinator.cycleByToken.get(winner.token);
  assert.equal(cycle.participantStates.get("ai-a@teste.com"), "relayed");
});

test("grupo fechado por mais de 3 minutos preserva ready e ausencia de bairro", async () => {
  const clients = [
    client("ai-a@teste.com", "ocr", [{ opponentEmail: "ai-b@teste.com", outcome: "wins", delayMs: 400 }]),
    client("ai-b@teste.com", "ocr")
  ];
  const blockers = computeConditionalDispatchBlockers(clients);
  const coordinator = new DispatchRaceCoordinator(2_000, 500, 10);
  announce(coordinator, "ai-a@teste.com", "closed-group-image", "unavailable");
  announce(coordinator, "ai-b@teste.com", "closed-group-image", "ready");
  const cycle = [...coordinator.cycles.values()][0];
  cycle.createdAt = Date.now() - 240_000;
  // An unrelated opening forces regular pruning while the image group is closed.
  await coordinator.request({ clientEmail: "other@teste.com", groupKey: "other@g.us", eventDetectedAt: Date.now(), blockers: [] });
  assert.equal(coordinator.cycles.has(cycle.id), true);
  const grant = await request(coordinator, blockers, "ai-b@teste.com", "closed-group-image");
  assert.ok(grant.token);
  assert.equal(cycle.participantStates.get("ai-a@teste.com"), "unavailable");
});

test("pedido pronto de imagem diferente libera espera sem exigir anuncio previo", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 500, 10);
  const pending = coordinator.request({ clientEmail: "ai-b@teste.com", groupKey, eventDetectedAt: Date.now(),
    eventKey: "my-image", blockers: [{ email: "ai-a@teste.com", delayMs: 400, strict: true }] });
  await coordinator.request({ clientEmail: "ai-a@teste.com", groupKey, eventDetectedAt: Date.now(),
    eventKey: "other-image", blockers: [] });
  assert.ok((await pending).token);
});

test("imagem substituida pode ser removida sem perder o estado mais recente", () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 500, 10);
  const initialAt = Date.now();
  coordinator.announce({ clientEmail: "ai-a@teste.com", groupKey, eventDetectedAt: initialAt, eventKey: "old-image", state: "ready" });
  const oldCycle = [...coordinator.cycles.values()][0];
  oldCycle.createdAt = initialAt - 240_000;
  coordinator.announce({ clientEmail: "ai-a@teste.com", groupKey, eventDetectedAt: initialAt + 100, eventKey: "new-image", state: "processing" });
  // A late finally from the older analysis must not replace the latest image.
  coordinator.announce({ clientEmail: "ai-a@teste.com", groupKey, eventDetectedAt: initialAt, eventKey: "old-image", state: "unavailable" });
  coordinator.announce({ clientEmail: "other@teste.com", groupKey: "other@g.us", eventDetectedAt: initialAt + 200, eventKey: "unrelated", state: "processing" });
  assert.equal(coordinator.cycles.has(oldCycle.id), false);
  const latest = coordinator.cycles.get(coordinator.latestImageCycleByClient.get("ai-a@teste.com"));
  assert.equal(latest.eventKey, "new-image");
});
