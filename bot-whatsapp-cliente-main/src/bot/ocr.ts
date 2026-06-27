import { execFile } from "child_process";
import { createWorker } from "tesseract.js";
import { MonitoredRoute } from "../shared/types";

type OcrWord = {
  text: string;
  left: number;
  top: number;
  width: number;
  height: number;
  confidence: number;
};

export type OcrLine = {
  text: string;
  words: OcrWord[];
  top: number;
  left: number;
  width: number;
  height: number;
  confidence: number;
};

export type RouteOcrResult = {
  text: string;
  lines: OcrLine[];
  source: "tesseract-binary" | "tesseract-js";
};

let tesseractJsWorkerPromise: ReturnType<typeof createWorker> | undefined;

export function normalizeOcrText(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[|()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function readImageText(imagePath: string) {
  return readRouteImageOcr(imagePath).then((result) => result.text);
}

export function readRouteImageOcr(imagePath: string) {
  return readRouteImageOcrWithBinary(imagePath).catch((error) => {
    if (!isMissingTesseractBinary(error)) throw error;
    return readRouteImageOcrWithTesseractJs(imagePath);
  });
}

function readRouteImageOcrWithBinary(imagePath: string) {
  return new Promise<RouteOcrResult>((resolve, reject) => {
    execFile(
      "tesseract",
      [imagePath, "stdout", "-l", "por", "--oem", "1", "--psm", "6", "tsv"],
      { timeout: 15000, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }

        const lines = parseTsvLines(stdout || "");
        resolve({
          text: lines.map((line) => line.text).join("\n"),
          lines,
          source: "tesseract-binary"
        });
      }
    );
  });
}

async function readRouteImageOcrWithTesseractJs(imagePath: string): Promise<RouteOcrResult> {
  const worker = await getTesseractJsWorker();

  const result = await worker.recognize(
    imagePath,
    {},
    {
      text: true,
      blocks: true,
      tsv: true
    }
  );
  const tsvLines = parseTsvLines(result.data.tsv || "");
  const blockLines = tsvLines.length ? tsvLines : extractBlockLines(result.data.blocks || []);
  return {
    text: blockLines.map((line) => line.text).join("\n") || result.data.text || "",
    lines: blockLines,
    source: "tesseract-js"
  };
}

function getTesseractJsWorker() {
  if (!tesseractJsWorkerPromise) {
    tesseractJsWorkerPromise = createWorker("por", 1, {
      logger: () => undefined
    }).catch((error) => {
      tesseractJsWorkerPromise = undefined;
      throw error;
    });
  }

  return tesseractJsWorkerPromise;
}

function isMissingTesseractBinary(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("ENOENT") || message.toLowerCase().includes("spawn tesseract");
}

export function findConfiguredRouteCode(ocrText: string, routes: string[]) {
  return findConfiguredRouteCodeDetailed(ocrText, [], routes);
}

export function findConfiguredRouteCodeDetailed(ocrText: string, monitoredRoutes: MonitoredRoute[] = [], legacyRoutes: string[] = []) {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return findConfiguredRouteCodeInLines(lines.map(createPlainOcrLine), monitoredRoutes, legacyRoutes);
}

export function findConfiguredRouteCodeFromOcr(ocr: RouteOcrResult, monitoredRoutes: MonitoredRoute[] = [], legacyRoutes: string[] = []) {
  const lines = ocr.lines.length
    ? ocr.lines
    : ocr.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map(createPlainOcrLine);

  return findConfiguredRouteCodeInLines(lines, monitoredRoutes, legacyRoutes);
}

function findConfiguredRouteCodeInLines(lines: OcrLine[], monitoredRoutes: MonitoredRoute[] = [], legacyRoutes: string[] = []) {
  const usefulLines = mergeLikelySplitRows(lines);

  const normalizedDetailedRoutes = monitoredRoutes
    .map((route) => ({
      raw: `${route.cidade.trim()} | ${route.bairro.trim()}`,
      cidade: route.cidade.trim(),
      bairro: route.bairro.trim(),
      normalizedCity: normalizeOcrText(route.cidade),
      normalizedDistrict: normalizeOcrText(route.bairro)
    }))
    .filter((route) => route.normalizedCity && route.normalizedDistrict);

  const normalizedRoutes = legacyRoutes
    .map((route) => ({ raw: route.trim(), normalized: normalizeOcrText(route) }))
    .filter((route) => route.normalized);

  for (const line of usefulLines) {
    const normalizedLine = normalizeOcrText(line.text);
    if (!normalizedLine) continue;

    for (const route of normalizedDetailedRoutes) {
      if (!matchesRoutePart(normalizedLine, route.normalizedCity)) continue;
      if (!matchesRoutePart(normalizedLine, route.normalizedDistrict)) continue;

      const code = extractSafeGaiolaCode(line);
      if (!code) continue;

      return {
        route: route.raw,
        cidade: route.cidade,
        bairro: route.bairro,
        code,
        line: line.text
      };
    }

    for (const route of normalizedRoutes) {
      const routeIndex = normalizedLine.indexOf(route.normalized);
      if (routeIndex < 0 && !looselyMatchesRoute(normalizedLine, route.normalized)) continue;

      const beforeRoute = routeIndex >= 0 ? normalizedLine.slice(0, routeIndex) : "";
      const code = routeIndex >= 0
        ? extractLastGaiolaCode(beforeRoute)
        : extractSafeGaiolaCode(line);
      if (!code) continue;

      return {
        route: route.raw,
        bairro: route.raw,
        code,
        line: line.text
      };
    }
  }

  return undefined;
}

function parseTsvLines(tsv: string): OcrLine[] {
  const [headerLine, ...rows] = tsv.split(/\r?\n/).filter(Boolean);
  if (!headerLine) return [];

  const headers = headerLine.split("\t");
  const indexOf = (name: string) => headers.indexOf(name);
  const levelIndex = indexOf("level");
  const blockIndex = indexOf("block_num");
  const paragraphIndex = indexOf("par_num");
  const lineIndex = indexOf("line_num");
  const leftIndex = indexOf("left");
  const topIndex = indexOf("top");
  const widthIndex = indexOf("width");
  const heightIndex = indexOf("height");
  const confidenceIndex = indexOf("conf");
  const textIndex = indexOf("text");
  if ([levelIndex, blockIndex, paragraphIndex, lineIndex, leftIndex, topIndex, widthIndex, heightIndex, confidenceIndex, textIndex].some((index) => index < 0)) {
    return [];
  }

  const grouped = new Map<string, OcrWord[]>();
  for (const row of rows) {
    const columns = row.split("\t");
    if (columns[levelIndex] !== "5") continue;

    const text = (columns[textIndex] || "").trim();
    const confidence = Number(columns[confidenceIndex] || -1);
    if (!text || confidence < 30) continue;

    const word: OcrWord = {
      text,
      left: Number(columns[leftIndex] || 0),
      top: Number(columns[topIndex] || 0),
      width: Number(columns[widthIndex] || 0),
      height: Number(columns[heightIndex] || 0),
      confidence
    };
    const key = `${columns[blockIndex]}:${columns[paragraphIndex]}:${columns[lineIndex]}`;
    grouped.set(key, [...(grouped.get(key) || []), word]);
  }

  return [...grouped.values()]
    .map(createOcrLineFromWords)
    .filter((line) => line.words.length && line.text)
    .sort((left, right) => left.top - right.top || left.left - right.left);
}

function extractBlockLines(blocks: any[]): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const block of blocks || []) {
    for (const paragraph of block?.paragraphs || []) {
      for (const line of paragraph?.lines || []) {
        const words = (line?.words || [])
          .map((word: any) => ({
            text: String(word?.text || "").trim(),
            left: Number(word?.bbox?.x0 || 0),
            top: Number(word?.bbox?.y0 || 0),
            width: Number(word?.bbox?.x1 || 0) - Number(word?.bbox?.x0 || 0),
            height: Number(word?.bbox?.y1 || 0) - Number(word?.bbox?.y0 || 0),
            confidence: Number(word?.confidence || 0)
          }))
          .filter((word: OcrWord) => word.text && word.confidence >= 30);
        if (!words.length) continue;
        lines.push(createOcrLineFromWords(words));
      }
    }
  }
  return lines.sort((left, right) => left.top - right.top || left.left - right.left);
}

