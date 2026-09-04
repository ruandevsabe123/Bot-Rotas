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

test("cliente armado sem intenção real de envio não prende o outro", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000, 25);
  const startedAt = Date.now();
  const grant = await coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt: startedAt,
    eventKey: "imagem-sem-rota-no-outro",
    blockers: [{ email: "alan@teste.com", delayMs: 400 }]
  });

  assert.ok(grant.token);
  assert.ok(Date.now() - startedAt >= 20);
  assert.ok(Date.now() - startedAt < 500);
});

test("falha definitiva do primeiro envio libera o cliente de contingência", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000, 100);
  const eventDetectedAt = Date.now();
  const winner = await coordinator.request({
    clientEmail: "alan@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-compartilhada",
    blockers: []
  });
  const loser = coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-compartilhada",
    blockers: [{ email: "alan@teste.com", delayMs: 400 }]
  });

  assert.equal(coordinator.failRelay(winner.token, "alan@teste.com"), true);
  const fallback = await loser;
  assert.ok(fallback.token);
  assert.ok(fallback.waitedMs < 400);
});

test("imagens diferentes nunca compartilham a confirmação da disputa", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000, 30);
  const eventDetectedAt = Date.now();
  const unrelatedWinner = await coordinator.request({
    clientEmail: "alan@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-a",
    blockers: []
  });
  coordinator.confirmRelay(unrelatedWinner.token, "alan@teste.com");

  const startedAt = Date.now();
  await coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt: eventDetectedAt + 5,
    eventKey: "imagem-b",
    blockers: [{ email: "alan@teste.com", delayMs: 400 }]
  });
  assert.ok(Date.now() - startedAt >= 25);
  assert.ok(Date.now() - startedAt < 400);
});

test("queda do processo principal libera a contingência sem esperar timeout", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000, 100);
  const eventDetectedAt = Date.now();
  await coordinator.request({
    clientEmail: "alan@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-com-queda",
    blockers: []
  });
  const fallback = coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-com-queda",
    blockers: [{ email: "alan@teste.com", delayMs: 400 }]
  });

  coordinator.cancelClient("alan@teste.com");
  assert.ok((await fallback).token);
});

test("análise ativa da mesma imagem mantém a ordem sem depender da velocidade", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000, 20);
  const eventDetectedAt = Date.now();
  coordinator.announce({
    clientEmail: "alan@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-em-analise",
    state: "processing"
  });
  let released = false;
  const fallback = coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-em-analise",
    blockers: [{ email: "alan@teste.com", delayMs: 400 }]
  }).then((grant) => {
    released = true;
    return grant;
  });

  await delay(45);
  assert.equal(released, false);
  coordinator.announce({
    clientEmail: "alan@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-em-analise",
    state: "unavailable"
  });
  assert.ok((await fallback).token);
  assert.equal(released, true);
});
