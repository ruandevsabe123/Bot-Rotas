const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findConfiguredRouteCodeFromOcr,
  selectConsensusDetection
} = require("../dist/bot/ocr.js");

function detection(code, confidence = 90) {
  return {
    route: "Cabo Frio",
    bairro: "Cabo Frio",
    code,
    line: `${code} Cabo Frio`,
    confidence,
    evidenceCount: 1,
    variantCount: 1,
    safeForAutomatic: false
  };
}

test("libera o automático quando tratamentos independentes concordam", () => {
  const result = selectConsensusDetection([
    detection("F-14", 94),
    detection("F-14", 89),
    detection("F-14", 91)
  ], 3);

  assert.equal(result.code, "F-14");
  assert.equal(result.evidenceCount, 3);
  assert.equal(result.safeForAutomatic, true);
});

test("bloqueia o automático quando qualquer tratamento encontra outra gaiola", () => {
  const result = selectConsensusDetection([
    detection("F-14", 94),
    detection("F-14", 89),
    detection("H-34", 92)
  ], 3);

  assert.equal(result.code, "F-14");
  assert.equal(result.safeForAutomatic, false);
});

test("bloqueia leitura única e leitura de baixa confiança", () => {
  assert.equal(selectConsensusDetection([detection("F-14", 95)], 3).safeForAutomatic, false);
  assert.equal(selectConsensusDetection([
    detection("F-14", 92),
    detection("F-14", 65)
  ], 3).safeForAutomatic, false);
});

test("ignora ruído fraco quando duas leituras fortes concordam com a mesma gaiola", () => {
  const result = selectConsensusDetection([
    detection("F-14", 93),
    detection("F-14", 88),
    detection("F-14", 35)
  ], 3);

  assert.equal(result.evidenceCount, 2);
  assert.equal(result.safeForAutomatic, true);
});

test("rejeita linha ambígua com duas gaiolas", () => {
  const result = findConfiguredRouteCodeFromOcr({
    text: "F-14 H-34 Cabo Frio",
    lines: [],
    source: "teste"
  }, [], ["Cabo Frio"]);

  assert.equal(result, undefined);
});
