export function uiText(value: string) {
  return String(value || "").replace(/\bOCR\b/gi, "IA");
}
