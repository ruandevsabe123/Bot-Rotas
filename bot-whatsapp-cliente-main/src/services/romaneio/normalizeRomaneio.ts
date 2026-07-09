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

const COLUMN_ALIASES: Record<string, string[]> = {
  rota: ["Rota", "Route"],
  gaiola: ["Corridor Cage", "Gaiola"],
  bairro: ["Neighborhood", "Bairro"],
  distancia: ["Total Distance", "Distância", "Distancia"],
  pacotes: ["Num of Order", "Pacotes", "Pedidos"],
  stop: ["Stop", "Paradas"],
  spxTn: ["SPX TN"],
  endereco: ["Destination Address", "Endereço", "Endereco"],
  cidade: ["City", "Cidade"],
  tempoEstimado: ["Delivery Time"],
  plannedAt: ["Planned AT"],
  destinationStation: ["Destination Station"]
};

export const REQUIRED_ROMANEIO_COLUMNS = ["rota", "gaiola", "bairro", "distancia", "pacotes", "stop"];

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

function getCell(row: Record<string, unknown>, aliases: string[]) {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const exact = keys.find((key) => key.trim().toLowerCase() === alias.toLowerCase());
    if (exact) return row[exact];
  }
  return undefined;
}

export function getRomaneioColumnReport(columns: string[]) {
  const normalizedColumns = columns.map((item) => item.trim().toLowerCase());
  const missing = REQUIRED_ROMANEIO_COLUMNS
    .filter((key) => !COLUMN_ALIASES[key].some((alias) => normalizedColumns.includes(alias.toLowerCase())))
    .map((key) => COLUMN_ALIASES[key][0]);
  return { missing };
}

export function normalizeRomaneioRows(rows: Record<string, unknown>[]) {
  return rows
    .map((row): RomaneioRow => ({
      rota: String(getCell(row, COLUMN_ALIASES.rota) || "").trim(),
      gaiola: String(getCell(row, COLUMN_ALIASES.gaiola) || "").trim().toUpperCase(),
      plannedAt: String(getCell(row, COLUMN_ALIASES.plannedAt) || "").trim() || undefined,
      cidade: String(getCell(row, COLUMN_ALIASES.cidade) || "").trim() || undefined,
      distanciaKm: parseDistanceKm(getCell(row, COLUMN_ALIASES.distancia)),
      numOfOrder: parseNumber(getCell(row, COLUMN_ALIASES.pacotes)) || undefined,
      stop: parseNumber(getCell(row, COLUMN_ALIASES.stop)) || undefined,
      spxTn: String(getCell(row, COLUMN_ALIASES.spxTn) || "").trim() || undefined,
      endereco: String(getCell(row, COLUMN_ALIASES.endereco) || "").trim() || undefined,
      bairro: String(getCell(row, COLUMN_ALIASES.bairro) || "").trim(),
      tempoEstimado: String(getCell(row, COLUMN_ALIASES.tempoEstimado) || "").trim() || undefined,
      destinationStation: String(getCell(row, COLUMN_ALIASES.destinationStation) || "").trim() || undefined
    }))
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
