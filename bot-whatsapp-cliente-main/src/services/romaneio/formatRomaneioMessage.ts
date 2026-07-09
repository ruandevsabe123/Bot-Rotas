import { RomaneioDetectedInfo, RomaneioRankedRoute } from "../../shared/types";

export function formatRouteOptionsMessage(options: RomaneioRankedRoute[], detectedInfo: RomaneioDetectedInfo) {
  const passed = options.filter((route) => route.passedFilters);
  const selected = (passed.length ? passed : options).slice(0, 3);
  if (!selected.length) return "";

  const target = detectedInfo.bairro || detectedInfo.rota || detectedInfo.gaiola || "romaneio";
  const header = passed.length
    ? `Melhores rotas encontradas para ${target}:`
    : `Nenhuma rota ficou dentro de todos os filtros. Seguem as mais próximas para ${target}:`;

  return [
    header,
    "",
    ...selected.map((route, index) => formatRouteLine(route, index + 1))
  ].join("\n");
}

export function formatOutOfFilterMessage(route: RomaneioRankedRoute, suggestions: RomaneioRankedRoute[]) {
  return [
    "A rota encontrada na imagem está fora dos filtros configurados.",
    "",
    `${route.rota} / Gaiola ${route.gaiola}`,
    `Pacotes: ${route.pacotes}`,
    `Paradas: ${route.paradas}`,
    `Distância: ${route.distanciaKm.toFixed(3)} km`,
    "",
    "Motivo:",
    ...route.reasons.map((reason) => `- ${reason}`),
    "",
    "Sugestões melhores:",
    ...suggestions.slice(0, 3).map((item, index) => `${index + 1}. ${item.rota} / ${item.gaiola} - ${item.paradas} paradas - ${item.distanciaKm.toFixed(3)} km`)
  ].join("\n");
}

function formatRouteLine(route: RomaneioRankedRoute, index: number) {
  const bairro = route.bairroMatch?.nome || route.bairros[0]?.nome || "Bairro não informado";
  const percent = route.bairroMatch ? ` (${route.bairroMatch.percentualNaRota.toFixed(1)}%)` : "";
  return [
    `${index}. ${route.rota} / Gaiola ${route.gaiola}`,
    `Bairro: ${bairro}${percent}`,
    `Pacotes: ${route.pacotes}`,
    `Paradas: ${route.paradas}`,
    `Distância: ${route.distanciaKm.toFixed(3)} km`
  ].join("\n");
}
