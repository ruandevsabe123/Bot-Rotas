import type { MonitoredRoute } from "../shared/types";
import type { DetectedRouteCode, OcrLine, RouteOcrResult } from "./ocr";

export type NeighborhoodSelection = {
  status: "selected" | "no-match" | "unsafe" | "unconfigured";
  detection?: DetectedRouteCode;
  preferenceIndex?: number;
  reason: string;
  detections: DetectedRouteCode[];
  selections: { detection: DetectedRouteCode; preferenceIndex: number }[];
};

type Row = { text: string; words: OcrLine["words"]; confidence: number; districtText?: string; localityText?: string; trailingCellText?: string };
type Match = { row: Row; code: string; confidence: number; variant: number; requiresThreeEvidence?: boolean };

export function findManualRouteCandidatesFromOcr(ocr: RouteOcrResult): DetectedRouteCode[] {
  const variants = ocr.variants?.length ? ocr.variants : [ocr];
  const found = new Map<string, Array<DetectedRouteCode & { variant: number }>>();
  for (const [variant, reading] of variants.entries()) {
    for (const row of readRows(reading)) {
      const exact = [...row.text.matchAll(/(?:^|[\s|;])([A-Z])[-_\u2013\u2014:.\s]*(\d{1,2})(?=$|[\s|;,])/g)];
      const misreadFour = [...row.text.matchAll(/(?:^|[\s|;])([A-Z])[-_\u2013\u2014:.\s]*(\d)\s*[uU](?=$|[\s|;,])/g)];
      const codes = new Set([
        ...exact.map((match) => `${match[1].toUpperCase()}-${match[2]}`),
        ...misreadFour.map((match) => `${match[1].toUpperCase()}-${match[2]}4`)
      ]);
      if (codes.size !== 1) continue;
      const code = [...codes][0];
      const bairro = String(row.districtText || row.trailingCellText || "").trim();
      const detection: DetectedRouteCode & { variant: number } = {
        route: bairro || row.text,
        cidade: String(row.localityText || "").trim() || undefined,
        bairro: bairro || undefined,
        code,
        line: row.text,
        confidence: Math.round(Math.max(0, Math.min(100, row.confidence))),
        evidenceCount: 1,
        variantCount: variants.length,
        safeForAutomatic: false,
        variant
      };
      found.set(code, [...(found.get(code) || []), detection]);
    }
  }
  return [...found.values()].map((matches) => {
    const best = [...matches].sort((left, right) => right.confidence - left.confidence)[0];
    const { variant: _variant, ...candidate } = best;
    return { ...candidate, evidenceCount: new Set(matches.map((match) => match.variant)).size };
  }).sort((left, right) => right.evidenceCount - left.evidenceCount || right.confidence - left.confidence);
}

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
    index,
    enabled: preference.enabled !== false
  })).filter((preference) => preference.enabled && normalizeNeighborhoodIdentity(preference.bairro));
  if (!configured.length) return { status: "unconfigured", reason: "Nenhum bairro preferido configurado.", detections: [], selections: [] };

  const variants = ocr.variants?.length ? ocr.variants : [ocr];
  const rows = variants.map(readRows);
  const detections: DetectedRouteCode[] = [];
  const selections: NeighborhoodSelection["selections"] = [];
  const selectedCodes = new Set<string>();
  let firstFailure: Omit<NeighborhoodSelection, "detections" | "selections"> | undefined;

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

    // Sparse OCR can visit a later occurrence of the same neighborhood first.
    // A weak isolated code must not veto the strong consensus for the first
    // visual row; conflicting cages still block when they reach this same
    // confidence floor.
    const codes = [...new Set(matches.filter((match) => match.confidence >= 65)
      .map((match) => match.code).filter(Boolean))];
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
      // A treatment can read a letter-shaped cage (for example G-2) as a
      // digit (6-2). An incomplete reading must not veto the normal consensus
      // of two independent treatments. A second valid, conflicting cage is
      // still represented in `codes` and blocks the automatic send.
      const requiredEvidence = matching.some((match) => match.requiresThreeEvidence) ? 3 : 2;
      const detection: DetectedRouteCode = {
        route: preference.cidade ? `${preference.cidade} | ${preference.bairro}` : preference.bairro,
        cidade: preference.cidade,
        bairro: preference.bairro,
        code,
        line: best.row.text,
        confidence: confirmed.length ? Math.round(Math.min(...confirmed.map((match) => match.confidence))) : best.confidence,
        evidenceCount: evidence.size,
        variantCount: variants.length,
        safeForAutomatic: codes.length === 1 && evidence.size >= requiredEvidence
      };
      return detection;
    });
    detections.push(...byCode);
    const detection = byCode.find((candidate) => candidate.safeForAutomatic);
    if (detection) {
      if (!selectedCodes.has(detection.code)) {
        selectedCodes.add(detection.code);
        selections.push({ preferenceIndex: preference.index, detection });
      }
    } else if (!firstFailure) {
      firstFailure = { status: "unsafe", preferenceIndex: preference.index,
        reason: codes.length > 1 ? "O bairro prioritário aparece associado a gaiolas diferentes. Envio bloqueado."
          : incomplete ? "O bairro prioritário foi encontrado sem uma gaiola inequívoca na mesma linha. Envio bloqueado."
            : "O bairro prioritário não obteve duas leituras confiáveis da mesma gaiola. Envio bloqueado." };
    }
  }
  if (selections.length) return {
    status: "selected", detection: selections[0].detection, preferenceIndex: selections[0].preferenceIndex,
    reason: `${selections.length} bairro(s) confirmado(s) para envio na ordem de preferência.`, detections, selections
  };
  return firstFailure ? { ...firstFailure, detections, selections }
    : { status: "no-match", reason: "Nenhuma linha corresponde exatamente à cidade e ao bairro configurados.", detections, selections };
}

