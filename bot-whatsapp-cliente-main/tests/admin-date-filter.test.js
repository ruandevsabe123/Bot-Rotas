const test = require("node:test");
const assert = require("node:assert/strict");
const { getAdminDatePreset, isDateInsideAdminRange } = require("../dist/desktop/renderer/adminDateFilter.js");

test("filtros mensais do admin respeitam virada de ano", () => {
  const now = new Date(2026, 0, 15, 12, 0, 0);
  assert.deepEqual(getAdminDatePreset("current-month", now), { startDate: "2026-01-01", endDate: "2026-01-15" });
  assert.deepEqual(getAdminDatePreset("previous-month", now), { startDate: "2025-12-01", endDate: "2025-12-31" });
  assert.deepEqual(getAdminDatePreset("all", now), { startDate: "", endDate: "" });
});

test("calendario inclui o dia final inteiro sem alterar os dados", () => {
  assert.equal(isDateInsideAdminRange("2026-10-09T23:59:59", "2026-10-01", "2026-10-09"), true);
  assert.equal(isDateInsideAdminRange("2026-09-30T23:59:59", "2026-10-01", "2026-10-09"), false);
  assert.equal(isDateInsideAdminRange("2024-01-01T00:00:00.000Z", "", ""), true);
});
