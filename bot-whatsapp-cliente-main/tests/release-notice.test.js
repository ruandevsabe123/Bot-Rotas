const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PanelUserStore } = require("../dist/panelUserStore.js");
const { getCurrentRelease } = require("../dist/releaseNotes.js");

test("usa o commit do Render como identificador único do deploy", () => {
  const release = getCurrentRelease({
    RENDER_GIT_COMMIT: "abc123deploy",
    APP_RELEASE_ID: "fallback-id"
  });

  assert.equal(release.id, "abc123deploy");
  assert.equal(release.version, "1.4.0");
  assert.ok(release.title);
  assert.ok(release.summary);
  assert.ok(release.changes.length >= 1);
  assert.ok(release.changes.every((change) => change.title && change.description));
});

test("usa identificador configurável fora do Render", () => {
  const release = getCurrentRelease({ APP_RELEASE_ID: "release-manual-42" });
  assert.equal(release.id, "release-manual-42");
});

test("salva por usuário a versão que já foi apresentada", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-release-"));
  const filePath = path.join(directory, "panel_users.json");
  try {
    const store = new PanelUserStore(filePath);
    store.upsert({
      email: "Cliente@Teste.com",
      password: "segredo",
      role: "client"
    });

    const acknowledged = store.acknowledgeRelease("cliente@teste.com", "deploy-001");
    assert.equal(acknowledged.lastSeenReleaseId, "deploy-001");
    assert.ok(acknowledged.lastSeenReleaseAt);

    const reloaded = new PanelUserStore(filePath).all()[0];
    assert.equal(reloaded.lastSeenReleaseId, "deploy-001");
    assert.equal(reloaded.lastSeenReleaseAt, acknowledged.lastSeenReleaseAt);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("não altera outros clientes ao confirmar uma versão", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-release-users-"));
  const filePath = path.join(directory, "panel_users.json");
  try {
    const store = new PanelUserStore(filePath);
    store.upsert({ email: "um@teste.com", password: "1", role: "client" });
    store.upsert({ email: "dois@teste.com", password: "2", role: "client" });

    store.acknowledgeRelease("um@teste.com", "deploy-002");
    const users = store.all();

    assert.equal(users.find((user) => user.email === "um@teste.com").lastSeenReleaseId, "deploy-002");
    assert.equal(users.find((user) => user.email === "dois@teste.com").lastSeenReleaseId, undefined);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
