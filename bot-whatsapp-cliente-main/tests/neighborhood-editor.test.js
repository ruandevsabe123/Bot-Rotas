const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const test = require("node:test");
const {
  getNeighborhoodPreferences,
  moveNeighborhoodPreference,
  normalizeNeighborhoodPreferences
} = require("../dist/desktop/renderer/neighborhoodPreferences");

test("preferências preservam ordem e bairros homônimos em cidades diferentes", () => {
  const first = { cidade: " São Paulo ", bairro: " Vila   São José " };
  const routes = normalizeNeighborhoodPreferences([
    first,
    { cidade: "sao paulo", bairro: "vila sao jose" },
    { cidade: "Guarulhos", bairro: "Vila São José" },
    { cidade: "", bairro: "Centro" },
    { cidade: "São Paulo", bairro: "" }
  ]);
  assert.deepEqual(routes, [
    { cidade: "São Paulo", bairro: "Vila São José" },
    { cidade: "Guarulhos", bairro: "Vila São José" },
    { cidade: "", bairro: "Centro" }
  ]);
  assert.equal(first.cidade, " São Paulo ");
  assert.deepEqual(moveNeighborhoodPreference(routes, 2, 0), [routes[2], routes[0], routes[1]]);
  assert.equal(moveNeighborhoodPreference(routes, -1, 0), routes);
  assert.deepEqual(getNeighborhoodPreferences({ rotasMonitoradas: ["Antigo"], rotasMonitoradasDetalhadas: routes }), routes);
  assert.deepEqual(getNeighborhoodPreferences({ rotasMonitoradas: ["Centro"], rotasMonitoradasDetalhadas: [] }), [{ cidade: "", bairro: "Centro" }]);
});

// Exercise the component's real inputs and handlers without a browser dependency.
// Only hook scheduling is supplied here; JSX and application helpers are unchanged.
function renderEditor(overrides = {}) {
  const filename = path.resolve(__dirname, "../dist/desktop/renderer/components/GroupMessageCard.js");
  const nativeRequire = createRequire(filename);
  const slots = [];
  let cursor = 0;
  let pendingEffects = [];
  let changed = false;
  const react = {
    useState(initial) {
      const position = cursor++;
      if (!(position in slots)) slots[position] = typeof initial === "function" ? initial() : initial;
      return [slots[position], (value) => {
        const next = typeof value === "function" ? value(slots[position]) : value;
        if (!Object.is(next, slots[position])) changed = true;
        slots[position] = next;
      }];
    },
    useRef(initial) {
      const position = cursor++;
      return slots[position] ||= { current: initial };
    },
    useMemo(factory) { return factory(); },
    useEffect(effect, dependencies) {
      const position = cursor++;
      const previous = slots[position];
      if (!previous || dependencies.some((value, index) => !Object.is(value, previous[index]))) pendingEffects.push(effect);
      slots[position] = dependencies;
    }
  };
  const exports = {};
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    exports,
    require: (name) => name === "react" ? react : nativeRequire(name)
  }, { filename });
  const saved = [];
  const config = {
    grupoAlvoJid: "test@g.us", grupoAlvoNome: "Grupo teste", nomeEnvio: "Cliente",
    codigosMensagensAlvo: ["F-14"], rotasMonitoradas: ["Bairro antigo"],
    rotasMonitoradasDetalhadas: [{ cidade: "Cidade A", bairro: "Bairro antigo" }],
    routePresets: [], testMessageCount: 15, testMessageIntervalMs: 0
  };
  const props = {
    kind: "target", targetMode: "ocr", config, groups: [{ id: "test@g.us", name: "Grupo teste" }],
    busy: false, onRefresh() {}, onSave: (...args) => saved.push(args), ...overrides
  };
  let tree;
  const visit = (node, predicate, found = []) => {
    if (Array.isArray(node)) node.forEach((child) => visit(child, predicate, found));
    else if (node && typeof node === "object" && node.props) {
      if (predicate(node)) found.push(node);
      visit(node.props.children, predicate, found);
    }
    return found;
  };
  const render = () => {
    for (let iteration = 0; iteration < 5; iteration++) {
      cursor = 0;
      pendingEffects = [];
      changed = false;
      tree = exports.GroupMessageCard(props);
      pendingEffects.forEach((effect) => effect());
      if (!changed) return;
    }
    throw new Error("Editor did not settle");
  };
  render();
  return {
    saved, config,
    all: (predicate) => visit(tree, predicate),
    find: (predicate) => { const node = visit(tree, predicate)[0]; assert.ok(node, "Editor control missing"); return node; },
    change(node, value) { node.props.onChange({ target: { value } }); render(); },
    click(node) { assert.equal(Boolean(node.props.disabled), false); node.props.onClick({ preventDefault() {} }); render(); },
    submit() { visit(tree, (node) => node.type === "form")[0].props.onSubmit({ preventDefault() {} }); render(); }
  };
}

