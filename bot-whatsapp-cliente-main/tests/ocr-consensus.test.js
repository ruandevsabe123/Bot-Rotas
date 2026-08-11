const test = require("node:test");
const assert = require("node:assert/strict");
const {
  findConfiguredRouteCodeFromOcr,
  findAllConfiguredRouteCodesFromOcr,
  findConfiguredRouteInOcrLine,
  findNeighborhoodInOcrLine,
  findAllGaiolaCodesFromOcr,
  extractNeighborhoodAfterCity,
  selectConsensusDetection,
  canUseFastOcrResult,
  isSafeAutomaticGaiolaDetection
} = require("../dist/bot/ocr.js");

function plainReading(text, source) {
  return { text, lines: [], source };
}

test("encerra cedo quando três leituras encontram as mesmas gaiolas com consenso", () => {
  assert.equal(canUseFastOcrResult([
    plainReading("F-14 Cabo Frio\nH-20 Centro", "a"),
    plainReading("F-14 Cabo Frio\nH-20 Centro", "b"),
    plainReading("F-14 Cabo Frio\nH-20 Centro", "c")
  ]), true);
});

test("mantém análise completa quando as leituras rápidas divergem", () => {
  assert.equal(canUseFastOcrResult([
    plainReading("F-14 Cabo Frio", "a"),
    plainReading("F-14 Cabo Frio", "b"),
    plainReading("H-20 Centro", "c")
  ]), false);
});

test("automático exige confirmação de pelo menos metade das leituras", () => {
  assert.equal(isSafeAutomaticGaiolaDetection({
    ...detection("F-14", 92),
    safeForAutomatic: true,
    evidenceCount: 2,
    variantCount: 6
  }), false);
  assert.equal(isSafeAutomaticGaiolaDetection({
    ...detection("F-14", 92),
    safeForAutomatic: true,
    evidenceCount: 3,
    variantCount: 6
  }), true);
});

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

test("associa a gaiola genérica ao bairro configurado pelo texto completo da linha", () => {
  const configured = [
    { cidade: "Campos dos Goytacazes", bairro: "Parque Jardim Carioca" },
    { cidade: "Campos dos Goytacazes", bairro: "Parque Presidente Vargas" },
    { cidade: "Campos dos Goytacazes", bairro: "Parque Rodoviário" }
  ];

  assert.deepEqual(findConfiguredRouteInOcrLine(
    "J-1 AT202607177D1CT 101 Campos dos Goytacazes Parque Jardim Carioca",
    configured,
    []
  ), configured[0]);
  assert.deepEqual(findConfiguredRouteInOcrLine(
    "J-3 AT202607177D92H 102 Cmps Goytcazes Parque Presidente Vargas",
    configured,
    []
  ), configured[1]);
  assert.equal(findConfiguredRouteInOcrLine(
    "J-20 AT202607177D1BI 106 Campos dos Goytacazes Parque Rosário",
    configured,
    []
  ), undefined);
});

