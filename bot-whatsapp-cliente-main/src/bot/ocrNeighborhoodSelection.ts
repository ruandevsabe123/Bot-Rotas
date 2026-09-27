import type { MonitoredRoute } from "../shared/types";
import type { DetectedRouteCode, OcrLine, RouteOcrResult } from "./ocr";

export type NeighborhoodSelection = {
  status: "selected" | "no-match" | "unsafe" | "unconfigured";
  detection?: DetectedRouteCode;
  preferenceIndex?: number;
  reason: string;
  detections: DetectedRouteCode[];
};

type Row = { text: string; words: OcrLine["words"]; confidence: number; districtText?: string; localityText?: string };
type Match = { row: Row; code: string; confidence: number; variant: number };

export function normalizeNeighborhoodIdentity(value: string) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Selection deliberately does not use fuzzy matching or the romaneio. A row
 * must contain the complete configured city and neighborhood, and two OCR
 * treatments must agree on its literal cage code. Uncertainty in a preferred
 * neighborhood blocks selection instead of silently choosing a lower priority.
 */
export function selectPreferredNeighborhoodFromOcr(
  ocr: RouteOcrResult,
  preferences: MonitoredRoute[]
): NeighborhoodSelection {
  const configured = preferences.map((preference, index) => ({
    cidade: String(preference.cidade || "").trim(),
    bairro: String(preference.bairro || "").trim(),
    index
  })).filter((preference) => normalizeNeighborhoodIdentity(preference.bairro));
  if (!configured.length) return { status: "unconfigured", reason: "Nenhum bairro preferido configurado.", detections: [] };

  const variants = ocr.variants?.length ? ocr.variants : [ocr];
  const rows = variants.map(readRows);
  const detections: DetectedRouteCode[] = [];
  let firstDecision: Omit<NeighborhoodSelection, "detections"> | undefined;

  for (const preference of configured) {
    const matches: Match[] = [];
    for (const [variant, variantRows] of rows.entries()) {
      // One neighborhood can legitimately have multiple cages. The product
      // sends one message, so each OCR treatment contributes only its first
      // visual occurrence. Independent treatments must still agree on it.
      for (const row of variantRows) {
        const match = matchPreference(row, preference);
        if (match) {
          matches.push({ row, ...match, variant });
          break;
        }
      }
    }
    if (!matches.length) continue;

    const codes = [...new Set(matches.map((match) => match.code).filter(Boolean))];
    const incomplete = matches.some((match) => !match.code);
    const byCode = codes.map((code) => {
      const matching = matches.filter((match) => match.code === code);
      const strong = matching.filter((match) => match.confidence >= 65);
      const evidence = new Map<number, Match>();
      for (const match of strong) {
        const current = evidence.get(match.variant);
        if (!current || match.confidence > current.confidence) evidence.set(match.variant, match);
      }
      const confirmed = [...evidence.values()];
      const best = [...matching].sort((left, right) => right.confidence - left.confidence)[0];
      const detection: DetectedRouteCode = {
        route: preference.cidade ? `${preference.cidade} | ${preference.bairro}` : preference.bairro,
        cidade: preference.cidade,
        bairro: preference.bairro,
        code,
        line: best.row.text,
        confidence: confirmed.length ? Math.round(Math.min(...confirmed.map((match) => match.confidence))) : best.confidence,
        evidenceCount: evidence.size,
        variantCount: variants.length,
        safeForAutomatic: codes.length === 1 && !incomplete && evidence.size >= 2
      };
      return detection;
    });
    detections.push(...byCode);
    if (firstDecision) continue;
    const detection = byCode.find((candidate) => candidate.safeForAutomatic);
    if (detection) {
      firstDecision = { status: "selected", preferenceIndex: preference.index, detection,
        reason: "Bairro prioritário e gaiola confirmados em pelo menos duas leituras." };
    } else {
      firstDecision = { status: "unsafe", preferenceIndex: preference.index,
        reason: codes.length > 1 ? "O bairro prioritário aparece associado a gaiolas diferentes. Envio bloqueado."
          : incomplete ? "O bairro prioritário foi encontrado sem uma gaiola inequívoca na mesma linha. Envio bloqueado."
            : "O bairro prioritário não obteve duas leituras confiáveis da mesma gaiola. Envio bloqueado." };
    }
  }
  return firstDecision ? { ...firstDecision, detections }
    : { status: "no-match", reason: "Nenhuma linha corresponde exatamente à cidade e ao bairro configurados.", detections };
}