test("editor salva bairros visíveis e sua nova ordem, sem reutilizar códigos ou preferências antigas", () => {
  const editor = renderEditor();
  assert.equal(editor.all((node) => node.type === "textarea").length, 0);
  editor.change(editor.find((node) => node.props["aria-label"] === "Bairro da preferência 1"), "Centro");
  editor.change(editor.find((node) => node.props["aria-label"] === "Cidade da preferência 1 (opcional)"), "Cidade B");
  editor.change(editor.find((node) => node.props["aria-label"] === "Cidade padrão dos bairros"), "Campos dos Goytacazes");
  editor.click(editor.find((node) => node.type === "button" && node.props.children === "Adicionar outro bairro"));
  editor.change(editor.find((node) => node.props["aria-label"] === "Bairro da preferência 2"), "Jardim Sul");
  editor.click(editor.all((node) => node.props.title === "Aumentar preferência")[1]);
  editor.submit();
  const args = editor.saved[0];
  assert.deepEqual(JSON.parse(JSON.stringify(args[4])), ["Jardim Sul", "Centro"]);
  assert.deepEqual(JSON.parse(JSON.stringify(args[8])), [{ cidade: "Campos dos Goytacazes", bairro: "Jardim Sul" }, { cidade: "Cidade B", bairro: "Centro" }]);
  assert.equal(args[9], "ocr");
  assert.equal(editor.config.rotasMonitoradasDetalhadas[0].bairro, "Bairro antigo");
});

test("cidade padrão começa em Campos e preenche somente bairros sem cidade", () => {
  const editor = renderEditor({
    config: {
      grupoAlvoJid: "test@g.us", grupoAlvoNome: "Grupo teste", nomeEnvio: "Cliente",
      codigosMensagensAlvo: [], rotasMonitoradas: ["Centro"], rotasMonitoradasDetalhadas: [],
      routePresets: [], testMessageCount: 15, testMessageIntervalMs: 0
    }
  });
  const city = editor.find((node) => node.props["aria-label"] === "Cidade padrão dos bairros");
  assert.equal(city.props.value, "Campos dos Goytacazes");
  editor.click(editor.find((node) => node.type === "button" && node.props.children === "Aplicar onde está vazio"));
  assert.equal(editor.find((node) => node.props["aria-label"] === "Cidade da preferência 1 (opcional)").props.value, "Campos dos Goytacazes");
});

test("editor não inicia IA sem bairro ou com uma cidade sem bairro", () => {
  const editor = renderEditor();
  editor.change(editor.find((node) => node.props["aria-label"] === "Bairro da preferência 1"), " ");
  assert.equal(editor.find((node) => node.type === "button" && node.props.type === "submit").props.disabled, true);
  editor.submit();
  assert.equal(editor.saved.length, 0);
});

test("editor do target mantém códigos manuais e não aplica preferências da IA", () => {
  const editor = renderEditor({ targetMode: "manual" });
  assert.equal(editor.all((node) => node.props["aria-label"] === "Bairro da preferência 1").length, 0);
  editor.change(editor.find((node) => node.props.id === "target-codes"), "p12, f-14");
  editor.submit();
  assert.deepEqual(JSON.parse(JSON.stringify(editor.saved[0][4])), ["P-12", "F-14"]);
  assert.deepEqual(JSON.parse(JSON.stringify(editor.saved[0][8])), []);
  assert.equal(editor.saved[0][9], "manual");
});
