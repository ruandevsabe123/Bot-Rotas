const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const xlsx = require("xlsx");
const { rankRoutes } = require("../dist/services/romaneio/rankRoutes.js");
const { RomaneioStore } = require("../dist/services/romaneio/romaneioStore.js");

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
