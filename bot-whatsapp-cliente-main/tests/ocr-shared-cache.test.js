const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { getOrCreateSharedOcrResult, createSharedOcrCacheKey } = require("../dist/bot/ocrSharedCache.js");

function result(source = "teste") {
  return { text: "C-20", lines: [], source };
}

test("analises simultaneas da mesma imagem executam o OCR uma unica vez", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-ocr-cache-"));
  const imagePath = path.join(directory, "imagem.jpg");
  fs.writeFileSync(imagePath, "mesma-imagem");
  const env = { ...process.env, DATA_DIR: directory };
  let executions = 0;

  try {
    const analyze = async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return result("compartilhado");
    };
    const options = { maxReadings: 6, fastFirst: true, preferCageCrop: false };
    const readings = await Promise.all([
      getOrCreateSharedOcrResult(imagePath, options, analyze, env),
      getOrCreateSharedOcrResult(imagePath, options, analyze, env),
      getOrCreateSharedOcrResult(imagePath, options, analyze, env)
    ]);

    assert.equal(executions, 1);
    assert.deepEqual(readings, [result("compartilhado"), result("compartilhado"), result("compartilhado")]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("cache usa os bytes da foto e as opcoes da leitura", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-ocr-key-"));
  const firstPath = path.join(directory, "primeira.jpg");
  const secondPath = path.join(directory, "segunda.jpg");
  fs.writeFileSync(firstPath, "bytes-iguais");
  fs.writeFileSync(secondPath, "bytes-iguais");

  try {
    const first = await createSharedOcrCacheKey(firstPath, { maxReadings: 6, fastFirst: true });
    const renamed = await createSharedOcrCacheKey(secondPath, { maxReadings: 6, fastFirst: true });
    const otherOptions = await createSharedOcrCacheKey(secondPath, { maxReadings: 3, fastFirst: true });
    assert.equal(first, renamed);
    assert.notEqual(first, otherOptions);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("cache corrompido e cache expirado sao refeitos sem derrubar a analise", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "bot-ocr-expired-"));
  const imagePath = path.join(directory, "imagem.jpg");
  fs.writeFileSync(imagePath, "imagem-expirada");
  const options = { maxReadings: 6 };
  const env = { ...process.env, DATA_DIR: directory, OCR_SHARED_CACHE_TTL_MS: "1" };

  try {
    const key = await createSharedOcrCacheKey(imagePath, options);
    const cacheDir = path.join(directory, "ocr-result-cache");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, `${key}.json`), "json-invalido");
    let executions = 0;
    const analyze = async () => result(`execucao-${++executions}`);

    assert.equal((await getOrCreateSharedOcrResult(imagePath, options, analyze, env)).source, "execucao-1");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal((await getOrCreateSharedOcrResult(imagePath, options, analyze, env)).source, "execucao-2");
    assert.equal(executions, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
