const assert = require("node:assert/strict");
const test = require("node:test");

const { shouldUseIsolatedOcr } = require("../dist/bot/ocrIsolated.js");

test("isola OCR automaticamente no Render", () => {
  assert.equal(shouldUseIsolatedOcr({ RENDER: "true" }), true);
  assert.equal(shouldUseIsolatedOcr({ RENDER: "true", OCR_ISOLATED_PROCESS: "false" }), false);
  assert.equal(shouldUseIsolatedOcr({ OCR_ISOLATED_PROCESS: "true" }), true);
  assert.equal(shouldUseIsolatedOcr({}), false);
});
