const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { TelemetryStore } = require("../dist/bot/telemetryStore.js");

test("estatísticas recentes separam confirmação, aquecimento e tentativas", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-telemetry-"));
  const store = new TelemetryStore(path.join(directory, "telemetry.json"));
  const timeline = (input) => ({
    eventDetectedAt: new Date().toISOString(),
    sendStartedAt: new Date().toISOString(),
    detectionDelayMs: 0,
    firstRelayCallMs: input.relay,
    firstAckMs: input.ack,
    firstGroupEchoMs: input.echo,
    totalDurationMs: input.total,
    internalWarmState: input.warm,
    timeoutUsed: input.timeout || false,
    retryUsed: input.retry || false,
    notAcceptableCount: input.notAcceptable || 0,
    mode: "race",
    events: []
  });

  store.record({ clientEmail: "cliente@teste.com", mode: "target", confirmed: 2, total: 2, timeline: timeline({ relay: 10, ack: 120, echo: 180, total: 210, warm: "ready" }) });
  store.record({ clientEmail: "cliente@teste.com", mode: "target", confirmed: 1, total: 2, timeline: timeline({ relay: 20, ack: 300, echo: 360, total: 420, warm: "cold", timeout: true, retry: true, notAcceptable: 1 }) });

  const summary = store.summary();
  assert.equal(summary.count, 2);
  assert.equal(summary.averageFirstRelayMs, 15);
  assert.equal(summary.p95FirstAckMs, 300);
  assert.equal(summary.averageFirstGroupEchoMs, 270);
  assert.equal(summary.averageTotalDurationMs, 315);
  assert.equal(summary.successRate, 75);
  assert.equal(summary.warmDispatchCount, 1);
  assert.equal(summary.coldDispatchCount, 1);
  assert.equal(summary.timeoutCount, 1);
  assert.equal(summary.retryCount, 1);
  assert.equal(summary.notAcceptableCount, 1);
});
