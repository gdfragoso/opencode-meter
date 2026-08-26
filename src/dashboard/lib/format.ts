export function fmtNum(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "\u2014";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(Math.round(n));
}

export function fmtUSD(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "\u2014";
  if (n === 0) return "$0.00";
  if (n < 0.01) return "$" + n.toFixed(5);
  return "$" + n.toFixed(2);
}

export function fmtDur(ms: number | null | undefined): string {
  if (ms == null || isNaN(ms)) return "\u2014";
  if (ms < 1000) return Math.round(ms) + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";

  const totalSec = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;

  if (minutes < 60) return minutes + "m " + seconds + "s";

  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return hours + "h " + remainingMin + "m";
}

export function fmtTime(ts: number | null | undefined): string {
  if (ts == null || isNaN(ts)) return "\u2014";
  return new Date(ts).toLocaleString();
}
