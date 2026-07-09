import { RomaneioRouteSummary } from "../../shared/types";
import { normalizeRomaneioText, RomaneioRow } from "./normalizeRomaneio";

export function buildRouteSummaries(rows: RomaneioRow[]): RomaneioRouteSummary[] {
  const groups = new Map<string, RomaneioRow[]>();

  for (const row of rows) {
    const key = [normalizeRomaneioText(row.rota), row.gaiola.toUpperCase(), row.plannedAt || ""].join("|");
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  return Array.from(groups.values())
    .map(buildSummary)
    .sort((a, b) => a.rota.localeCompare(b.rota, "pt-BR", { numeric: true }) || a.gaiola.localeCompare(b.gaiola));
}

function buildSummary(rows: RomaneioRow[]): RomaneioRouteSummary {
  const first = rows[0];
  const uniquePackages = new Set(rows.map((row) => row.spxTn).filter(Boolean) as string[]);
  const bairroCounts = new Map<string, { nome: string; count: number }>();

  for (const row of rows) {
    const bairro = row.bairro || "Sem bairro";
    const key = normalizeRomaneioText(bairro) || bairro;
    const current = bairroCounts.get(key);
    bairroCounts.set(key, {
      nome: current?.nome || bairro,
      count: (current?.count || 0) + 1
    });
  }

  const pacotes = Math.max(...rows.map((row) => row.numOfOrder || 0), uniquePackages.size, rows.length);
  const paradas = Math.max(...rows.map((row) => row.stop || 0), 0);
  const bairros = Array.from(bairroCounts.values())
    .map(({ nome, count }) => ({
      nome,
      pacotes: count,
      percentualNaRota: pacotes > 0 ? Number(((count / pacotes) * 100).toFixed(1)) : 0
    }))
    .sort((a, b) => b.pacotes - a.pacotes || a.nome.localeCompare(b.nome));

  return {
    rota: first.rota,
    gaiola: first.gaiola,
    plannedAt: first.plannedAt,
    cidade: first.cidade,
    distanciaKm: Math.max(...rows.map((row) => row.distanciaKm || 0), 0),
    pacotes,
    paradas,
    tempoEstimado: first.tempoEstimado,
    bairros,
    pacotesIds: Array.from(uniquePackages),
    pacotesDetalhes: rows.slice(0, 500).map((row) => ({
      id: row.spxTn,
      endereco: row.endereco,
      bairro: row.bairro,
      cidade: row.cidade,
      stop: row.stop
    }))
  };
}
