export type RomaneioRow = {
  rota: string;
  gaiola: string;
  plannedAt?: string;
  cidade?: string;
  distanciaKm: number;
  numOfOrder?: number;
  stop?: number;
  spxTn?: string;
  endereco?: string;
  bairro: string;
  tempoEstimado?: string;
  destinationStation?: string;
};

const COLUMN_ALIASES = {
  rota: ["Rota", "Route", "Route ID", "Route Name", "Route Code", "ID Rota", "Nome da Rota", "Código da Rota", "Codigo da Rota", "Trip", "Trip ID"],
  gaiola: ["Corridor Cage", "Gaiola", "Cage", "Cage ID", "Código da Gaiola", "Codigo da Gaiola", "Corredor", "Corridor"],
  bairro: ["Neighborhood", "Bairro", "District", "Bairro de Destino", "Destination Neighborhood"],
  distancia: ["Total Distance", "Distância", "Distancia", "Distância Total", "Distancia Total", "Route Distance", "Distance", "KM"],
  pacotes: ["Num of Order", "Number of Orders", "Order Count", "Orders", "Pacotes", "Pedidos", "Qtd Pacotes", "Quantidade de Pacotes", "Packages"],
  stop: ["Stop", "Stops", "Stop Number", "Num of Stop", "Paradas", "Número de Paradas", "Numero de Paradas", "Qtd Paradas"],
  sequence: ["Sequence", "Sequência", "Sequencia", "Seq"],
  spxTn: ["SPX TN", "Tracking Number", "Tracking", "Código do Pacote", "Codigo do Pacote", "Package ID", "Order ID"],
  endereco: ["Destination Address", "Endereço", "Endereco", "Address", "Endereço de Destino", "Endereco de Destino"],
  cidade: ["City", "Cidade", "Destination City", "Município", "Municipio"],
  tempoEstimado: ["Delivery Time", "Tempo Estimado", "Estimated Time", "Duration"],
  plannedAt: ["Planned AT", "Planned_AT", "Planned Route", "AT", "Assignment ID"],
  destinationStation: ["Destination Station", "Estação de Destino", "Estacao de Destino", "Station"]
} satisfies Record<string, string[]>;

export type RomaneioColumnKey = keyof typeof COLUMN_ALIASES;
export type RomaneioColumnMapping = Partial<Record<RomaneioColumnKey, string>>;

export const REQUIRED_ROMANEIO_COLUMNS: RomaneioColumnKey[] = ["gaiola", "bairro"];

export function normalizeRomaneioText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\b(pq)\b/g, "parque")
    .replace(/\b(jd)\b/g, "jardim")
    .replace(/\b(vl)\b/g, "vila")
    .replace(/\b(sto)\b/g, "santo")
    .replace(/\b(sta)\b/g, "santa")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDistanceKm(value: unknown) {
  const raw = String(value ?? "").replace(",", ".").replace(/km/i, "").replace(/[^\d.-]/g, "");
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(",", ".").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeColumnName(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function columnMatchScore(column: string, alias: string) {
  const normalizedColumn = normalizeColumnName(column);
  const normalizedAlias = normalizeColumnName(alias);
  if (!normalizedColumn || !normalizedAlias) return 0;
  if (normalizedColumn === normalizedAlias) return 100;
  if (normalizedColumn.replace(/\s/g, "") === normalizedAlias.replace(/\s/g, "")) return 98;
  const columnWords = new Set(normalizedColumn.split(" "));
  const aliasWords = normalizedAlias.split(" ");
  const overlap = aliasWords.filter((word) => columnWords.has(word)).length;
  if (aliasWords.length >= 2 && overlap === aliasWords.length) return 88 + Math.min(8, aliasWords.length);
  return 0;
}

export function resolveRomaneioColumns(columns: string[]) {
  const mapping: RomaneioColumnMapping = {};
  const usedColumns = new Set<string>();
  const fields = Object.keys(COLUMN_ALIASES) as RomaneioColumnKey[];

  for (const field of fields) {
    let best: { column: string; score: number } | undefined;
    for (const column of columns) {
      if (!String(column).trim() || usedColumns.has(column)) continue;
      const score = Math.max(...COLUMN_ALIASES[field].map((alias) => columnMatchScore(column, alias)));
      if (score > (best?.score || 0)) best = { column, score };
    }
    if (best && best.score >= 88) {
      mapping[field] = best.column;
      usedColumns.add(best.column);
    }
  }

  const missing = REQUIRED_ROMANEIO_COLUMNS.filter((field) => !mapping[field]).map((field) => COLUMN_ALIASES[field][0]);
  return { mapping, missing, matchedCount: Object.keys(mapping).length };
}

export function getRomaneioColumnReport(columns: string[]) {
  return resolveRomaneioColumns(columns);
}

function getCell(row: Record<string, unknown>, field: RomaneioColumnKey, mapping: RomaneioColumnMapping) {
  const column = mapping[field];
  return column ? row[column] : undefined;
}

export function normalizeRomaneioRows(rows: Record<string, unknown>[], providedMapping?: RomaneioColumnMapping) {
  const mapping = providedMapping || resolveRomaneioColumns(rows[0] ? Object.keys(rows[0]) : []).mapping;
  return rows
    .map((row): RomaneioRow => {
      const gaiola = String(getCell(row, "gaiola", mapping) || "").trim().toUpperCase();
      const plannedAt = String(getCell(row, "plannedAt", mapping) || "").trim() || undefined;
      const rota = String(getCell(row, "rota", mapping) || plannedAt || gaiola).trim();
      return {
        rota,
        gaiola,
        plannedAt,
        cidade: String(getCell(row, "cidade", mapping) || "").trim() || undefined,
        distanciaKm: parseDistanceKm(getCell(row, "distancia", mapping)),
        numOfOrder: parseNumber(getCell(row, "pacotes", mapping)) || undefined,
        stop: parseNumber(getCell(row, "stop", mapping)) || undefined,
        spxTn: String(getCell(row, "spxTn", mapping) || "").trim() || undefined,
        endereco: String(getCell(row, "endereco", mapping) || "").trim() || undefined,
        bairro: String(getCell(row, "bairro", mapping) || "").trim(),
        tempoEstimado: String(getCell(row, "tempoEstimado", mapping) || "").trim() || undefined,
        destinationStation: String(getCell(row, "destinationStation", mapping) || "").trim() || undefined
      };
    })
    .filter((row) => row.rota && row.gaiola && row.bairro);
}

export function matchesNormalizedText(value: string, wanted: string) {
  const normalizedValue = normalizeRomaneioText(value);
  const normalizedWanted = normalizeRomaneioText(wanted);
  if (!normalizedValue || !normalizedWanted) return false;
  return normalizedValue.includes(normalizedWanted) || normalizedWanted.includes(normalizedValue) || fuzzyContains(normalizedValue, normalizedWanted);
}

function fuzzyContains(value: string, wanted: string) {
  const valueWords = new Set(value.split(" ").filter((item) => item.length > 2));
  const wantedWords = wanted.split(" ").filter((item) => item.length > 2);
  if (!wantedWords.length) return false;
  const matches = wantedWords.filter((word) => valueWords.has(word) || Array.from(valueWords).some((valueWord) => valueWord.startsWith(word) || word.startsWith(valueWord)));
  return matches.length / wantedWords.length >= 0.66;
}
