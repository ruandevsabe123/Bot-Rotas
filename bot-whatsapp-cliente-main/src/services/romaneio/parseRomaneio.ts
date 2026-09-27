import xlsx from "xlsx";
import { buildRouteSummaries } from "./buildRouteSummaries";
import { getRomaneioColumnReport, normalizeRomaneioRows, RomaneioColumnMapping } from "./normalizeRomaneio";

const MAX_HEADER_SCAN_ROWS = 50;

type SheetCandidate = {
  sheetName: string;
  headerRowIndex: number;
  columns: string[];
  mapping: RomaneioColumnMapping;
  missing: string[];
  matchedCount: number;
  score: number;
  rowCount: number;
  usableRows: number;
};

export function parseRomaneioXlsx(input: string | Buffer) {
  const workbook = Buffer.isBuffer(input)
    ? xlsx.read(input, { type: "buffer", cellDates: false })
    : xlsx.readFile(input, { cellDates: false });
  if (!workbook.SheetNames.length) throw new Error("O arquivo Excel não possui abas.");

  const candidates = workbook.SheetNames.flatMap((sheetName) => findSheetCandidates(workbook.Sheets[sheetName], sheetName));
  const validCandidates = candidates.filter((candidate) => !candidate.missing.length && candidate.usableRows > 0);
  const selected = [...validCandidates].sort((a, b) => b.score - a.score || b.rowCount - a.rowCount)[0];
  if (!selected) {
    const closest = [...candidates].sort((a, b) => b.matchedCount - a.matchedCount || b.rowCount - a.rowCount)[0];
    const missing = closest?.missing.length ? closest.missing.join(", ") : "Corridor Cage/Gaiola e Neighborhood/Bairro";
    throw new Error(`Não foi possível identificar um romaneio seguro em nenhuma aba. Campos indispensáveis não encontrados: ${missing}.`);
  }

  const sheetName = selected.sheetName;
  const worksheet = workbook.Sheets[sheetName];
  const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: "",
    range: selected.headerRowIndex,
    raw: false
  });
  const range = worksheet["!ref"] ? xlsx.utils.decode_range(worksheet["!ref"]) : undefined;
  const physicalRowCount = range ? range.e.r - range.s.r + 1 : rows.length;
  const columns = rows[0] ? Object.keys(rows[0]) : [];
  const report = getRomaneioColumnReport(columns);
  if (report.missing.length) {
    throw new Error(`Não foi possível processar o romaneio. Campo indispensável ausente: ${report.missing.join(", ")}`);
  }

  const normalizedRows = normalizeRomaneioRows(rows, report.mapping);
  const routes = buildRouteSummaries(normalizedRows);
  if (!routes.length) throw new Error("O cabeçalho foi reconhecido, mas nenhuma linha possui gaiola e bairro válidos.");
  const warnings = buildWarnings(selected, report.mapping, rows.length, normalizedRows.length, workbook.SheetNames[0]);
  return {
    sheetName,
    headerRow: selected.headerRowIndex + 1,
    columns,
    columnMapping: report.mapping,
    warnings,
    rowCount: physicalRowCount,
    dataRowCount: rows.length,
    normalizedRowCount: normalizedRows.length,
    routes
  };
}

function findSheetCandidates(worksheet: xlsx.WorkSheet, sheetName: string): SheetCandidate[] {
  if (!worksheet["!ref"]) return [];
  const range = xlsx.utils.decode_range(worksheet["!ref"]);
  const rowCount = range.e.r - range.s.r + 1;
  const scanRange = { s: range.s, e: { r: Math.min(range.e.r, range.s.r + MAX_HEADER_SCAN_ROWS + 199), c: range.e.c } };
  const matrix = xlsx.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "", raw: false, blankrows: true, range: scanRange });
  return matrix.slice(0, MAX_HEADER_SCAN_ROWS).map((row, relativeHeaderIndex) => {
    const headerRowIndex = range.s.r + relativeHeaderIndex;
    const columns = row.map((cell) => String(cell || "").trim()).filter(Boolean);
    const report = getRomaneioColumnReport(columns);
    const cageIndex = row.findIndex((cell) => String(cell || "").trim() === report.mapping.gaiola);
    const neighborhoodIndex = row.findIndex((cell) => String(cell || "").trim() === report.mapping.bairro);
    const usableRows = cageIndex >= 0 && neighborhoodIndex >= 0
      ? matrix.slice(relativeHeaderIndex + 1, relativeHeaderIndex + 201).filter((dataRow) => String(dataRow[cageIndex] || "").trim() && String(dataRow[neighborhoodIndex] || "").trim()).length
      : 0;
    const hasRouteIdentity = Boolean(report.mapping.rota || report.mapping.plannedAt);
    const optionalMetrics = [report.mapping.distancia, report.mapping.pacotes, report.mapping.stop].filter(Boolean).length;
    const score = (report.missing.length ? 0 : 10_000) + report.matchedCount * 100 + (hasRouteIdentity ? 80 : 0) + optionalMetrics * 25 + Math.min(500, usableRows * 5) - headerRowIndex;
    return { sheetName, headerRowIndex, columns, mapping: report.mapping, missing: report.missing, matchedCount: report.matchedCount, score, rowCount, usableRows };
  }).filter((candidate) => candidate.columns.length >= 2);
}

function buildWarnings(selected: SheetCandidate, mapping: RomaneioColumnMapping, dataRows: number, normalizedRows: number, firstSheet?: string) {
  const warnings: string[] = [];
  if (selected.sheetName !== firstSheet) warnings.push(`A aba "${selected.sheetName}" foi escolhida automaticamente por conter os dados do romaneio.`);
  if (selected.headerRowIndex > 0) warnings.push(`O cabeçalho foi identificado automaticamente na linha ${selected.headerRowIndex + 1}.`);
  if (!mapping.rota && mapping.plannedAt) warnings.push(`A coluna Rota não existe; "${mapping.plannedAt}" foi usada como identificador da rota.`);
  if (!mapping.rota && !mapping.plannedAt) warnings.push("Rota e Planned AT não existem; a gaiola foi usada como identificador da rota.");
  if (!mapping.pacotes) warnings.push("A quantidade de pacotes foi calculada pelas linhas e códigos de pacote.");
  if (!mapping.stop) warnings.push("A quantidade de paradas foi calculada pelos endereços disponíveis.");
  if (!mapping.distancia) warnings.push("A distância não foi informada e ficou sem valor para os filtros.");
  if (normalizedRows < dataRows) warnings.push(`${dataRows - normalizedRows} linha(s) sem gaiola ou bairro foram ignoradas.`);
  return warnings;
}
