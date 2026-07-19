const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isPreferredImageCity,
  rankImageRouteOptions
} = require("../dist/services/romaneio/rankImageRoutes.js");

function option(id, cidade, distanciaKm, paradas, pacotes, overrides = {}) {
  return {
    id,
    rank: 0,
    rota: `AT-${id}`,
    gaiola: id,
    cidade,
    bairro: "Centro",
    distanciaKm,
    paradas,
    pacotes,
    passedFilters: true,
    reasons: [],
    score: 0,
    romaneioMatch: true,
    ...overrides
  };
}

test("prioriza Campos dos Goytacazes antes das demais cidades", () => {
  const ranked = rankImageRouteOptions([
    option("B-1", "São João da Barra", 5, 10, 20),
    option("C-2", "Campos dos Goytacazes", 30, 50, 100),
    option("B-2", "São Francisco de Itabapoana", 8, 12, 25)
  ], "menor_distancia");

  assert.equal(ranked[0].gaiola, "C-2");
  assert.deepEqual(ranked.map((item) => item.rank), [1, 2, 3]);
});

test("reconhece variações usuais do nome de Campos", () => {
  assert.equal(isPreferredImageCity("Campos dos Goytacazes"), true);
  assert.equal(isPreferredImageCity("Campos Goytacazes"), true);
  assert.equal(isPreferredImageCity("Campos dos Goitacazes"), true);
  assert.equal(isPreferredImageCity("São Fidélis"), false);
});

test("mantém todas as rotas e ordena as demais pela preferência do romaneio", () => {
  const input = [
    option("B-1", "Italva", 42, 20, 80),
    option("B-2", "Quissamã", 12, 30, 90),
    option("B-3", "São Fidélis", 25, 10, 40),
    option("B-4", undefined, 0, 0, 0, { romaneioMatch: false, passedFilters: false })
  ];
  const ranked = rankImageRouteOptions(input, "menor_distancia");

  assert.equal(ranked.length, input.length);
  assert.deepEqual(ranked.map((item) => item.gaiola), ["B-2", "B-3", "B-1", "B-4"]);
});
