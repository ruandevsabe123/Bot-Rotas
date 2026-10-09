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
  isSafeAutomaticGaiolaDetection,
  calculateCageColumnCrop,
  combineRouteImageBatch,
  isDarkRouteImage,
  calculateDarkRouteColumnCrop,
  calculateDarkRouteAtColumnCrop,
  classifyRouteImageLayout,
  calculatePresetRouteCrop,
  calculatePresetRouteAtCrop,
  calculateFocusedOcrWidth,
  findAllPlannedAtCodesFromOcr,
  reconcileGaiolaDetectionsWithRomaneio
} = require("../dist/bot/ocr.js");

test("cobre GAIOLA antiga e ROTA do layout escuro novo sem depender da proporção", () => {
  const full = calculateCageColumnCrop(1122, 640, 2244, 1280);
  assert.deepEqual(full, { left: 179, top: 0, width: 762, height: 1280 });

  const cropped = calculateCageColumnCrop(906, 447, 1812, 894);
  assert.deepEqual(cropped, { left: 144, top: 0, width: 616, height: 894 });
  assert.ok(full.left < 2244 * 0.1);
  assert.ok(full.left + full.width > 2244 * 0.4);
});

test("identifica o layout escuro sem alterar imagens claras antigas", () => {
  assert.equal(isDarkRouteImage(32), true);
  assert.equal(isDarkRouteImage(127.9), true);
  assert.equal(isDarkRouteImage(128), false);
  assert.equal(isDarkRouteImage(238), false);
});

test("corrige letra duplicada pelo tema escuro somente com consenso", () => {
  const reading = (source) => plainReading("Cc-23\nCc-28\nCc-31", source);
  const detected = findAllGaiolaCodesFromOcr({
    ...reading("a"),
    variants: [reading("a"), reading("b"), reading("c")]
  });
  assert.deepEqual(detected.map((item) => item.code), ["C-23", "C-28", "C-31"]);
  assert.ok(detected.every((item) => item.safeForAutomatic));
});

test("quarta leitura confirma código que apareceu isolado na terceira", () => {
  const reading = (text, source) => plainReading(text, source);
  const combined = combineRouteImageBatch([
    {
      ...reading("B-18", "foto"),
      variants: [
        reading("B-18", "normal"),
        reading("B-18", "suave"),
        reading("B-18\nC-2\nC-31", "binaria"),
        reading("B-18\nC-2\nC-31", "original")
      ]
    }
  ]);
  const detected = findAllGaiolaCodesFromOcr(combined);
  assert.deepEqual(detected.map((item) => item.code), ["B-18", "C-2", "C-31"]);
  assert.ok(detected.every((item) => item.safeForAutomatic));
});

test("preserva AT ao ler ROTA e AT na mesma linha de conferência", () => {
  const detected = findAllGaiolaCodesFromOcr(plainReading("C-11 AT2026083094KPO", "rota-at"));
  assert.equal(detected.length, 1);
  assert.equal(detected[0].code, "C-11");
  assert.equal(detected[0].plannedAt, "AT2026083094KPO");
  assert.equal(detected[0].safeForAutomatic, false);
});

test("no tema escuro recorta somente ROTA e deixa TURNO e AT de fora", () => {
  assert.deepEqual(calculateDarkRouteColumnCrop(910, 780), {
    left: 145,
    top: 0,
    width: 209,
    height: 780
  });
  const crop = calculateDarkRouteColumnCrop(978, 800);
  assert.ok(crop.left <= 978 * 0.2);
  assert.ok(crop.left + crop.width >= 978 * 0.35);
});

test("recorte de conferência inclui ROTA e AT sem chegar ao CLUSTER", () => {
  const crop = calculateDarkRouteAtColumnCrop(910, 780);
  assert.deepEqual(crop, { left: 145, top: 0, width: 382, height: 780 });
  assert.ok(crop.left <= 910 * 0.2);
  assert.ok(crop.left + crop.width >= 910 * 0.55);
  assert.ok(crop.left + crop.width < 910 * 0.6);
});

test("seleciona automaticamente a predefinição visual da imagem", () => {
  assert.equal(classifyRouteImageLayout(35, 0), "dark-modern");
  assert.equal(classifyRouteImageLayout(230, 0.18), "light-orange");
  assert.equal(classifyRouteImageLayout(230, 0.01), "light-left");
});

test("cada predefinição recorta ROTA e confirmação ROTA mais AT", () => {
  assert.deepEqual(calculatePresetRouteCrop("light-orange", 900, 300), { left: 0, top: 0, width: 162, height: 300 });
  assert.deepEqual(calculatePresetRouteAtCrop("light-orange", 900, 300), { left: 0, top: 0, width: 306, height: 300 });
  assert.deepEqual(calculatePresetRouteCrop("light-left", 600, 700), { left: 0, top: 0, width: 210, height: 700 });
  assert.deepEqual(calculatePresetRouteAtCrop("light-left", 600, 700), { left: 0, top: 0, width: 288, height: 700 });
});

