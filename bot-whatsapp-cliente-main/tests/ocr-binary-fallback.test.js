const assert = require("node:assert/strict");
const test = require("node:test");

const { readCageOcrWithFallback } = require("../dist/bot/ocr.js");

const emptyReading = { text: "", lines: [], source: "tesseract-js:teste" };

test("preserva leitura JavaScript quando o executável nativo não existe", async () => {
  let binaryCalls = 0;
  const result = await readCageOcrWithFallback(
    async () => emptyReading,
    async () => {
      binaryCalls += 1;
      const error = new Error("spawn tesseract ENOENT");
      error.code = "ENOENT";
      throw error;
    }
  );

  assert.equal(result.source, "tesseract-js:teste");
  assert.equal(binaryCalls, 1);
});

test("não tenta executar o binário depois que sua ausência foi conhecida", async () => {
  let binaryCalls = 0;
  const result = await readCageOcrWithFallback(
    async () => emptyReading,
    async () => {
      binaryCalls += 1;
      throw new Error("não deveria executar");
    },
    true
  );

  assert.equal(result, emptyReading);
  assert.equal(binaryCalls, 0);
});
