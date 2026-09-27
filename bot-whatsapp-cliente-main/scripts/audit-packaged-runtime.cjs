// Checks the native modules actually shipped in the Windows package, without
// starting the UI, connecting WhatsApp or touching application data.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const directory = path.resolve(__dirname, "../release/win-unpacked");
const executable = path.join(directory, "Bot WhatsApp.exe");
const manifest = path.join(directory, "resources/app.asar/package.json");
if (!fs.existsSync(executable)) throw new Error("Run npm run desktop:pack first.");

const script = `
  const assert = require("node:assert/strict");
  const load = require("node:module").createRequire(${JSON.stringify(manifest)});
  const Database = load("better-sqlite3");
  const database = new Database(":memory:");
  assert.equal(database.prepare("SELECT 1 AS ok").get().ok, 1);
  database.close();
  load("sharp")({ create: { width: 2, height: 2, channels: 3, background: "white" } })
    .png().toBuffer()
    .then((png) => {
      assert.ok(png.length > 0);
      console.log("PASS: packaged Electron, SQLite and sharp native modules.");
    })
    .catch((error) => { console.error(error.message); process.exitCode = 1; });
`;
execFileSync(executable, ["-e", script], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
  windowsHide: true,
  timeout: 30_000
});
