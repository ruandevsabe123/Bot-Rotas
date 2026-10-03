const test = require("node:test");
const assert = require("node:assert/strict");
const { DispatchRaceCoordinator } = require("../dist/services/dispatchRaceCoordinator.js");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("pedido repetido no mesmo ciclo compartilha promessa e token", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000, 10);
  const request = {
    clientEmail: "loser@teste.com", groupKey: "grupo@g.us", eventDetectedAt: Date.now(),
    eventKey: "pedido-duplicado", blockers: [{ email: "winner@teste.com", delayMs: 0, strict: true }]
  };
  const first = coordinator.request(request);
  const second = coordinator.request(request);
  assert.equal(first, second);
  const winner = await coordinator.request({ ...request, clientEmail: "winner@teste.com", blockers: [] });
  coordinator.confirmRelay(winner.token, "winner@teste.com");
  const [firstGrant, secondGrant] = await Promise.all([first, second]);
  assert.equal(firstGrant.token, secondGrant.token);
  assert.equal((await coordinator.request(request)).token, firstGrant.token);
  assert.equal(coordinator.cycleByToken.size, 2);
});

test("timeout de pedido duplicado encerra todos os consumidores", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 20, 5);
  const request = {
    clientEmail: "loser@teste.com", groupKey: "grupo@g.us", eventDetectedAt: Date.now(),
    eventKey: "duplicado-expirado", blockers: [{ email: "winner@teste.com", delayMs: 0, strict: true }]
  };
  const first = assert.rejects(coordinator.request(request), /expirou/);
  const second = assert.rejects(coordinator.request(request), /expirou/);
  // Confirme que os dois consumidores observam o mesmo timeout.
  await Promise.all([first, second, delay(35)]);
  assert.equal(coordinator.cycleByToken.size, 1);
});

test("pedido repetido do vencedor preserva confirmação usada pelo perdedor", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000, 10);
  const request = {
    clientEmail: "winner@teste.com", groupKey: "grupo@g.us", eventDetectedAt: Date.now(),
    eventKey: "vencedor-repetido", blockers: []
  };
  const winner = await coordinator.request(request);
  coordinator.confirmRelay(winner.token, request.clientEmail);
  assert.equal((await coordinator.request(request)).token, winner.token);
  const loser = coordinator.request({ ...request, clientEmail: "loser@teste.com", blockers: [{ email: request.clientEmail, delayMs: 0, strict: true }] });
  const [grant] = await Promise.all([loser, delay(10)]);
  assert.ok(grant.token);
});

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

test("confronto estrito espera o vencedor mesmo quando ele entra depois da janela curta", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 1_000, 20);
  const eventDetectedAt = Date.now();
  let loserReleased = false;
  const loser = coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-estrita",
    blockers: [{ email: "alan@teste.com", delayMs: 35, strict: true }]
  }).then((grant) => {
    loserReleased = true;
    return grant;
  });

  await delay(60);
  assert.equal(loserReleased, false);
  const winner = await coordinator.request({
    clientEmail: "alan@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt: eventDetectedAt + 60,
    eventKey: "imagem-estrita",
    blockers: []
  });
  assert.equal(coordinator.confirmRelay(winner.token, "alan@teste.com"), true);
  const grant = await loser;
  assert.equal(loserReleased, true);
  assert.ok(grant.waitedMs >= 85);
});

test("confronto estrito não libera o perdedor quando o vencedor falha", async () => {
  const coordinator = new DispatchRaceCoordinator(2_000, 90, 10);
  const eventDetectedAt = Date.now();
  const winner = await coordinator.request({
    clientEmail: "alan@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-com-falha-estrita",
    blockers: []
  });
  const loser = coordinator.request({
    clientEmail: "guilherme@teste.com",
    groupKey: "grupo@g.us",
    eventDetectedAt,
    eventKey: "imagem-com-falha-estrita",
    blockers: [{ email: "alan@teste.com", delayMs: 35, strict: true }]
  });

  assert.equal(coordinator.failRelay(winner.token, "alan@teste.com"), true);
  await assert.rejects(loser, /expirou/i);
});
