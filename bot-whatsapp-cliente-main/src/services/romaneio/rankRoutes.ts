import { RomaneioDetectedInfo, RomaneioRankedRoute, RomaneioRouteSummary, RomaneioSettings } from "../../shared/types";
import { matchesNormalizedText, normalizeRomaneioText } from "./normalizeRomaneio";

export const DEFAULT_ROMANEIO_SETTINGS: RomaneioSettings = {
  bairrosPreferidos: [],
  prioridade: "equilibrio_geral"
};

export function matchNeighborhood(routes: RomaneioRouteSummary[], bairro: string) {
  return routes.filter((route) => route.bairros.some((item) => matchesNormalizedText(item.nome, bairro)));
}

export function filterRoutes(routes: RomaneioRouteSummary[], filters: RomaneioSettings) {
  return routes.filter((route) => getFilterReasons(route, filters).length === 0);
}

export function rankRoutes(routes: RomaneioRouteSummary[], detectedInfo: RomaneioDetectedInfo, filters: RomaneioSettings): RomaneioRankedRoute[] {
  const candidates = getCandidates(routes, detectedInfo, filters);
  const maxDistance = Math.max(...candidates.map((route) => route.distanciaKm || 0), 1);
  const maxStops = Math.max(...candidates.map((route) => route.paradas || 0), 1);
  const maxPackages = Math.max(...candidates.map((route) => route.pacotes || 0), 1);

  return candidates
    .map((route) => {
      const bairroMatch = getBestNeighborhoodMatch(route, detectedInfo.bairro || filters.bairrosPreferidos[0] || "");
      const reasons = getFilterReasons(route, filters);
      const bairroScore = (bairroMatch?.percentualNaRota || 0) / 100;
      const distanciaScore = 1 - ((route.distanciaKm || 0) / maxDistance);
      const paradasScore = 1 - ((route.paradas || 0) / maxStops);
      const pacotesScore = 1 - ((route.pacotes || 0) / maxPackages);
      return {
        ...route,
        bairroMatch,
        passedFilters: reasons.length === 0,
        reasons,
        score: Number((bairroScore * 0.45 + distanciaScore * 0.25 + paradasScore * 0.2 + pacotesScore * 0.1).toFixed(4))
      };
    })
    .sort((a, b) => compareRankedRoutes(a, b, filters.prioridade));
}

function getCandidates(routes: RomaneioRouteSummary[], detectedInfo: RomaneioDetectedInfo, filters: RomaneioSettings) {
  if (detectedInfo.gaiola) {
    const wanted = normalizeRomaneioText(detectedInfo.gaiola);
    const found = routes.filter((route) => normalizeRomaneioText(route.gaiola) === wanted);
    if (found.length) return found;
  }

  if (detectedInfo.rota) {
    const wanted = normalizeRomaneioText(detectedInfo.rota);
    const found = routes.filter((route) => normalizeRomaneioText(route.rota).includes(wanted) || wanted.includes(normalizeRomaneioText(route.rota)));
    if (found.length) return found;
  }

  const neighborhoods = [detectedInfo.bairro, ...filters.bairrosPreferidos].filter(Boolean) as string[];
  if (neighborhoods.length) {
    const found = routes.filter((route) => neighborhoods.some((bairro) => getBestNeighborhoodMatch(route, bairro)));
    if (found.length) return found;
  }

  return routes;
}

function getBestNeighborhoodMatch(route: RomaneioRouteSummary, bairro: string) {
  if (!bairro) return undefined;
  return route.bairros
    .filter((item) => matchesNormalizedText(item.nome, bairro))
    .sort((a, b) => b.percentualNaRota - a.percentualNaRota)[0];
}

function getFilterReasons(route: RomaneioRouteSummary, filters: RomaneioSettings) {
  const reasons: string[] = [];
  if (filters.distanciaMaxKm && route.distanciaKm > filters.distanciaMaxKm) reasons.push("Passou da distância máxima configurada.");
  if (filters.paradasMax && route.paradas > filters.paradasMax) reasons.push("Passou do limite de paradas configurado.");
  if (filters.pacotesMax && route.pacotes > filters.pacotesMax) reasons.push("Passou do limite de pacotes configurado.");
  return reasons;
}

function compareRankedRoutes(a: RomaneioRankedRoute, b: RomaneioRankedRoute, priority: RomaneioSettings["prioridade"]) {
  if (a.passedFilters !== b.passedFilters) return a.passedFilters ? -1 : 1;
  if (priority === "menor_distancia") return a.distanciaKm - b.distanciaKm;
  if (priority === "menos_paradas") return a.paradas - b.paradas;
  if (priority === "menos_pacotes") return a.pacotes - b.pacotes;
  if (priority === "maior_concentracao_bairro") return (b.bairroMatch?.percentualNaRota || 0) - (a.bairroMatch?.percentualNaRota || 0);
  return b.score - a.score;
}
