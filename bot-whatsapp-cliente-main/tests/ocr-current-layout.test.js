const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { readRouteImageOcr, shutdownRouteOcrEngine } = require("../dist/bot/ocr.js");
const { selectPreferredNeighborhoodFromOcr } = require("../dist/bot/ocrNeighborhoodSelection.js");

test("OCR reconhece o layout operacional atual sem cabecalho", {
  skip: process.env.RUN_REAL_OCR_TESTS !== "1",
  timeout: 180000
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-current-layout-"));
  try {
    const sharp = require("sharp");
    const image = path.join(temp, "rotas.png");
    const rows = [
      ["H-21", "AT20260926ABVY2", "100", "Campos dos Goytacazes", "Ibitioca"],
      ["H-17", "AT20260926ABVRN", "106", "Campos dos Goytacazes", "Centro"],
      ["G-14", "AT20260926ABV8Q", "97", "Italva", "Parque industrial"],
      ["G-2", "AT20260926ABWLR", "79", "São Francisco de Itabapoana", "Floresta"]
    ];
    const lines = rows.map((row, index) => {
      const y = 78 + index * 29;
      const fill = index % 2 ? "#f4f5f6" : "#ffffff";
      return `<rect x="0" y="${y - 19}" width="1000" height="29" fill="${fill}"/>` +
        `<text x="12" y="${y}">${row[0]}</text><text x="104" y="${y}">${row[1]}</text>` +
        `<text x="303" y="${y}">${row[2]}</text><text x="467" y="${y}">${row[3]}</text>` +
        `<text x="837" y="${y}">${row[4]}</text>`;
    }).join("");
    const svg = `<svg width="1000" height="201" xmlns="http://www.w3.org/2000/svg">
      <rect width="1000" height="201" fill="white"/><rect width="1000" height="27" fill="#f04400"/>
      <g font-family="Arial" font-size="16" fill="#303030">${lines}</g></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(image);

    const ocr = await readRouteImageOcr(image, { preferCageCrop: false, fastFirst: false, maxReadings: 5 });
    const result = selectPreferredNeighborhoodFromOcr(ocr, [
      { cidade: "", bairro: "Floresta" },
      { cidade: "", bairro: "Centro" }
    ]);
    assert.equal(result.status, "selected", JSON.stringify({ result, variants: ocr.variants?.map((item) => item.text) }));
    assert.equal(result.detection.code, "G-2");
  } finally {
    await shutdownRouteOcrEngine();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("OCR ampliado preserva B das gaiolas em captura pequena e comprimida", {
  skip: process.env.RUN_REAL_OCR_TESTS !== "1",
  timeout: 180000
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bot-blurred-layout-"));
  try {
    const sharp = require("sharp");
    const image = path.join(temp, "rotas-comprimidas.jpg");
    const rows = [
      ["C-3", "AT20260927ACYGR", "100", "Campos dos Goytacazes", "Goitacazes"],
      ["B-28", "AT20260927ACYGD", "116", "Campos dos Goytacazes", "Tapera"],
      ["B-25", "AT20260927ACQJ", "114", "Campos dos Goytacazes", "Centro"],
      ["B-18", "AT20260927ACQL5", "116", "Campos dos Goytacazes", "Centro"],
      ["B-19", "AT20260927ACYAZ", "117", "Campos dos Goytacazes", "Centro"]
    ];
    const lines = rows.map((row, index) => {
      const y = 24 + index * 20;
      return `<text x="8" y="${y}">${row[0]}</text><text x="82" y="${y}">${row[1]}</text>` +
        `<text x="240" y="${y}">${row[2]}</text><text x="355" y="${y}">${row[3]}</text>` +
        `<text x="590" y="${y}">${row[4]}</text>`;
    }).join("");
    const svg = `<svg width="732" height="130" xmlns="http://www.w3.org/2000/svg"><rect width="732" height="130" fill="white"/>
      <g font-family="Arial" font-size="11" fill="#505050">${lines}</g></svg>`;
    await sharp(Buffer.from(svg)).blur(0.45).jpeg({ quality: 58 }).toFile(image);
    const ocr = await readRouteImageOcr(image, { preferCageCrop: false, fastFirst: false, maxReadings: 5 });
    const result = selectPreferredNeighborhoodFromOcr(ocr, [{ cidade: "Campos dos Goytacazes", bairro: "Centro" }]);
    assert.equal(result.status, "selected", JSON.stringify({ result, variants: ocr.variants?.map((item) => item.text) }));
    assert.equal(result.detection.code, "B-25");
  } finally {
    await shutdownRouteOcrEngine();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
