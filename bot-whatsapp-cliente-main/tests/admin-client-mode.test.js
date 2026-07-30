const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");

function waitForServer(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Servidor de teste não iniciou a tempo.")), timeoutMs);
    const onData = (chunk) => {
      if (!String(chunk).includes("Painel web:")) return;
      clearTimeout(timeout);
      child.stdout.off("data", onData);
      resolve();
    };
    child.stdout.on("data", onData);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Servidor encerrou antes do teste (${code}).`));
    });
  });
}

async function request(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

test("admin recebe novidades, entra no cliente de teste e volta com segurança", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-admin-client-"));
  const port = 39_000 + (process.pid % 1_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [path.resolve(__dirname, "../dist/server.js")], {
    cwd: path.resolve(__dirname, ".."),
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: directory,
      PANEL_USERS: "admin@teste.com:admin123:admin,cliente.teste@teste.com:client123:client",
      PANEL_ADMIN_EMAILS: "admin@teste.com",
      PANEL_SESSION_SECRET: "integration-session-secret",
      APP_RELEASE_ID: "deploy-admin-mode-test",
      DAILY_SESSION_RESET_ENABLED: "false",
      NODE_ENV: "production"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  try {
    await waitForServer(child);
    const login = await request(baseUrl, "/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "admin@teste.com", password: "admin123" })
    });
    assert.equal(login.status, 200);
    const adminHeaders = {
      "content-type": "application/json",
      "x-panel-token": login.data.token
    };

    const adminRelease = await request(baseUrl, "/api/release", { headers: adminHeaders });
    assert.equal(adminRelease.status, 200);
    assert.equal(adminRelease.data.shouldShow, true);

    const acknowledge = await request(baseUrl, "/api/release/acknowledge", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ releaseId: adminRelease.data.release.id })
    });
    assert.equal(acknowledge.status, 200);

    const impersonation = await request(baseUrl, "/api/admin/impersonate", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ email: "cliente.teste@teste.com" })
    });
    assert.equal(impersonation.status, 200);
    assert.equal(impersonation.data.user.role, "client");
    assert.equal(impersonation.data.user.impersonatedBy, "admin@teste.com");

    const clientHeaders = {
      "content-type": "application/json",
      "x-panel-token": impersonation.data.token
    };
    const clientMe = await request(baseUrl, "/api/me", { headers: clientHeaders });
    assert.equal(clientMe.data.email, "cliente.teste@teste.com");
    assert.equal(clientMe.data.role, "client");
    assert.equal(clientMe.data.impersonatedBy, "admin@teste.com");

    const forbidden = await request(baseUrl, "/api/admin/impersonate", {
      method: "POST",
      headers: clientHeaders,
      body: JSON.stringify({ email: "cliente.teste@teste.com" })
    });
    assert.equal(forbidden.status, 403);

    const returned = await request(baseUrl, "/api/impersonation/return", {
      method: "POST",
      headers: clientHeaders,
      body: "{}"
    });
    assert.equal(returned.status, 200);
    assert.equal(returned.data.user.role, "admin");

    const returnedMe = await request(baseUrl, "/api/me", {
      headers: { "x-panel-token": returned.data.token }
    });
    assert.equal(returnedMe.data.email, "admin@teste.com");
    assert.equal(returnedMe.data.role, "admin");
    assert.equal(returnedMe.data.impersonatedBy, undefined);
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      child.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
