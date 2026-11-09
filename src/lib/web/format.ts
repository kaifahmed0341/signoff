export function money(cents: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
}

export function when(d: Date | number | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "number" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}

export function day(d: Date | number | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(`${d}T00:00:00Z`) : typeof d === "number" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

export function relative(target: number, now = Date.now()): string {
  const ms = target - now;
  const abs = Math.abs(ms);
  const days = Math.floor(abs / 86400000);
  const hours = Math.floor((abs % 86400000) / 3600000);
  const text = days > 0 ? `${days} day${days === 1 ? "" : "s"}${hours ? ` ${hours} h` : ""}` : `${hours} h`;
  return ms >= 0 ? `in ${text}` : `${text} ago`;
}

export function refsOf(data: Record<string, unknown> | null): string {
  if (!data) return "";
  const keys = ["transactionId", "disputeId", "status", "remote", "checkId", "deliveryId", "receiptNumber", "code", "expiresAt"];
  return keys
    .filter((k) => data[k] !== undefined && data[k] !== null && data[k] !== "")
    .map((k) => `${k}=${k === "expiresAt" && typeof data[k] === "number" ? new Date(data[k] as number).toISOString().slice(0, 10) : String(data[k])}`)
    .join(" ");
}
