import xlsx from "xlsx";
import { buildRouteSummaries } from "./buildRouteSummaries";
import { getRomaneioColumnReport, normalizeRomaneioRows } from "./normalizeRomaneio";

export function parseRomaneioXlsx(filePath: string) {
  const workbook = xlsx.readFile(filePath, { cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => name.trim()) || workbook.SheetNames[0];
  if (!sheetName) throw new Error("O arquivo Excel não possui abas.");

  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "" });
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const report = getRomaneioColumnReport(columns);
  if (report.missing.length) {
    throw new Error(`Não foi possível processar o romaneio. Coluna obrigatória ausente: ${report.missing.join(", ")}`);
  }

  const normalizedRows = normalizeRomaneioRows(rows);
  const routes = buildRouteSummaries(normalizedRows);
  return {
    sheetName,
    columns,
    rowCount: rows.length,
    normalizedRowCount: normalizedRows.length,
    routes
  };
}