function createOcrLineFromWords(words: OcrWord[]): OcrLine {
  const sortedWords = [...words].sort((left, right) => left.left - right.left);
  const left = Math.min(...sortedWords.map((word) => word.left));
  const top = Math.min(...sortedWords.map((word) => word.top));
  const right = Math.max(...sortedWords.map((word) => word.left + word.width));
  const bottom = Math.max(...sortedWords.map((word) => word.top + word.height));
  return {
    text: sortedWords.map((word) => word.text).join(" "),
    words: sortedWords,
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
    confidence: sortedWords.reduce((sum, word) => sum + word.confidence, 0) / sortedWords.length
  };
}

function createPlainOcrLine(text: string): OcrLine {
  return {
    text,
    words: text.split(/\s+/).filter(Boolean).map((word, index) => ({
      text: word,
      left: index * 20,
      top: 0,
      width: Math.max(12, word.length * 8),
      height: 12,
      confidence: 100
    })),
    top: 0,
    left: 0,
    width: text.length * 8,
    height: 12,
    confidence: 100
  };
}

function mergeLikelySplitRows(lines: OcrLine[]) {
  if (lines.length < 2) return lines;

  const sorted = [...lines].sort((left, right) => left.top - right.top || left.left - right.left);
  const medianHeight = median(sorted.map((line) => line.height).filter((height) => height > 0)) || 18;
  const merged: OcrLine[] = [];

  for (const line of sorted) {
    const previous = merged[merged.length - 1];
    const sameRow = previous && Math.abs(centerY(previous) - centerY(line)) <= Math.max(8, medianHeight * 0.45);
    if (!sameRow) {
      merged.push(line);
      continue;
    }

    const words = [...previous.words, ...line.words].sort((left, right) => left.left - right.left);
    merged[merged.length - 1] = createOcrLineFromWords(words);
  }

  return merged;
}

