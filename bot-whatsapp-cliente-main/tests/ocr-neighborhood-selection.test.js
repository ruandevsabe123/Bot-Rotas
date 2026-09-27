const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { selectPreferredNeighborhoodFromOcr } = require("../dist/bot/ocrNeighborhoodSelection.js");
const { combineRouteImageBatch, readRouteImageOcr, shutdownRouteOcrEngine } = require("../dist/bot/ocr.js");

const preferred = [
  { cidade: "Campos dos Goytacazes", bairro: "Parque Rodoviário" },
  { cidade: "Campos dos Goytacazes", bairro: "Centro" }
];

function line(text, top = 30, left = 20, confidence = 94) {
  let cursor = left;
  const words = text.split(/\s+/).map((word) => {
    const result = { text: word, left: cursor, top, width: word.length * 10, height: 20, confidence };
    cursor += result.width + 12;
    return result;
  });
  return { text, top, left, width: cursor - left, height: 20, confidence, words };
}

function reading(rows, source = "contrast") {
  const lines = rows.map((row, index) => typeof row === "string" ? line(row, 30 + index * 40) : row);
  return { text: lines.map((item) => item.text).join("\n"), lines, source };
}

function consensus(rows) {
  const variants = [reading(rows, "contrast"), reading(rows, "binary")];
  return { ...variants[0], variants };
}

test("escolhe somente o bairro na ordem de preferência, independente da ordem visual", () => {
  const result = selectPreferredNeighborhoodFromOcr(consensus([
    "B-12 AT2026092600001 95 Campos dos Goytacazes Centro",
    "F-14 AT2026092600002 77 Campos dos Goytacazes Parque Rodoviário"
  ]), preferred);
  assert.equal(result.status, "selected");
  assert.equal(result.preferenceIndex, 0);
  assert.equal(result.detection.code, "F-14");
  assert.equal(result.detection.evidenceCount, 2);
});

test("passa à próxima preferência apenas quando a anterior está ausente", () => {
  const result = selectPreferredNeighborhoodFromOcr(consensus(["B-12 Campos dos Goytacazes Centro"]), preferred);
  assert.equal(result.status, "selected");
  assert.equal(result.preferenceIndex, 1);
});

test("não troca bairros parecidos, prefixos, palavras parciais ou cidades", () => {
  for (const text of [
    "F-14 Campos dos Goytacazes Parque Rosário",
    "F-14 Campos dos Goytacazes Parque Rodoviário Novo",
    "F-14 Campos dos Goytacazes Novo Parque Rodoviário",
    "F-14 Campos dos Goytacazes Parque Rodoviarlo",
    "F-14 São João da Barra Parque Rodoviário",
    "F-14 Campos dos Goytacazes Novo Centro"
  ]) assert.equal(selectPreferredNeighborhoodFromOcr(consensus([text]), preferred).status, "no-match", text);
});

test("normaliza somente acentuação, caixa e separadores explícitos", () => {
  const result = selectPreferredNeighborhoodFromOcr(consensus([
    "F-14 | CAMPOS DOS GOYTACAZES | PARQUE RODOVIARIO / Pelinca"
  ]), preferred);
  assert.equal(result.status, "selected");
  assert.equal(result.detection.code, "F-14");
});

test("gaiolas diferentes para o bairro prioritário bloqueiam sem cair no segundo bairro", () => {
  const result = selectPreferredNeighborhoodFromOcr(consensus([
    "F-14 Campos dos Goytacazes Parque Rodoviário",
    "H-20 Campos dos Goytacazes Parque Rodoviário",
    "B-12 Campos dos Goytacazes Centro"
  ]), preferred);
  assert.equal(result.status, "unsafe");
  assert.equal(result.preferenceIndex, 0);
  assert.equal(result.detection, undefined);
});

test("conflito entre tratamentos bloqueia mesmo contra duas leituras concordantes", () => {
  const variants = [
    reading(["F-14 Campos dos Goytacazes Parque Rodoviário"], "a"),
    reading(["F-14 Campos dos Goytacazes Parque Rodoviário"], "b"),
    reading(["F-1 Campos dos Goytacazes Parque Rodoviário"], "c")
  ];
  assert.equal(selectPreferredNeighborhoodFromOcr({ ...variants[0], variants }, preferred).status, "unsafe");
});

test("não inventa I a partir de 1, l, barra ou letra duplicada", () => {
  for (const code of ["1-24", "l-24", "|-24", "II-24"]) {
    const result = selectPreferredNeighborhoodFromOcr(consensus([`${code} Campos dos Goytacazes Parque Rodoviário`]), preferred);
    assert.equal(result.status, "unsafe", code);
  }
  assert.equal(selectPreferredNeighborhoodFromOcr(consensus(["I-24 Campos dos Goytacazes Parque Rodoviário"]), preferred).status, "selected");
});

test("não usa gaiola da linha vizinha e reúne fragmentos da mesma linha visual", () => {
  const unsafe = consensus([
    line("F-14", 30, 20),
    line("Campos dos Goytacazes Parque Rodoviário", 55, 200)
  ]);
  assert.equal(selectPreferredNeighborhoodFromOcr(unsafe, preferred).status, "unsafe");
  const safe = consensus([
    line("F-14", 30, 20),
    line("Campos dos Goytacazes Parque Rodoviário", 34, 200)
  ]);
  assert.equal(selectPreferredNeighborhoodFromOcr(safe, preferred).status, "selected");
});