function matchPreference(row: Row, preference: MonitoredRoute) {
  // Underlined route links are commonly read as H_31, H 31 or H31. Accept
  // those shapes only for a real letter followed by 1-2 digits. Never turn
  // 1/l/|/II into I or truncate a three-digit value.
  const codeMatches = [...row.text.matchAll(/(?:^|[\s|;])([A-Z])[-_\u2013\u2014:.\s]*(\d{1,2})(?=$|[\s|;,])/g)];
  const suspiciousCodes = [...row.text.matchAll(/(?:^|[\s|;])([1|]|II|l|i)\s*[-_\u2013\u2014:.]\s*(\d{1,3})(?=$|[\s|;,])/g)];
  const misreadFourCodes = [...row.text.matchAll(/(?:^|[\s|;])([A-Z])[-_\u2013\u2014:.\s]*(\d)\s*[uU](?=$|[\s|;,])/g)];
  let code = codeMatches.length === 1 && suspiciousCodes.length === 0
    ? `${codeMatches[0][1].toUpperCase()}-${codeMatches[0][2]}` : "";
  // In the narrow route column Tesseract frequently reads I-24 as 1-24,
  // l-24 or |-24. Recover only a two-digit I route when the same physical row
  // also contains a complete AT identifier; consensus across OCR treatments is
  // still required before automatic dispatch.
  const suspiciousPrefix = suspiciousCodes.length === 1 ? suspiciousCodes[0][1] : "";
  const hasExactAt = /\bAT[A-Z0-9]{8,}\b/i.test(row.text);
  const malformedSingleI = row.text.match(/(?:^|[\s|;])(-{1,2}\s*(\d))(?=$|[\s|;,])/);
  let requiresThreeEvidence = false;
  // In compressed screenshots the open top of the final digit 4 is often
  // recognized as "u" (F-24 -> F-2u). Recover it only beside a complete AT;
  // city/neighborhood matching and two independent OCR readings are still
  // required before this code can be sent automatically.
  if (!code && hasExactAt && misreadFourCodes.length === 1 && suspiciousCodes.length === 0) {
    code = `${misreadFourCodes[0][1].toUpperCase()}-${misreadFourCodes[0][2]}4`;
  }
  if (!code && hasExactAt && /^[1|li]$/i.test(suspiciousPrefix) && suspiciousCodes[0][2].length === 2) {
    code = `I-${suspiciousCodes[0][2]}`;
  }
  if (!code && hasExactAt && malformedSingleI) {
    code = `I-${malformedSingleI[2]}`;
    requiresThreeEvidence = true;
  }
  const lastCode = codeMatches[codeMatches.length - 1];
  const recoveredCodeEnd = malformedSingleI?.index !== undefined
    ? malformedSingleI.index + malformedSingleI[0].length : undefined;
  const misreadFourCode = misreadFourCodes.length === 1 ? misreadFourCodes[0] : undefined;
  const misreadFourCodeEnd = misreadFourCode?.index !== undefined
    ? misreadFourCode.index + misreadFourCode[0].length : undefined;
  let tail = lastCode ? row.text.slice(lastCode.index! + lastCode[0].length)
    : misreadFourCodeEnd !== undefined ? row.text.slice(misreadFourCodeEnd)
      : recoveredCodeEnd !== undefined ? row.text.slice(recoveredCodeEnd) : row.text;
  // Strip an unreadable cage only to record unsafe evidence for this preference.
  // It must never become the code used for a message.
  if (!lastCode && misreadFourCodeEnd === undefined) tail = tail.replace(/^\s*[A-Za-z1|]{1,2}\s*[-_\u2013\u2014:.]?\s*\d{1,3}\b/, "");
  tail = stripMetadata(tail);
  const city = normalizeNeighborhoodIdentity(preference.cidade);
  const district = normalizeNeighborhoodIdentity(preference.bairro);
  const normalizedTail = normalizeNeighborhoodIdentity(tail);
  const leadingCity = city ? findLeadingCityAlias(normalizedTail, city) : undefined;
  const cityQualifiedDistricts = city ? findCityQualifiedDistricts(tail, city) : [];
  if (row.districtText !== undefined) {
    tail = row.districtText;
    if (city && row.localityText && !isCompatibleCity(row.localityText, city)) return undefined;
  } else if (!city && row.trailingCellText !== undefined) {
    // Headerless exports still preserve column geometry. When the client did
    // not configure a city, compare only the physically isolated last cell;
    // this accepts "Centro" but never the suffix of "Novo Centro".
    tail = row.trailingCellText;
  } else if (
    city && row.trailingCellText !== undefined &&
    normalizeNeighborhoodIdentity(row.trailingCellText) === district &&
    cityQualifiedDistricts.length > 0
  ) {
    // Headerless exports can add/remove numeric columns while keeping a clear
    // final BAIRRO cell. Accept it only when the configured city is also
    // present as a complete identity elsewhere in the same physical row.
    tail = row.trailingCellText;
  } else if (cityQualifiedDistricts.includes(district)) {
    // Some exports have no BAIRRO column and put one or more explicit
    // "city - neighborhood" pairs in CLUSTER. Select only a complete pair;
    // never use a substring from another city or a similar neighborhood.
    tail = preference.bairro;
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
  // Keep the complete cell as a candidate because slash can be part of an
  // official neighborhood name (for example ST/Gargaú), while still
  // supporting old cells that use slash as a list separator.
  const districts = [normalizeNeighborhoodIdentity(tail), ...tail.split(/[|;,/\n]+/).map(normalizeNeighborhoodIdentity)]
    .filter(Boolean);
  if (!districts.includes(district)) return undefined;

  const relevant = new Set(`${city} ${district} ${code.replace("-", " ")}`.split(/\s+/).filter(Boolean));
  const codeBackedByAt = hasExactAt && /^I-\d{1,2}$/.test(code);
  const wordConfidence = row.words.filter((word) => {
    // The thin I is commonly the lowest-confidence glyph in an otherwise
    // clear row. A complete AT on that same row supplies the structural
    // confirmation, so score the city and district instead of vetoing the
    // consensus because of the I/1 glyph alone.
    if (codeBackedByAt && /^(?:(?:I|1|l|\|)\s*[-_:.]?|-{1,2})\s*\d{1,2}$/i.test(word.text)) return false;
    return normalizeNeighborhoodIdentity(word.text).split(" ").some((token) => relevant.has(token));
  }).map((word) => word.confidence);
  const confidence = Math.round(Math.min(row.confidence, ...(wordConfidence.length ? wordConfidence : [row.confidence])));
  return { code, confidence, requiresThreeEvidence };
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
  if (city === "sao francisco de itabapoana") aliases.add("sfi");
  if (city === "sfi") aliases.add("sao francisco de itabapoana");
  if (city === "sao joao da barra") aliases.add("sjb");
  if (city === "sjb") aliases.add("sao joao da barra");
  return aliases;
}

function findCityQualifiedDistricts(value: string, configuredCity: string) {
  const aliases = [...getCityAliases(configuredCity)].sort((left, right) => right.length - left.length);
  // Semicolon/pipe/newline separate destinations. Slash is deliberately kept:
  // operational names such as "ST/Gargaú" use it inside the neighborhood.
  return String(value || "").split(/[;|\n]+/).map((part) => normalizeNeighborhoodIdentity(part))
    .flatMap((part) => {
      const alias = aliases.find((candidate) => part.startsWith(`${candidate} `));
      return alias ? [part.slice(alias.length).trim()] : [];
    }).filter(Boolean);
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
      trailingCellText: districtStart === undefined ? inferTrailingCellText(sorted) : undefined,
      confidence: sorted.reduce((total, word) => total + word.confidence, 0) / sorted.length };
  });
}

function inferTrailingCellText(words: OcrLine["words"]) {
  if (words.length < 4) return undefined;
  const heights = words.map((word) => word.height).filter((height) => height > 0).sort((a, b) => a - b);
  const typicalHeight = heights[Math.floor(heights.length / 2)] || 0;
  // Choose the rightmost real column gap. Normal spaces inside a city or
  // multi-word neighborhood are substantially narrower than one text height.
  let cellStart = -1;
  for (let index = 1; index < words.length; index += 1) {
    const previous = words[index - 1];
    const gap = words[index].left - (previous.left + previous.width);
    if (gap >= typicalHeight * 1.35) cellStart = index;
  }
  if (cellStart < 0) return undefined;
  return words.slice(cellStart).map((word) => word.text).join(" ");
}
