const test = require("node:test");
const assert = require("node:assert/strict");
const { DispatchRaceCoordinator } = require("../dist/services/dispatchRaceCoordinator.js");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("perdedor só é liberado depois do relay do vencedor e da diferença configurada", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000);
  const eventDetectedAt = Date.now();
  const winner = await coordinator.request({ clientEmail: "alan@teste.com", groupKey: "grupo@g.us", eventDetectedAt, blockers: [] });
  let loserReleased = false;
  const loserPromise = coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt: eventDetectedAt + 20,
    blockers: [{ email: "alan@teste.com", delayMs: 35 }]
  }).then((grant) => {
    loserReleased = true;
    return grant;
  });

  await delay(15);
  assert.equal(loserReleased, false);
  const relayedAt = Date.now();
  assert.equal(coordinator.confirmRelay(winner.token, "alan@teste.com", relayedAt), true);
  const loser = await loserPromise;
  assert.equal(loserReleased, true);
  assert.ok(Date.now() - relayedAt >= 30);
  assert.ok(loser.waitedMs >= 30);
});

test("perdedor continua bloqueado quando o vencedor não confirma o relay", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 35);
  const eventDetectedAt = Date.now();
  await coordinator.request({ clientEmail: "alan@teste.com", groupKey: "grupo@g.us", eventDetectedAt, blockers: [] });

  await assert.rejects(
    coordinator.request({
      clientEmail: "guilherme@teste.com",
      groupKey: "grupo@g.us",
      eventDetectedAt,
      blockers: [{ email: "alan@teste.com", delayMs: 5 }]
    }),
    /ciclo do grupo expirou/
  );
});

test("internet mais rápida do perdedor não o libera antes do vencedor chegar", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000);
  const eventDetectedAt = Date.now();
  let loserReleased = false;
  const loserPromise = coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    blockers: [{ email: "alan@teste.com", delayMs: 10 }]
  }).then((grant) => {
    loserReleased = true;
    return grant;
  });

  await delay(20);
  assert.equal(loserReleased, false);
  const winner = await coordinator.request({ clientEmail: "alan@teste.com", groupKey: "grupo@g.us", eventDetectedAt: eventDetectedAt + 100, blockers: [] });
  coordinator.confirmRelay(winner.token, "alan@teste.com");
  await loserPromise;
  assert.equal(loserReleased, true);
});
