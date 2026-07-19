import { OcrRouteOption, RomaneioPriority } from "../../shared/types";
import { normalizeRomaneioText } from "./normalizeRomaneio";

export const PREFERRED_IMAGE_CITY = "Campos dos Goytacazes";

export function isPreferredImageCity(value?: string) {
  const normalized = normalizeRomaneioText(value || "");
  if (!normalized.includes("campos")) return false;
  return /\bgo(?:y|i)tacaz(?:es)?\b/.test(normalized) || normalized === "campos";
}

export function rankImageRouteOptions(options: OcrRouteOption[], priority: RomaneioPriority) {
  const maxDistance = maxPositive(options.map((option) => option.distanciaKm));
  const maxStops = maxPositive(options.map((option) => option.paradas));
  const maxPackages = maxPositive(options.map((option) => option.pacotes));

  return options
    .map((option) => ({
      ...option,
      score: Number((
        inverseScore(option.distanciaKm, maxDistance) * 0.45 +
        inverseScore(option.paradas, maxStops) * 0.3 +
        inverseScore(option.pacotes, maxPackages) * 0.2 +
        ((option.bairroPercentual || 0) / 100) * 0.05
      ).toFixed(4))
    }))
    .sort((left, right) => {
      const preferredDifference = Number(isPreferredImageCity(right.cidade)) - Number(isPreferredImageCity(left.cidade));
      if (preferredDifference) return preferredDifference;
      if (left.passedFilters !== right.passedFilters) return left.passedFilters ? -1 : 1;
      if (left.romaneioMatch !== right.romaneioMatch) return left.romaneioMatch === false ? 1 : -1;
      if (priority === "menor_distancia") return comparePositiveValues(left.distanciaKm, right.distanciaKm);
      if (priority === "menos_paradas") return comparePositiveValues(left.paradas, right.paradas);
      if (priority === "menos_pacotes") return comparePositiveValues(left.pacotes, right.pacotes);
      if (priority === "maior_concentracao_bairro") return (right.bairroPercentual || 0) - (left.bairroPercentual || 0);
      return right.score - left.score || comparePositiveValues(left.distanciaKm, right.distanciaKm);
    })
    .map((option, index) => ({ ...option, rank: index + 1 }));
}

function maxPositive(values: number[]) {
  return Math.max(...values.filter((value) => value > 0), 1);
}

function inverseScore(value: number, maximum: number) {
  return value > 0 ? 1 - value / maximum : 0;
}

function comparePositiveValues(left: number, right: number) {
  if (left > 0 && right <= 0) return -1;
  if (right > 0 && left <= 0) return 1;
  return left - right;
}
