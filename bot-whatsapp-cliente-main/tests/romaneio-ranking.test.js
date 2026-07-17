const test = require("node:test");
const assert = require("node:assert/strict");
const { rankRoutes } = require("../dist/services/romaneio/rankRoutes.js");

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
