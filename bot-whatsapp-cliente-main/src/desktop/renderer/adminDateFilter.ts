function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type AdminDatePreset = "current-month" | "previous-month" | "last-30-days" | "all";

export function getAdminDatePreset(preset: AdminDatePreset, now = new Date()) {
  if (preset === "all") return { startDate: "", endDate: "" };
  if (preset === "last-30-days") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    return { startDate: toDateInputValue(start), endDate: toDateInputValue(now) };
  }
  const monthOffset = preset === "previous-month" ? -1 : 0;
  const start = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
  const end = preset === "previous-month" ? new Date(now.getFullYear(), now.getMonth(), 0) : now;
  return { startDate: toDateInputValue(start), endDate: toDateInputValue(end) };
}

export function isDateInsideAdminRange(value: string, startDate: string, endDate: string) {
  if (!startDate && !endDate) return true;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return false;
  const startMs = startDate ? new Date(`${startDate}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
  const endMs = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
  return timestamp >= Math.min(startMs, endMs) && timestamp <= Math.max(startMs, endMs);
}