test("limita os pixels do OCR focado sem deixar letras pequenas", () => {
  assert.equal(calculateFocusedOcrWidth(410), 677);
  assert.equal(calculateFocusedOcrWidth(280), 620);
  assert.equal(calculateFocusedOcrWidth(900), 1000);
});

test("extrai ATs exatos das leituras para confirmação pelo romaneio", () => {
  const readings = [
    plainReading("C-17 AT2026083094LAB", "a"),
    plainReading("AT2026083094LAB\nAT2026083094JFR", "b")
  ];
  assert.deepEqual(findAllPlannedAtCodesFromOcr({ ...readings[0], variants: readings }), [
    "AT2026083094LAB",
    "AT2026083094JFR"
  ]);
});

test("lote de fotos preserva o consenso individual e reúne todas as rotas", () => {
  const photo = (code, prefix) => ({
    text: code,
    lines: [],
    source: prefix,
    variants: ["a", "b", "c"].map((variant) => plainReading(code, `${prefix}-${variant}`))
  });
  const batch = combineRouteImageBatch([photo("A-18", "foto-1"), photo("C-31", "foto-2")]);
  assert.equal(batch.variants.length, 3);
  assert.deepEqual(findAllGaiolaCodesFromOcr(batch).map((item) => item.code).sort(), ["A-18", "C-31"]);
  assert.ok(findAllGaiolaCodesFromOcr(batch).every((item) => item.safeForAutomatic));
});

function plainReading(text, source) {
  return { text, lines: [], source };
}

test("caminho rápido exige duas leituras independentes iguais", () => {
  assert.equal(canUseFastOcrResult([
    plainReading("F-14 Cabo Frio\nH-20 Centro", "contraste"),
    plainReading("F-14 Cabo Frio\nH-20 Centro", "preto-e-branco")
  ]), true);
  assert.equal(canUseFastOcrResult([
    plainReading("F-14 Cabo Frio", "contraste")
  ]), false);
});

test("tabela grande encerra em duas leituras apesar de ruido em rotas irrelevantes", () => {
  assert.equal(canUseFastOcrResult([
    plainReading("J-13\nL-1\nJ-12\nJ-10\nI-18\nH-19\nG-4", "contraste"),
    plainReading("J-13\nL-1\nJ-12\nJ-1\nI-18\nH-18\nG-4", "esparsa")
  ]), true);
});

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

test("encerra após o trio rápido quando cobre as rotas e isola um único ruído", () => {
  const readings = [
    plainReading("A-18\nA-20\nB-24\nC-2\nC-11\nC-15\nC-17\nC-20\nC-27\nC-31\nC-32\nD-8\nD-12", "esparsa"),
    plainReading("A-18\nA-20\nB-25\nC-2\nC-11\nC-17\nC-27\nC-28\nC-32\nD-8\nD-12", "binaria"),
    plainReading("A-18\nA-20\nB-24\nB-25\nC-2\nC-11\nC-15\nC-20\nC-27\nC-31\nC-32\nD-8\nD-12", "coluna")
  ];
  assert.equal(canUseFastOcrResult(readings), true);
  const detected = findAllGaiolaCodesFromOcr({ ...readings[0], variants: readings });
  assert.equal(detected.find((item) => item.code === "C-28").safeForAutomatic, false);
});

test("uma quarta leitura pode fechar o consenso sem executar todos os fallbacks", () => {
  const first = plainReading("A-18\nA-20\nC-2\nC-11\nC-15\nC-20\nC-27\nC-31\nC-32\nD-8\nD-12\nE-23\nF-19", "l1");
  const second = plainReading("A-20\nB-24\nC-2\nC-15\nC-17\nC-20\nC-27\nC-31\nC-32\nD-8\nD-12\nE-23\nF-19", "l2");
  const third = plainReading("A-18\nA-20\nB-25\nC-2\nC-11\nC-17\nC-28\nC-27\nC-32\nD-8\nD-12\nE-23\nF-19", "l3");
  const fourth = plainReading("A-18\nA-20\nB-24\nB-25\nC-15\nC-20\nD-8\nD-12\nE-23\nF-19", "l4");

  assert.equal(canUseFastOcrResult([first, second, third]), false);
  assert.equal(canUseFastOcrResult([first, second, third, fourth]), true);
});