function matchPreference(row: Row, preference: MonitoredRoute) {
  // Underlined route links are commonly read as H_31, H 31 or H31. Accept
  // those shapes only for a real letter followed by 1-2 digits. Never turn
  // 1/l/|/II into I or truncate a three-digit value.
  const codeMatches = [...row.text.matchAll(/(?:^|[\s|;])([A-Z])[-_\u2013\u2014:.\s]*(\d{1,2})(?=$|[\s|;,])/g)];
  const suspiciousCodes = [...row.text.matchAll(/(?:^|[\s|;])([1|]|II|l|i)\s*[-_\u2013\u2014:.]\s*(\d{1,3})(?=$|[\s|;,])/g)];
  const code = codeMatches.length === 1 && suspiciousCodes.length === 0
    ? `${codeMatches[0][1].toUpperCase()}-${codeMatches[0][2]}` : "";
  const lastCode = codeMatches[codeMatches.length - 1];
  let tail = lastCode ? row.text.slice(lastCode.index! + lastCode[0].length) : row.text;
  // Strip an unreadable cage only to record unsafe evidence for this preference.
  // It must never become the code used for a message.
  if (!lastCode) tail = tail.replace(/^\s*[A-Za-z1|]{1,2}\s*[-_\u2013\u2014:.]?\s*\d{1,3}\b/, "");
  tail = stripMetadata(tail);
  const city = normalizeNeighborhoodIdentity(preference.cidade);
  const district = normalizeNeighborhoodIdentity(preference.bairro);
  const normalizedTail = normalizeNeighborhoodIdentity(tail);
  const leadingCity = city ? findLeadingCityAlias(normalizedTail, city) : undefined;
  if (row.districtText !== undefined) {
    tail = row.districtText;
    if (city && row.localityText && !isCompatibleCity(row.localityText, city)) return undefined;
  } else if (city && leadingCity) {
    // The city must be complete and immediately precede the neighborhood data.
    // Retain real separators between multiple explicitly listed neighborhoods.
    const tokens = leadingCity.split(" ").length;
    tail = removeLeadingPlaceTokens(tail, tokens);
  } else if (city && hasExplicitCityDistrictPair(tail, city, district)) {
    tail = preference.bairro;
  } else if (normalizeNeighborhoodIdentity(tail) !== district) {
    // Some screenshots omit the city/cluster column. In that case only an
    // exact neighborhood cell is safe; a suffix/substring is never enough.
    return undefined;
  }
  const districts = tail.split(/[|;,/\n]+/).map(normalizeNeighborhoodIdentity).filter(Boolean);
  if (!districts.includes(district)) return undefined;

  const relevant = new Set(`${city} ${district} ${code.replace("-", " ")}`.split(/\s+/).filter(Boolean));
  const wordConfidence = row.words.filter((word) => normalizeNeighborhoodIdentity(word.text).split(" ")
    .some((token) => relevant.has(token))).map((word) => word.confidence);
  const confidence = Math.round(Math.min(row.confidence, ...(wordConfidence.length ? wordConfidence : [row.confidence])));
  return { code, confidence };
}

function hasExplicitCityDistrictPair(value: string, configuredCity: string, configuredDistrict: string) {
  const cityAliases = getCityAliases(configuredCity);
  const district = normalizeNeighborhoodIdentity(configuredDistrict);
  const normalizedValue = normalizeNeighborhoodIdentity(value);
  // OCR frequently drops the visual hyphen from the final "Campos - Centro"
  // cell. Requiring the exact city+district pair at the end remains safe and
  // does not turn an earlier unrelated neighborhood into a match.
  if ([...cityAliases].some((city) => normalizedValue.endsWith(`${city} ${district}`))) return true;
  // Headerless screenshots commonly expose a final cell as
  // "Campos - Parque Santa Clara". Only explicit separators are accepted so
  // another free-text column cannot be mistaken for the configured city.
  const parts = String(value || "").split(/\s+(?:-|–|—)\s+|[|;,/\n]+/)
    .map(normalizeNeighborhoodIdentity).filter(Boolean);
  return parts.some((part, index) =>
    [...cityAliases].some((city) => part === city || part.endsWith(` ${city}`)) &&
    parts[index + 1] === district);
}

function getCityAliases(value: string) {
  const city = normalizeNeighborhoodIdentity(value);
  const aliases = new Set([city]);
  if (city === "campos dos goytacazes") aliases.add("campos");
  if (city === "campos") aliases.add("campos dos goytacazes");
  return aliases;
}

function findLeadingCityAlias(value: string, configuredCity: string) {
  return [...getCityAliases(configuredCity)]
    .sort((left, right) => right.length - left.length)
    .find((alias) => value.startsWith(`${alias} `));
}

function isCompatibleCity(value: string, configuredCity: string) {
  const locality = normalizeNeighborhoodIdentity(value);
  const city = normalizeNeighborhoodIdentity(configuredCity);
  if (!locality || !city) return true;
  if (locality === city || locality.startsWith(`${city} `) || locality.endsWith(` ${city}`)) return true;
  // The operational table abbreviates Campos dos Goytacazes as "Campos".
  if (getCityAliases(city).has("campos")) return locality === "campos" || locality.startsWith("campos ");
  return false;
}