function extractSafeGaiolaCode(line: OcrLine) {
  if (!line.words.length) return extractFirstGaiolaCodeBeforeRouteData(line.text);

  const sortedWords = [...line.words].sort((left, right) => left.left - right.left);
  const rowLeft = Math.min(...sortedWords.map((word) => word.left));
  const rowRight = Math.max(...sortedWords.map((word) => word.left + word.width));
  const maxCodeLeft = rowLeft + Math.max(80, (rowRight - rowLeft) * 0.22);
  const atIndex = sortedWords.findIndex((word) => /^at/i.test(normalizeOcrToken(word.text)));
  const codeWords = sortedWords.filter((word, index) => word.left <= maxCodeLeft && (atIndex < 0 || index < atIndex));
  const code = extractFirstGaiolaCodeBeforeRouteData(codeWords.map((word) => word.text).join(" "));
  return code || "";
}

function extractFirstGaiolaCodeBeforeRouteData(text: string) {
  const cleanText = normalizeOcrToken(text);
  const beforeAt = cleanText.split(/\bat\s*\d/i)[0] || cleanText;
  const matches = collectGaiolaCodes(beforeAt);
  return matches[0] || "";
}

function normalizeOcrToken(text: string) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[|()[\]{}]/g, " ")
    .trim();
}

function centerY(line: OcrLine) {
  return line.top + line.height / 2;
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function matchesRoutePart(line: string, routePart: string) {
  return line.includes(routePart) || looselyMatchesRoute(line, routePart);
}

function extractLastGaiolaCode(text: string) {
  const matches = collectGaiolaCodes(text);
  return matches[matches.length - 1] || "";
}

function extractOnlyGaiolaCode(text: string) {
  const matches = collectGaiolaCodes(text);
  return matches.length === 1 ? matches[0] : "";
}

function collectGaiolaCodes(text: string) {
  const matches = [...text.matchAll(/\b([a-z])\s*[-.:]?\s*(\d{1,2})\b/gi)];
  return matches
    .map((match) => `${match[1].toUpperCase()}-${match[2]}`)
    .filter((code) => !/^AT-\d/i.test(code));
}

function looselyMatchesRoute(line: string, route: string) {
  const lineWords = line.split(/\s+/).filter((word) => word.length > 2);
  const routeWords = route.split(/\s+/).filter((word) => word.length > 2);
  if (!routeWords.length || !lineWords.length) return false;

  return routeWords.every((routeWord) =>
    lineWords.some((lineWord) => {
      if (lineWord.includes(routeWord) || routeWord.includes(lineWord)) return true;
      if (hasSameLetters(lineWord, routeWord)) return true;
      const maxDistance = Math.max(1, Math.ceil(routeWord.length * 0.34));
      return levenshteinDistance(lineWord, routeWord) <= maxDistance;
    })
  );
}

function hasSameLetters(left: string, right: string) {
  if (left.length !== right.length || left.length < 5) return false;
  return left.split("").sort().join("") === right.split("").sort().join("");
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    const current = [leftIndex + 1];
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const insert = current[rightIndex] + 1;
      const remove = previous[rightIndex + 1] + 1;
      const replace = previous[rightIndex] + (left[leftIndex] === right[rightIndex] ? 0 : 1);
      current.push(Math.min(insert, remove, replace));
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}
