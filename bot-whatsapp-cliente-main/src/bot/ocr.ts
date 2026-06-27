import { execFile } from "child_process";
import { recognize } from "tesseract.js";

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
  return readImageTextWithBinary(imagePath).catch((error) => {
    if (!isMissingTesseractBinary(error)) throw error;
    return readImageTextWithTesseractJs(imagePath);
  });
}

function readImageTextWithBinary(imagePath: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "tesseract",
      [imagePath, "stdout", "-l", "por", "--oem", "1", "--psm", "6"],
      { timeout: 15000, maxBuffer: 1024 * 1024 * 4 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
          return;
        }

        resolve(stdout || "");
      }
    );
  });
}

async function readImageTextWithTesseractJs(imagePath: string) {
  const result = await recognize(imagePath, "por", {
    logger: () => undefined
  });
  return result.data.text || "";
}

function isMissingTesseractBinary(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("ENOENT") || message.toLowerCase().includes("spawn tesseract");
}

export function findConfiguredRouteCode(ocrText: string, routes: string[]) {
  const lines = ocrText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const normalizedRoutes = routes
    .map((route) => ({ raw: route.trim(), normalized: normalizeOcrText(route) }))
    .filter((route) => route.normalized);

  for (const line of lines) {
    const normalizedLine = normalizeOcrText(line);
    if (!normalizedLine) continue;

    for (const route of normalizedRoutes) {
      const routeIndex = normalizedLine.indexOf(route.normalized);
      if (routeIndex < 0 && !looselyMatchesRoute(normalizedLine, route.normalized)) continue;

      const afterRoute = routeIndex >= 0 ? normalizedLine.slice(routeIndex + route.normalized.length) : normalizedLine;
      const beforeRoute = routeIndex >= 0 ? normalizedLine.slice(0, routeIndex) : "";
      const code = extractGaiolaCode(beforeRoute) || extractGaiolaCode(normalizedLine) || extractGaiolaCode(afterRoute);
      if (!code) continue;

      return {
        route: route.raw,
        code,
        line
      };
    }
  }

  const normalizedFullText = normalizeOcrText(ocrText);
  for (const route of normalizedRoutes) {
    const routeIndex = normalizedFullText.indexOf(route.normalized);
    if (routeIndex < 0) continue;

    const afterRoute = normalizedFullText.slice(routeIndex + route.normalized.length, routeIndex + route.normalized.length + 40);
    const code = extractGaiolaCode(afterRoute) || extractGaiolaCode(normalizedFullText.slice(Math.max(0, routeIndex - 80), routeIndex));
    if (code) {
      return {
        route: route.raw,
        code,
        line: route.raw
      };
    }
  }

  return undefined;
}

function extractGaiolaCode(text: string) {
  const match = text.match(/\b([a-z])\s*[-.:]?\s*(\d{1,4})\b/i);
  if (!match) return "";
  return `${match[1].toUpperCase()}-${match[2]}`;
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
