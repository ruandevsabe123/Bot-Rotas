const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { useSqliteAuthState } = require("../dist/bot/sqliteAuthState.js");

function helpers(folder, mirror) {
  const read = (file, fallback) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(folder, file), "utf8"));
    } catch {
      return fallback;
    }
  };
  const creds = read("creds.json", { registered: false, token: "new" });
  return {
    BufferJSON: {
      replacer: (_key, value) => value,
      reviver: (_key, value) => value
    },
    proto: {
      Message: {
        AppStateSyncKeyData: {
          fromObject: (value) => ({ ...value, restoredByProto: true })
        }
      }
    },
    useMultiFileAuthState: async () => ({
      state: {
        creds,
        keys: {
          set: async (data) => {
            mirror.keys.push(data);
          }
        }
      },
      saveCreds: async () => {
        mirror.creds.push({ ...creds });
      }
    })
  };
}

test("migra sessão legada, persiste transações e reabre sem perder credenciais", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-sqlite-auth-"));
  const mirror = { keys: [], creds: [] };
  try {
    fs.writeFileSync(path.join(directory, "creds.json"), JSON.stringify({
      registered: true,
      token: "legacy"
    }));
    fs.writeFileSync(path.join(directory, "session-user-1.json"), JSON.stringify({
      session: "one"
    }));
    fs.writeFileSync(path.join(directory, "app-state-sync-key-main.json"), JSON.stringify({
      key: "state"
    }));

    const first = await useSqliteAuthState(directory, helpers(directory, mirror));
    assert.equal(first.backend, "sqlite");
    assert.equal(first.migratedFiles, 2);
    assert.equal(first.state.creds.token, "legacy");

    const session = await first.state.keys.get("session", ["user:1"]);
    assert.deepEqual(session["user:1"], { session: "one" });
    const appState = await first.state.keys.get("app-state-sync-key", ["main"]);
    assert.deepEqual(appState.main, { key: "state", restoredByProto: true });

    await first.state.keys.set({
      session: {
        "user:1": null,
        "user:2": { session: "two" }
      }
    });
    assert.equal((await first.state.keys.get("session", ["user:1"]))["user:1"], undefined);
    assert.deepEqual((await first.state.keys.get("session", ["user:2"]))["user:2"], { session: "two" });

    first.state.creds.token = "sqlite";
    await first.saveCreds();
    await first.flush();
    assert.equal(mirror.keys.length, 1);
    assert.equal(mirror.creds.at(-1).token, "sqlite");
    await first.close();

    const second = await useSqliteAuthState(directory, helpers(directory, mirror));
    assert.equal(second.migratedFiles, 0);
    assert.equal(second.state.creds.token, "sqlite");
    assert.deepEqual((await second.state.keys.get("session", ["user:2"]))["user:2"], { session: "two" });
    await second.close();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
