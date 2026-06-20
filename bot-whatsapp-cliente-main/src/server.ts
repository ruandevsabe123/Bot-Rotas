import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import crypto from "crypto";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { BotService } from "./bot/connection";

const port = Number(process.env.PORT || 3000);
const dataDir = path.resolve(process.env.DATA_DIR || process.cwd());
const authDir = path.join(dataDir, "auth_info");
const configPath = path.join(dataDir, "config.json");
const panelEmail = String(process.env.PANEL_EMAIL || "alanrobot@gmail.com").trim().toLowerCase();
const panelPassword = String(process.env.PANEL_PASSWORD || "senhanova");
const staticDir = path.resolve(process.cwd(), "dist", "desktop", "renderer");
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 180;
const KEEP_ALIVE_INTERVAL_MS = 1000 * 60 * 10;

function parsePanelUsers(envUsers: string | undefined, defaultEmail: string, defaultPassword: string) {
  const users = new Map<string, string>();
  const raw = String(envUsers || `${defaultEmail}:${defaultPassword}`).trim();
  for (const part of raw.split(",").map((item) => item.trim()).filter(Boolean)) {
    const [email, password] = part.split(":").map((item) => item.trim());
    if (!email || !password) continue;
    users.set(email.toLowerCase(), password);
  }
  if (users.size === 0) {
    users.set(defaultEmail.toLowerCase(), defaultPassword);
  }
  return users;
}

const panelUsers = parsePanelUsers(
  process.env.PANEL_USERS || process.env.PANEL_USER || process.env.PAINEL_USER,
  panelEmail,
  panelPassword
);
const panelSessionSecret = process.env.PANEL_SESSION_SECRET || Array.from(panelUsers.values())[0] || panelPassword;
const keepAliveUrl =
  process.env.KEEP_ALIVE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  (process.env.RENDER_EXTERNAL_HOSTNAME ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}` : "");

console.log("Painel de usuários habilitados:", Array.from(panelUsers.keys()).join(", "));

fs.mkdirSync(dataDir, { recursive: true });

const bot = new BotService({
  authDir,
  configPath,
  pairingPhoneNumber: process.env.BOT_PHONE_NUMBER || "",
  autoClearInvalidSession: true
});

const clients = new Set<http.ServerResponse>();
let lastQrCode = "";
let lastLogId = "";

function sendJson(response: http.ServerResponse, statusCode: number, data: unknown) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function readJsonBody<T = any>(request: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Payload muito grande."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body.trim()) return resolve({} as T);
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function base64Url(input: string) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload: string) {
  return crypto.createHmac("sha256", panelSessionSecret).update(payload).digest("base64url");
}

function createSessionToken(email: string) {
  const payload = base64Url(JSON.stringify({ email, exp: Date.now() + SESSION_TTL_MS }));
  return `${payload}.${signPayload(payload)}`;
}

function verifySessionToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = signPayload(payload);
  if (signature.length !== expected.length) return false;

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return false;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    return parsed.email && panelUsers.has(parsed.email.toLowerCase()) && Number(parsed.exp) > Date.now();
  } catch {
    return false;
  }
}

function isAuthorized(request: http.IncomingMessage) {
  if (!panelUsers.size) return true;
  const token = String(request.headers["x-panel-token"] || "").trim();
  const password = String(request.headers["x-panel-password"] || "").trim();
  return (
    verifySessionToken(token) ||
    (password ? Array.from(panelUsers.values()).some((expected) => expected === password) : false)
  );
}

function requireAuth(request: http.IncomingMessage, response: http.ServerResponse) {
  if (isAuthorized(request)) return false;
  sendJson(response, 401, { error: "Login obrigatório." });
  return true;
}

function broadcastSnapshot() {
  const snapshot = bot.getSnapshot();
  const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function logSnapshot() {
  const snapshot = bot.getSnapshot();
  const lastLog = snapshot.logs[snapshot.logs.length - 1];
  const logId = lastLog?.id || "";
  const shouldPrint = snapshot.qrCode !== lastQrCode || logId !== lastLogId;

  if (!shouldPrint) return;
  lastQrCode = snapshot.qrCode;
  lastLogId = logId;

  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Bot WhatsApp - Render/Web");
  console.log("Status:", snapshot.status);
  console.log("Monitoramento:", snapshot.monitoringEnabled ? "ativado" : "desativado");
  if (snapshot.config.grupoAlvoNome || snapshot.config.grupoAlvoJid) {
    console.log("Grupo alvo:", snapshot.config.grupoAlvoNome || snapshot.config.grupoAlvoJid);
  }
  if (snapshot.pairingCode) console.log("Código de pareamento:", snapshot.pairingCode);
  if (snapshot.error) console.log("Erro:", snapshot.error);
  if (lastLog) console.log("Último log:", lastLog.message);
  if (snapshot.qrCode) {
    console.log("QR Code disponível no painel web.");
    qrcodeTerminal.generate(snapshot.qrCode, { small: true });
  }
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

bot.on("snapshot", () => {
  broadcastSnapshot();
  logSnapshot();
});

async function handleAction(action: string, body: any) {
  switch (action) {
    case "start":
      await bot.start(typeof body.pairingPhoneNumber === "string" ? body.pairingPhoneNumber : undefined);
      break;
    case "stop":
      await bot.stop();
      break;
    case "restart":
      await bot.restart();
      break;
    case "clear-session":
      await bot.clearSession();
      break;
    case "clear-logs":
      bot.clearLogs();
      break;
    case "refresh-groups":
      await bot.refreshGroups();
      break;
    case "start-monitoring":
      await bot.enableMonitoring();
      break;
    case "start-nuclear-monitoring":
      await bot.enableNuclearMonitoring();
      break;
    case "start-test-monitoring":
      await bot.enableTestMonitoring();
      break;
    case "stop-monitoring":
      bot.disableMonitoring();
      break;
    case "warmup":
      await bot.warmupConnection();
      break;
    case "save-group":
      await bot.saveGroup(String(body.group || ""), body.groupId, body.groupName);
      break;
    case "save-test-group":
      await bot.saveTestGroup(String(body.group || ""), body.groupId, body.groupName);
      break;
    case "save-codes":
      bot.setMessageCodes(Array.isArray(body.codes) ? body.codes : []);
      break;
    case "save-message-settings":
    case "save-target-message-settings":
      bot.setMessageSettings(String(body.senderName || ""), Array.isArray(body.codes) ? body.codes : []);
      break;
    case "save-warmup-message-settings":
      bot.setWarmupMessageSettings(String(body.senderName || ""), Array.isArray(body.codes) ? body.codes : []);
      break;
    case "save-general-settings":
      bot.setGeneralSettings({ nuclearMode: Boolean(body.nuclearMode) });
      break;
    default:
      throw new Error(`Ação desconhecida: ${action}`);
  }

  return bot.getSnapshot();
}

function getContentType(filePath: string) {
  const ext = path.extname(filePath);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(urlPath: string, response: http.ServerResponse) {
  const safePath = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  const requested = path.join(staticDir, safePath === "/" ? "index.html" : safePath);
  const filePath = requested.startsWith(staticDir) && fs.existsSync(requested) && fs.statSync(requested).isFile()
    ? requested
    : path.join(staticDir, "index.html");

  if (!fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Painel web ainda não foi compilado. Rode npm run build.");
    return;
  }

  response.writeHead(200, {
    "Content-Type": getContentType(filePath),
    "Cache-Control": filePath.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable"
  });
  fs.createReadStream(filePath).pipe(response);
}

function getLocalAddresses() {
  const addresses: string[] = [];
  for (const items of Object.values(os.networkInterfaces())) {
    for (const item of items || []) {
      if (item.family === "IPv4" && !item.internal) {
        addresses.push(`http://${item.address}:${port}`);
      }
    }
  }
  return addresses;
}

