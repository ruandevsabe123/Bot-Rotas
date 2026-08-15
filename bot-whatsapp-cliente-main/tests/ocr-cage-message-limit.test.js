const test = require("node:test");
const assert = require("node:assert/strict");
const { selectRankedDesiredCages } = require("../dist/bot/ocrCageSelection.js");

const ranked = ["C-30", "B-29", "C-25", "A-1"].map((gaiola) => ({ gaiola }));

test("envia todas as gaiolas selecionadas encontradas quando o limite é zero", () => {
  assert.deepEqual(
    selectRankedDesiredCages(ranked, ["C-25", "C-30", "B-29"], 0).map((item) => item.gaiola),
    ["C-30", "B-29", "C-25"]
  );
});

test("envia somente as melhores encontradas conforme o limite escolhido", () => {
  assert.deepEqual(
    selectRankedDesiredCages(ranked, ["C-25", "C-30", "B-29"], 2).map((item) => item.gaiola),
    ["C-30", "B-29"]
  );
  assert.deepEqual(
    selectRankedDesiredCages(ranked, ["C-25", "C-30"], 1).map((item) => item.gaiola),
    ["C-30"]
  );
});
