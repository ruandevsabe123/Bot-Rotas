const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const xlsx = require("xlsx");
const { rankRoutes } = require("../dist/services/romaneio/rankRoutes.js");
const { RomaneioStore } = require("../dist/services/romaneio/romaneioStore.js");
const { parseRomaneioXlsx } = require("../dist/services/romaneio/parseRomaneio.js");

function route(rota, gaiola, distanciaKm, paradas, pacotes) {
  return {
    rota,
    gaiola,
    cidade: "Cabo Frio",
    distanciaKm,
    paradas,
    pacotes,
    bairros: [{ nome: "Centro", pacotes, percentualNaRota: 100 }]
  };
}

test("mantém somente a gaiola exata e coloca a menor distância primeiro", () => {
  const ranked = rankRoutes([
    route("Rota 1", "F-14", 40, 30, 80),
    route("Rota 2", "F-14", 18, 35, 90),
    route("Rota 3", "H-34", 5, 10, 20)
  ], { gaiola: "F-14", bairro: "Centro" }, { prioridade: "menor_distancia" });

  assert.deepEqual(ranked.map((item) => item.gaiola), ["F-14", "F-14"]);
  assert.equal(ranked[0].rota, "Rota 2");
});

test("rotas dentro dos filtros ficam antes das rotas que ultrapassam limites", () => {
  const ranked = rankRoutes([
    route("Dentro", "F-14", 24, 20, 60),
    route("Fora", "F-14", 12, 55, 60)
  ], { gaiola: "F-14", bairro: "Centro" }, {
    prioridade: "menor_distancia",
    paradasMax: 40
  });

  assert.equal(ranked[0].rota, "Dentro");
  assert.equal(ranked[0].passedFilters, true);
  assert.equal(ranked[1].passedFilters, false);
});

test("restaura o romaneio salvo depois de reiniciar ou fazer deploy", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "romaneio-restart-"));
  try {
    const workbook = xlsx.utils.book_new();
    const sheet = xlsx.utils.json_to_sheet([{
      Rota: "Rota 1",
      "Corridor Cage": "H-25",
      Neighborhood: "Centro",
      "Total Distance": 12,
      "Num of Order": 80,
      Stop: 30,
      City: "Campos dos Goytacazes"
    }]);
    xlsx.utils.book_append_sheet(workbook, sheet, "Romaneio");
    const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
    const store = new RomaneioStore(dir);
    store.saveUpload("romaneio.xlsx", buffer);

    fs.rmSync(path.join(dir, "processed.json"));
    const restartedStore = new RomaneioStore(dir);
    const restored = restartedStore.all();

    assert.equal(restored.status.loaded, true);
    assert.equal(restored.routes.length, 1);
    assert.equal(restored.routes[0].gaiola, "H-25");
    assert.equal(fs.existsSync(path.join(dir, "processed.json")), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeWorkbook(workbook) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "romaneio-format-"));
  const filePath = path.join(dir, "romaneio.xlsx");
  xlsx.writeFile(workbook, filePath);
  return { dir, filePath };
}

test("usa Planned AT como rota quando a coluna Rota não existe", () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { "Planned AT": "AT-001", "Corridor Cage": "A-1", Neighborhood: "Centro", "Total Distance": "12.5km", "Num of Order": 2, Stop: 1, "SPX TN": "PKG-1" },
    { "Planned AT": "AT-001", "Corridor Cage": "A-1", Neighborhood: "Pelinca", "Total Distance": "12.5km", "Num of Order": 2, Stop: 2, "SPX TN": "PKG-2" }
  ]), "ROMANEIO");
  const { dir, filePath } = writeWorkbook(workbook);
  try {
    const parsed = parseRomaneioXlsx(filePath);
    assert.equal(parsed.routes.length, 1);
    assert.equal(parsed.routes[0].rota, "AT-001");
    assert.equal(parsed.routes[0].gaiola, "A-1");
    assert.equal(parsed.routes[0].pacotes, 2);
    assert.match(parsed.warnings.join(" "), /Planned AT/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("encontra automaticamente aba, cabeçalho deslocado e colunas renomeadas", () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([["Instruções"], ["Não importar esta aba"]]), "LEIA-ME");
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([
    ["Relatório operacional", "18/07/2026"],
    [],
    ["Trip ID", "Cage ID", "District", "Route Distance", "Packages", "Stops", "Tracking Number", "Address", "Destination City"],
    ["TRIP-9", "H-34", "Centro", "18,7 km", 2, 1, "PKG-1", "Rua A, 10", "Campos"],
    ["TRIP-9", "H-34", "Pelinca", "18,7 km", 2, 2, "PKG-2", "Rua B, 20", "Campos"]
  ]), "DADOS");
  const { dir, filePath } = writeWorkbook(workbook);
  try {
    const parsed = parseRomaneioXlsx(filePath);
    assert.equal(parsed.sheetName, "DADOS");
    assert.equal(parsed.headerRow, 3);
    assert.equal(parsed.routes[0].rota, "TRIP-9");
    assert.equal(parsed.routes[0].distanciaKm, 18.7);
    assert.match(parsed.warnings.join(" "), /aba "DADOS"/);
    assert.match(parsed.warnings.join(" "), /linha 3/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("infere rota, pacotes e paradas em um romaneio mínimo", () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([
    { Gaiola: "F-14", Bairro: "Centro", "Código do Pacote": "P-1", Endereco: "Rua A, 10" },
    { Gaiola: "F-14", Bairro: "Centro", "Código do Pacote": "P-2", Endereco: "Rua B, 20" }
  ]), "Rotas");
  const { dir, filePath } = writeWorkbook(workbook);
  try {
    const parsed = parseRomaneioXlsx(filePath);
    assert.equal(parsed.routes[0].rota, "F-14");
    assert.equal(parsed.routes[0].pacotes, 2);
    assert.equal(parsed.routes[0].paradas, 2);
    assert.equal(parsed.routes[0].distanciaKm, 0);
    assert.match(parsed.warnings.join(" "), /gaiola foi usada/);
    assert.match(parsed.warnings.join(" "), /distância não foi informada/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("recusa arquivo sem gaiola ou bairro em vez de inventar rota", () => {
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([{ Route: "R-1", City: "Campos" }]), "Dados");
  const { dir, filePath } = writeWorkbook(workbook);
  try {
    assert.throws(() => parseRomaneioXlsx(filePath), /Campos indispensáveis/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("distância desconhecida não aparece antes de uma distância válida", () => {
  const ranked = rankRoutes([
    route("Sem distância", "F-14", 0, 10, 20),
    route("Com distância", "F-14", 12, 10, 20)
  ], { gaiola: "F-14" }, { prioridade: "menor_distancia" });
  assert.equal(ranked[0].rota, "Com distância");
});
