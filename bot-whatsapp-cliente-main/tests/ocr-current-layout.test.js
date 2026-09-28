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
      const y = 78 + index * 58;
      const fill = index % 2 ? "#f4f5f6" : "#ffffff";
      return `<rect x="0" y="${y - 36}" width="1500" height="58" fill="${fill}"/>` +
        `<text x="18" y="${y}">${row[0]}</text><text x="155" y="${y}">${row[1]}</text>` +
        `<text x="455" y="${y}">${row[2]}</text><text x="700" y="${y}">${row[3]}</text>` +
        `<text x="1210" y="${y}">${row[4]}</text>`;
    }).join("");
    const svg = `<svg width="1500" height="300" xmlns="http://www.w3.org/2000/svg">
      <rect width="1500" height="300" fill="white"/><rect width="1500" height="35" fill="#f04400"/>
      <g font-family="Arial" font-size="25" fill="#303030">${lines}</g></svg>`;
    await sharp(Buffer.from(svg)).png().toFile(image);

    const ocr = await readRouteImageOcr(image, { preferCageCrop: false, fastFirst: false, maxReadings: 4 });
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