test("reconstrói linhas quando o OCR agrupa toda uma coluna em um bloco", () => {
  const code = line("F-14", 30, 20);
  const nextCode = line("B-12", 70, 20);
  const grouped = { ...code, text: "F-14 B-12", height: 60, words: [...code.words, ...nextCode.words] };
  const result = selectPreferredNeighborhoodFromOcr(consensus([
    grouped,
    line("Campos dos Goytacazes Parque Rodoviário", 30, 200),
    line("Campos dos Goytacazes Centro", 70, 200)
  ]), preferred);
  assert.equal(result.status, "selected");
  assert.equal(result.detection.code, "F-14");
});

test("exige confiança dos nomes e código, não apenas média alta da linha", () => {
  const row = line("F-14 Campos dos Goytacazes Parque Rodoviário");
  row.words.at(-1).confidence = 20;
  assert.equal(selectPreferredNeighborhoodFromOcr(consensus([row]), preferred).status, "unsafe");
  assert.equal(selectPreferredNeighborhoodFromOcr(reading([row]), preferred).status, "unsafe");
});

test("texto sem geometria/confiança nunca é evidência para envio automático", () => {
  const source = { text: "F-14 Campos dos Goytacazes Parque Rodoviário", lines: [], source: "sem-tsv" };
  assert.equal(selectPreferredNeighborhoodFromOcr({ ...source, variants: [source, source] }, preferred).status, "unsafe");
});

test("nenhuma preferência jamais vira seleção automática de todas as gaiolas", () => {
  assert.equal(selectPreferredNeighborhoodFromOcr(consensus(["F-14 Cidade Centro"]), []).status, "unconfigured");
});

test("cidade opcional usa a coluna BAIRRO, sem confundir sufixo de bairro maior", () => {
  const headers = [line("GAIOLA", 10, 20), line("CIDADE", 10, 250), line("BAIRRO", 10, 700)];
  const source = consensus([
    ...headers,
    line("F-14", 60, 20), line("Cidade", 60, 250), line("Centro", 60, 700)
  ]);
  assert.equal(selectPreferredNeighborhoodFromOcr(source, [{ cidade: "", bairro: "Centro" }]).status, "selected");
  const longer = consensus([
    ...headers,
    line("F-14", 60, 20), line("Cidade", 60, 250), line("Novo Centro", 60, 700)
  ]);
  assert.equal(selectPreferredNeighborhoodFromOcr(longer, [{ cidade: "", bairro: "Centro" }]).status, "no-match");
  assert.equal(selectPreferredNeighborhoodFromOcr(consensus(["F-14 Cidade Centro"]), [{ cidade: "", bairro: "Centro" }]).status, "no-match");
});

test("linha com um código válido e outro ilegível continua ambígua", () => {
  assert.equal(selectPreferredNeighborhoodFromOcr(consensus([
    "1-24 F-14 Campos dos Goytacazes Parque Rodoviário"
  ]), preferred).status, "unsafe");
});

test("lote mantém coordenadas de fotos separadas e não empresta gaiola entre fotos", () => {
  const photoA = consensus(["F-14 Campos dos Goytacazes Centro"]);
  const photoB = consensus(["H-20 Campos dos Goytacazes Parque Rodoviário"]);
  const combined = combineRouteImageBatch([photoA, photoB]);
  assert.equal(selectPreferredNeighborhoodFromOcr(combined, preferred).detection.code, "H-20");
  const noCode = consensus(["Campos dos Goytacazes Parque Rodoviário"]);
  assert.equal(selectPreferredNeighborhoodFromOcr(combineRouteImageBatch([photoA, noCode]), preferred).status, "unsafe");
});

test("OCR real mantém cidade e bairro à direita da imagem completa", {
  skip: process.env.RUN_REAL_OCR_TESTS !== "1", timeout: 180000
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-neighborhood-ocr-"));
  try {
    const sharp = require("sharp");
    const image = path.join(temp, "table.png");
    const svg = `<svg width="1400" height="310" xmlns="http://www.w3.org/2000/svg"><rect width="1400" height="310" fill="white"/>
      <g font-family="Arial" font-size="28" fill="black">
      <text x="25" y="55">GAIOLA</text><text x="380" y="55">CIDADE</text><text x="1010" y="55">BAIRRO</text>
      <text x="25" y="130">F-14</text><text x="380" y="130">Campos dos Goytacazes</text><text x="1010" y="130">Parque Rodoviario</text>
      <text x="25" y="220">B-12</text><text x="380" y="220">Campos dos Goytacazes</text><text x="1010" y="220">Centro</text>
      </g></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(image);
    const ocr = await readRouteImageOcr(image, { preferCageCrop: false, fastFirst: false, maxReadings: 4 });
    const result = selectPreferredNeighborhoodFromOcr(ocr, preferred);
    assert.equal(result.status, "selected", JSON.stringify({ result, text: ocr.variants?.map((item) => item.text) }));
    assert.equal(result.detection.code, "F-14");
    assert.ok(result.detection.evidenceCount >= 2);
  } finally {
    await shutdownRouteOcrEngine();
    assert.ok(path.resolve(temp).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