test("automático exige duas confirmações independentes na análise completa", () => {
  assert.equal(isSafeAutomaticGaiolaDetection({
    ...detection("F-14", 92),
    safeForAutomatic: true,
    evidenceCount: 1,
    variantCount: 6
  }), false);
  assert.equal(isSafeAutomaticGaiolaDetection({
    ...detection("F-14", 92),
    safeForAutomatic: true,
    evidenceCount: 2,
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

test("não conta linha e palavra da mesma leitura como duas evidências", () => {
  const reading = {
    text: "C-30",
    source: "única-leitura",
    lines: [ocrLine("C-30", 10, 40)]
  };
  const result = findAllGaiolaCodesFromOcr({ ...reading, variants: [reading, { text: "", lines: [], source: "vazia" }] });

  assert.equal(result[0].code, "C-30");
  assert.equal(result[0].evidenceCount, 1);
  assert.equal(result[0].safeForAutomatic, false);
});

test("mantém todas as gaiolas confirmadas por duas de três leituras", () => {
  const readings = [
    plainReading("C-25\nC-30\nB-29", "contraste"),
    plainReading("C-25\nC-30", "preto-e-branco"),
    plainReading("C-30\nB-29", "esparsa")
  ];
  const result = findAllGaiolaCodesFromOcr({ ...readings[0], variants: readings });

  assert.deepEqual(result.filter(isSafeAutomaticGaiolaDetection).map((item) => item.code).sort(), ["B-29", "C-25", "C-30"]);
});

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

test("usa o AT do romaneio para corrigir I-17 truncado como I-1", () => {
  const plannedAt = "AT202609059DJOX";
  const routes = [romaneioRoute("I-17", plannedAt)];
  const result = reconcileGaiolaDetectionsWithRomaneio([
    { ...detection("I-1", 91), plannedAt },
    { ...detection("I-17", 88), plannedAt }
  ], [plannedAt], routes);

  assert.deepEqual(result.map((item) => item.code), ["I-17"]);
  assert.equal(result[0].plannedAt, plannedAt);
});

test("remove I-1 truncado quando a imagem tem um unico AT exato de I-17", () => {
  const plannedAt = "AT202609059DJOX";
  const result = reconcileGaiolaDetectionsWithRomaneio([
    detection("I-1", 91)
  ], [plannedAt], [romaneioRoute("I-17", plannedAt)]);

  assert.deepEqual(result.map((item) => item.code), ["I-17"]);
});

test("bloqueia conflito I-1 e I-17 sem AT em vez de adivinhar", () => {
  const result = reconcileGaiolaDetectionsWithRomaneio([
    { ...detection("I-1", 91), safeForAutomatic: true, evidenceCount: 2 },
    { ...detection("I-17", 90), safeForAutomatic: true, evidenceCount: 2 }
  ], [], []);

  assert.equal(result.length, 2);
  assert.ok(result.every((item) => !isSafeAutomaticGaiolaDetection(item)));
});

test("preserva I-1 e I-17 quando cada linha tem seu proprio AT exato", () => {
  const atI1 = "AT202609059AAAA";
  const atI17 = "AT202609059DJOX";
  const result = reconcileGaiolaDetectionsWithRomaneio([
    { ...detection("I-1", 91), plannedAt: atI1 },
    { ...detection("I-17", 90), plannedAt: atI17 }
  ], [atI1, atI17], [romaneioRoute("I-1", atI1), romaneioRoute("I-17", atI17)]);

  assert.deepEqual(result.map((item) => item.code).sort(), ["I-1", "I-17"]);
});

test("nao libera gaiola I de um digito sem confirmacao exata do AT", () => {
  const result = reconcileGaiolaDetectionsWithRomaneio([
    { ...detection("I-1", 95), safeForAutomatic: true, evidenceCount: 3 }
  ], [], [romaneioRoute("I-1", "AT202609059AAAA")]);

  assert.equal(result[0].code, "I-1");
  assert.equal(isSafeAutomaticGaiolaDetection(result[0]), false);
});

test("libera gaiolas I de dois digitos por consenso mesmo sem ler o AT", () => {
  const result = reconcileGaiolaDetectionsWithRomaneio([
    { ...detection("I-19", 95), safeForAutomatic: true, evidenceCount: 2, variantCount: 2 },
    { ...detection("I-32", 94), safeForAutomatic: true, evidenceCount: 2, variantCount: 2 }
  ], [], [
    romaneioRoute("I-19", "AT202609059D9HI"),
    romaneioRoute("I-32", "AT202609059D9ZC")
  ]);

  assert.deepEqual(result.map((item) => item.code), ["I-19", "I-32"]);
  assert.ok(result.every((item) => isSafeAutomaticGaiolaDetection(item)));
});

test("preserva as quatro gaiolas dos recortes claros enviados pelo cliente", () => {
  const reading = (source) => plainReading("J-16\nI-19\nD-22\nI-32", source);
  const detected = findAllGaiolaCodesFromOcr({
    ...reading("foto"),
    variants: [reading("normal"), reading("suave")]
  });
  const result = reconcileGaiolaDetectionsWithRomaneio(detected, [], [
    romaneioRoute("J-16", "AT202609059DKKH"),
    romaneioRoute("I-19", "AT202609059D9HI"),
    romaneioRoute("D-22", "AT202609059CZP3"),
    romaneioRoute("I-32", "AT202609059D9ZC")
  ]);

  assert.deepEqual(result.map((item) => item.code), ["J-16", "I-19", "D-22", "I-32"]);
  assert.ok(result.every((item) => isSafeAutomaticGaiolaDetection(item)));
});

function romaneioRoute(gaiola, plannedAt) {
  return {
    rota: "001",
    gaiola,
    plannedAt,
    cidade: "Campos dos Goytacazes",
    distanciaKm: 1,
    pacotes: 1,
    paradas: 1,
    bairros: [{ nome: "Parque Corrientes", percentual: 100, pacotes: 1 }]
  };
}
