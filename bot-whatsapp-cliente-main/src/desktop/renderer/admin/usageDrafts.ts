import { AdminImageUsageSnapshot } from "../../../shared/types";

export function mergeUsageAmounts(current: Record<string, string>, snapshot: AdminImageUsageSnapshot, dirty: ReadonlySet<string>) {
  const next: Record<string, string> = {};
  const assign = (key: string, cents: number) => {
    next[key] = dirty.has(key) && current[key] !== undefined
      ? current[key]
      : (cents / 100).toFixed(2).replace(".", ",");
  };
  snapshot.entries.forEach((entry) => assign(entry.id, entry.amountCents));
  snapshot.clients.forEach((client) => {
    assign(`client:${client.clientEmail}`, client.defaultAmountCents);
    assign(`total:${client.clientEmail}`, client.amountCents);
  });
  return next;
}

export function parseMoneyInput(value: string) {
  const trimmed = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(trimmed) && !/^\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    throw new Error("Informe um valor válido, por exemplo 12,50.");
  }
  const normalized = trimmed.includes(",") ? trimmed.replace(/\./g, "").replace(",", ".") : trimmed;
  const cents = Math.round(Number(normalized) * 100);
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error("Informe um valor válido.");
  return cents;
}
