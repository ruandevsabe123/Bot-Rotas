export function selectRankedDesiredCages<T extends { gaiola: string }>(
  rankedOptions: T[],
  desiredCages: string[],
  messageLimit: number
) {
  const normalize = (value: string) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const desired = new Set(desiredCages.map(normalize).filter(Boolean));
  const matches = rankedOptions.filter((option) => desired.has(normalize(option.gaiola)));
  const limit = Math.max(1, Math.min(3, Math.floor(Number(messageLimit) || 3)));
  return matches.slice(0, limit);
}