function removeLeadingPlaceTokens(text: string, count: number) {
  const words = [...text.matchAll(/[\p{L}\p{N}]+/gu)];
  const last = words[count - 1];
  return last ? text.slice(last.index! + last[0].length).replace(/^[\s|;,:-]+/, "") : "";
}

function stripMetadata(text: string) {
  let remaining = text.replace(/^[\s|;,:]+/, "");
  while (/^(?:AT[A-Z0-9]{6,}|\d+(?:[.:/-]\d+)*|AM|PM)\b[\s|;,:]*/i.test(remaining)) {
    remaining = remaining.replace(/^(?:AT[A-Z0-9]{6,}|\d+(?:[.:/-]\d+)*|AM|PM)\b[\s|;,:]*/i, "");
  }
  return remaining.trim();
}

function readRows(reading: RouteOcrResult): Row[] {
  if (!reading.lines?.length) {
    // Text-only output has no confidence or trustworthy geometry. Keep each
    // physical text line separate, but never grant it automatic-send evidence.
    return String(reading.text || "").split(/\r?\n/).filter((line) => line.trim())
      .map((text) => ({ text, words: [], confidence: 0 }));
  }
  const positioned = reading.lines.filter((line) => line.text?.trim());
  const withWords = positioned.flatMap((line) => line.words || []);
  if (!withWords.length) return positioned.map((line) => ({ text: line.text, words: [], confidence: 0 }));

  // Rebuild visual rows from word boxes, including when Tesseract grouped a
  // whole column into one textual line. A word must overlap the row vertically;
  // proximity alone is not sufficient to borrow a cage from an adjacent row.
  const groups: OcrLine["words"][] = [];
  for (const word of [...withWords].sort((left, right) => left.top - right.top || left.left - right.left)) {
    if (!Number.isFinite(word.top) || !Number.isFinite(word.height) || word.height <= 0 || !word.text.trim()) continue;
    const compatible = groups.filter((group) => group.every((existing) => {
      const overlap = Math.min(existing.top + existing.height, word.top + word.height) - Math.max(existing.top, word.top);
      const distance = Math.abs(existing.top + existing.height / 2 - word.top - word.height / 2);
      return overlap >= Math.min(existing.height, word.height) * 0.6 &&
        distance <= Math.min(existing.height, word.height) * 0.4;
    }));
    if (compatible.length === 1) compatible[0].push(word);
    else groups.push([word]);
  }
  const neighborhoodHeaders = withWords.filter((word) => /^(bairro|bairros)$/.test(normalizeNeighborhoodIdentity(word.text)) && word.confidence >= 65);
  const districtHeader = neighborhoodHeaders.length === 1 ? neighborhoodHeaders[0] : undefined;
  const precedingHeader = districtHeader ? withWords.filter((word) =>
    word.left + word.width < districtHeader.left &&
    Math.abs(word.top - districtHeader.top) <= districtHeader.height * 0.4)
    .sort((left, right) => right.left - left.left)[0] : undefined;
  const districtStart = districtHeader && precedingHeader
    ? (precedingHeader.left + precedingHeader.width + districtHeader.left) / 2 : undefined;
  const localityHeaders = withWords.filter((word) => /^(cidade|cluster)$/.test(normalizeNeighborhoodIdentity(word.text)) && word.confidence >= 65);
  const localityHeader = localityHeaders.length === 1 ? localityHeaders[0] : undefined;
  const beforeLocalityHeader = localityHeader ? withWords.filter((word) =>
    word.left + word.width < localityHeader.left &&
    Math.abs(word.top - localityHeader.top) <= localityHeader.height * 0.4)
    .sort((left, right) => right.left - left.left)[0] : undefined;
  const localityStart = localityHeader && beforeLocalityHeader
    ? (beforeLocalityHeader.left + beforeLocalityHeader.width + localityHeader.left) / 2 : undefined;
  const localityEnd = localityHeader && districtHeader && localityHeader.left < districtHeader.left
    ? (localityHeader.left + localityHeader.width + districtHeader.left) / 2 : undefined;
  return groups.map((words) => {
    const sorted = [...words].sort((left, right) => left.left - right.left);
    return { text: sorted.map((word) => word.text).join(" "), words: sorted,
      districtText: districtStart !== undefined && sorted[0].top > districtHeader!.top + districtHeader!.height
        ? sorted.filter((word) => word.left + word.width / 2 >= districtStart).map((word) => word.text).join(" ") : undefined,
      localityText: localityStart !== undefined && sorted[0].top > localityHeader!.top + localityHeader!.height
        ? sorted.filter((word) => {
          const center = word.left + word.width / 2;
          return center >= localityStart && (localityEnd === undefined || center < localityEnd);
        }).map((word) => word.text).join(" ") : undefined,
      confidence: sorted.reduce((total, word) => total + word.confidence, 0) / sorted.length };
  });
}
