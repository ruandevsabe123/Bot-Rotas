export function selectRankedDesiredCages<T extends { gaiola: string }>(
  rankedOptions: T[],
  desiredCages: string[],
  messageLimit: number
) {
  const normalize = (value: string) => String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  const desired = new Set(desiredCages.map(normalize).filter(Boolean));
  const matches = rankedOptions.filter((option) => desired.has(normalize(option.gaiola)));
  const limit = Math.max(0, Math.floor(Number(messageLimit) || 0));
  return limit > 0 ? matches.slice(0, limit) : matches;
}