function startKeepAlive() {
  if (!keepAliveUrl || process.env.KEEP_ALIVE_WHEN_MONITORING === "false") return;

  const pingUrl = `${keepAliveUrl.replace(/\/$/, "")}/api/ping`;
  console.log(`Keep-alive armado para monitoramento: ${pingUrl}`);

  setInterval(() => {
    const snapshot = bot.getSnapshot();
    if (!snapshot.monitoringEnabled || snapshot.status !== "connected") return;

    fetch(pingUrl)
      .then((response) => {
        if (!response.ok) {
          console.log(`Keep-alive respondeu ${response.status}.`);
        }
      })
      .catch((error) => {
        console.log(`Keep-alive falhou: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, KEEP_ALIVE_INTERVAL_MS);
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/ping") {
      sendJson(response, 200, { ok: true, protected: Boolean(panelPassword), login: "email" });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/login") {
      const body = await readJsonBody(request);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const expectedPassword = panelUsers.get(email);
      if (!email || !expectedPassword || password !== expectedPassword) {
        sendJson(response, 401, { error: "Email ou senha inválidos." });
        return;
      }

      sendJson(response, 200, {
        ok: true,
        token: createSessionToken(email),
        user: { email }
      });
      return;
    }

    if (url.pathname.startsWith("/api/") || url.pathname === "/events" || url.pathname === "/qr.svg") {
      if (requireAuth(request, response)) return;
    }

    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      sendJson(response, 200, bot.getSnapshot());
      return;
    }

    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store",
        Connection: "keep-alive"
      });
      clients.add(response);
      response.write(`data: ${JSON.stringify(bot.getSnapshot())}\n\n`);
      request.on("close", () => clients.delete(response));
      return;
    }

    if (request.method === "GET" && url.pathname === "/qr.svg") {
      const snapshot = bot.getSnapshot();
      if (!snapshot.qrCode) {
        response.writeHead(404);
        response.end("QR indisponível");
        return;
      }

      const svg = await QRCode.toString(snapshot.qrCode, { type: "svg", width: 320, margin: 2 });
      response.writeHead(200, {
        "Content-Type": "image/svg+xml",
        "Cache-Control": "no-store"
      });
      response.end(svg);
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/action/")) {
      const action = decodeURIComponent(url.pathname.replace("/api/action/", ""));
      const body = await readJsonBody(request);
      sendJson(response, 200, await handleAction(action, body));
      return;
    }

    if (request.method === "GET") {
      serveStatic(url.pathname, response);
      return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Painel web: http://localhost:${port}`);
  for (const address of getLocalAddresses()) {
    console.log(`Na rede local: ${address}`);
  }
  console.log(`Dados persistentes: ${dataDir}`);
  if (!panelPassword) {
    console.log("Aviso: defina PANEL_PASSWORD no Render para proteger o painel público.");
  }
  startKeepAlive();
});

async function shutdown() {
  console.log("Encerrando bot...");
  await bot.stop();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
