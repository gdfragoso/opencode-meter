export function parseDays(raw: string | undefined): number | null {
  if (!raw) return null;
  const days = Number.parseInt(raw, 10);
  if (Number.isNaN(days) || days <= 0 || days > 365) return null;
  return days;
}

export function parseLimit(raw: string | undefined, fallback = 20, max = 200): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

export function parseOffset(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return fallback;
  return n;
}
