const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findConfiguredRouteCodeFromOcr,
  findAllConfiguredRouteCodesFromOcr,
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

test("bloqueia leitura única, mas libera duas leituras moderadas que concordam", () => {
  assert.equal(selectConsensusDetection([detection("F-14", 95)], 3).safeForAutomatic, false);
  assert.equal(selectConsensusDetection([
    detection("F-14", 92),
    detection("F-14", 65)
  ], 3).safeForAutomatic, true);
  assert.equal(selectConsensusDetection([
    detection("F-14", 44),
    detection("F-14", 43)
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

function ocrLine(text, left, top, confidence = 92) {
  const words = text.split(/\s+/).map((word, index) => ({
    text: word,
    left: left + index * 105,
    top,
    width: Math.max(28, word.length * 11),
    height: 20,
    confidence
  }));
  const right = Math.max(...words.map((word) => word.left + word.width));
  return { text, words, left, top, width: right - left, height: 20, confidence };
}

test("encontra bairro mesmo quando a tabela usa colunas em posições diferentes", () => {
  const result = findConfiguredRouteCodeFromOcr({
    text: "G-12 Parque Presidente Vargas",
    source: "teste-colunas",
    lines: [
      ocrLine("G-12", 15, 100),
      ocrLine("Parque Presidente Vargas", 260, 100),
      ocrLine("rodapé longo da tabela", 20, 220)
    ]
  }, [{ cidade: "", bairro: "Parque Presidente Vargas" }], []);

  assert.equal(result.code, "G-12");
  assert.equal(result.bairro, "Parque Presidente Vargas");
});

test("associa gaiola separada pelo Tesseract à linha visual do bairro", () => {
  const configured = [
    "Loteamento Sonho Dourado",
    "Parque Vicente Gonçalves Dias",
    "Parque Presidente Vargas"
  ];

  for (const bairro of configured) {
    const result = findConfiguredRouteCodeFromOcr({
      text: `F-14 ${bairro}`,
      source: "teste-linha-fragmentada",
      lines: [
        ocrLine("F-14", 12, 90),
        ocrLine(bairro, 280, 102),
        ocrLine("H-34 Outra Rota", 12, 180)
      ]
    }, [{ cidade: "", bairro }], []);

    assert.equal(result.code, "F-14", bairro);
    assert.equal(result.bairro, bairro);
  }
});

test("não associa gaiola de uma linha vizinha", () => {
  const result = findConfiguredRouteCodeFromOcr({
    text: "F-14 Parque Barão do Rio Branco",
    source: "teste-segurança",
    lines: [
      ocrLine("F-14", 12, 40),
      ocrLine("Parque Barão do Rio Branco", 280, 105)
    ]
  }, [{ cidade: "Campos dos Goytacazes", bairro: "Parque Barão do Rio Branco" }], []);

  assert.equal(result, undefined);
});

test("retorna todas as rotas configuradas encontradas na mesma foto", () => {
  const lines = [
    ocrLine("D-4 AT202607177C6TM 88 Campos dos Goytacazes Saturnino Braga", 10, 40),
    ocrLine("H-32 AT202607177D12J 85 Campos dos Goytacazes Ibitioca", 10, 90)
  ];
  const reading = { text: lines.map((line) => line.text).join("\n"), source: "teste", lines };
  const result = findAllConfiguredRouteCodesFromOcr({
    ...reading,
    variants: [reading, reading]
  }, [
    { cidade: "Campos dos Goytacazes", bairro: "Saturnino Braga" },
    { cidade: "Campos dos Goytacazes", bairro: "Ibitioca" }
  ], []);

  assert.deepEqual(result.map((route) => [route.bairro, route.code]), [
    ["Saturnino Braga", "D-4"],
    ["Ibitioca", "H-32"]
  ]);
  assert.equal(result.every((route) => route.safeForAutomatic), true);
});

test("identifica todas as gaiolas da foto mesmo sem bairros configurados", () => {
  const rawLines = [
    "G-17 AT202607177D8LJ 109 São Francisco de Itabapoana Centro",
    "1-24 AT202607177CTER 93 Campos dos Goytacazes Parque Guarus",
    "G-10 AT202607177CT4H 68 São Francisco de Itabapoana Travessão de barra",
    "C-13 AT202607177CL3V 119 São João da Barra Barcelos"
  ];
  const reading = {
    text: rawLines.join("\n"),
    source: "foto-real",
    lines: rawLines.map((line, index) => ocrLine(line, 10, 40 + index * 50))
  };
  const result = findAllConfiguredRouteCodesFromOcr({ ...reading, variants: [reading, reading] }, [], []);

  assert.deepEqual(result.map((route) => route.code), ["G-17", "I-24", "G-10", "C-13"]);
  assert.equal(result.every((route) => route.safeForAutomatic), true);
});

test("mantém Parque Guarus configurado quando I-24 é lido como 1-24", () => {
  const line = ocrLine("1-24 AT202607177CTER 93 Campos dos Goytacazes Parque Guarus", 10, 40);
  const reading = { text: line.text, source: "foto-real", lines: [line] };
  const result = findAllConfiguredRouteCodesFromOcr({ ...reading, variants: [reading, reading] }, [
    { cidade: "", bairro: "Parque Guarus" }
  ], []);

  assert.equal(result.length, 1);
  assert.equal(result[0].bairro, "Parque Guarus");
  assert.equal(result[0].code, "I-24");
  assert.equal(result[0].safeForAutomatic, true);
});