test("usa somente o bairro presente na linha da gaiola e não outro bairro interno do romaneio", () => {
  const bairrosDoRomaneio = ["Parque Aldeia", "Centro"];

  assert.equal(findNeighborhoodInOcrLine(
    "H-25 AT202607177D10N 112 Campos dos Goytacazes Centro",
    bairrosDoRomaneio
  ), "Centro");
  assert.equal(findNeighborhoodInOcrLine(
    "H-25 AT202607177D10N 112 Campos dos Goytacazes Centro",
    ["Parque Aldeia"]
  ), undefined);
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

test("normaliza I-1 lido como 1-1 ou l-1 sem transformar H-1 real", () => {
  const readings = ["1-1", "l-1", "|-1", "H-1"].map((code) => ({
    text: `${code} AT202607177TESTE 80 Campos dos Goytacazes Centro`,
    source: `codigo-${code}`,
    lines: [ocrLine(`${code} AT202607177TESTE 80 Campos dos Goytacazes Centro`, 10, 40)]
  }));

  assert.deepEqual(readings.map((reading) => findAllGaiolaCodesFromOcr(reading)[0]?.code), [
    "I-1",
    "I-1",
    "I-1",
    "H-1"
  ]);
});

test("não confunde Parque Rodoviário com Rosário", () => {
  const line = ocrLine("H-20 AT202607177TESTE 80 Campos dos Goytacazes Rosário", 10, 40);
  const reading = { text: line.text, source: "foto-real", lines: [line] };
  const result = findAllConfiguredRouteCodesFromOcr({ ...reading, variants: [reading, reading] }, [
    { cidade: "Campos dos Goytacazes", bairro: "Parque Rodoviário" }
  ], []);

  assert.deepEqual(result, []);
});

test("identifica as 15 gaiolas da imagem sem bairros preferidos", () => {
  const rawLines = [
    "C-11 AT202607177C60A 113 Sao Joao da Barra Praia do Acu",
    "C-13 AT202607177CL3V 119 Sao Joao da Barra Barcelos",
    "D-4 AT202607177C6TM 88 Campos dos Goytacazes Saturnino Braga",
    "F-28 AT202607177CSWH 90 Campos dos Goytacazes Travessao",
    "G-12 AT202607177D0RI 76 Sao Francisco de Itabapoana Floresta",
    "G-13 AT202607177D8X5 84 Sao Francisco de Itabapoana Guaxindiba",
    "G-14 AT202607177D0JZ 75 Sao Francisco de Itabapoana Santa Clara",
    "G-23 AT202607177CTCH 105 Italva Centro",
    "H-1 AT202607177D8VE 77 Sao Joao da Barra Atafona",
    "H-12 AT202607177D10J 87 Quissama Piteiras",
    "H-16 AT202607177CTH5 60 Campos dos Goytacazes Sto Amaro Campos",
    "H-17 AT202607177D1HP 61 Campos dos Goytacazes Baixa grande",
    "H-24 AT202607177D8Q9 112 Campos dos Goytacazes Centro",
    "H-25 AT202607177D10N 112 Campos dos Goytacazes Centro",
    "H-28 AT202607177CTA3 103 Campos dos Goytacazes Centro"
  ];
  const reading = { text: rawLines.join("\n"), source: "foto-real-15", lines: rawLines.map((line, index) => ocrLine(line, 10, 40 + index * 40)) };
  const result = findAllGaiolaCodesFromOcr({ ...reading, variants: [reading, reading] });

  assert.equal(result.length, 15);
  assert.equal(extractNeighborhoodAfterCity(rawLines[13], "Campos dos Goytacazes"), "Centro");
});

test("mantém as 21 gaiolas da tabela mesmo quando nenhum destino é Campos", () => {
  const rawLines = [
    "B-1 AT202607197FK5G 94 São Francisco de Itabapoana Centro",
    "B-13 AT202607197FLJYP 108 São Fidélis São José",
    "B-15 AT202607197FUJ9 108 São Fidélis Ipuca",
    "B-17 AT202607197FUT9 88 Italva São Caetano",
    "B-18 AT202607197FK03 88 Italva Parque Industrial",
    "B-19 AT202607197FUDW 87 Italva Centro",
    "B-2 AT202607197FUJ8 94 São Francisco de Itabapoana Centro",
    "B-21 AT202607197FV9D 112 Cardoso Moreira Praça Tiradentes",
    "B-22 AT202607197FKFV 112 Cardoso Moreira Cachoeiro",
    "B-23 AT202607197G2YX 112 Cardoso Moreira Centro",
    "B-24 AT202607197G328 85 São João da Barra Centro",
    "B-27 AT202607197FK0Z 97 São João da Barra Quixaba",
    "B-3 AT202607197FU8X 95 São Francisco de Itabapoana Floresta",
    "B-30 AT202607197FKA7 85 São João da Barra Barcelos",
    "B-32 AT202607197FK34 100 São João da Barra Grussaí",
    "B-4 AT202607197FV0J 102 São Francisco de Itabapoana Bom Jardim",
    "B-7 AT202607197FUL3 101 São Francisco de Itabapoana Brejo Grande",
    "C-2 AT202607197FUGW 100 São João da Barra Cajueiro",
    "C-3 AT202607197FK7E 94 São João da Barra Atafona",
    "C-6 AT202607197FV1H 116 Quissamã Santa Catarina",
    "C-8 AT202607197FUM0 116 Quissamã Caxias"
  ];
  const reading = {
    text: rawLines.join("\n"),
    source: "foto-19-07",
    lines: rawLines.map((line, index) => ocrLine(line, 10, 40 + index * 35))
  };
  const result = findAllGaiolaCodesFromOcr({ ...reading, variants: [reading, reading] });

  assert.equal(result.length, 21);
  assert.deepEqual(result.map((item) => item.code), [
    "B-1", "B-13", "B-15", "B-17", "B-18", "B-19", "B-2", "B-21", "B-22", "B-23", "B-24",
    "B-27", "B-3", "B-30", "B-32", "B-4", "B-7", "C-2", "C-3", "C-6", "C-8"
  ]);
});

test("recupera todas as gaiolas quando o OCR agrupa várias linhas da tabela em um bloco", () => {
  const codes = ["B-1", "B-13", "B-15", "B-17", "B-18", "B-19", "B-2", "B-21", "B-22", "B-23", "B-24", "B-27", "B-3", "B-30", "B-32", "B-4", "B-7", "C-2", "C-3", "C-6", "C-8"];
  const rows = codes.map((code, index) => ocrLine(`${code} AT20260719${index} Cidade Bairro`, 10, 40 + index * 35));
  const words = rows.flatMap((row) => row.words);
  const groupedReading = {
    text: rows.map((row) => row.text).join(" "),
    source: "ocr-agrupado",
    lines: [{
      text: rows.map((row) => row.text).join(" "),
      words,
      left: 10,
      top: 40,
      width: 900,
      height: 21 * 35,
      confidence: 92
    }]
  };
  const result = findAllGaiolaCodesFromOcr(groupedReading);

  assert.deepEqual(result.map((item) => item.code), codes);
});
