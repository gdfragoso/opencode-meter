import type { PeriodDelta } from "@/data/domain/metrics";

/**
 * Whether a rise in this metric is worth flagging.
 *
 * Almost nothing is. Spending more, running more sessions or touching more
 * files usually just means more work happened — painting that red turns a busy
 * week into an alarm. The question of whether the spend was worth it belongs to
 * the Cost tab, where it has a denominator. Errors are the exception.
 */
export type Direction = "down-good" | "neutral";

/** `+12.5%`, or the absolute change when the earlier window was empty. */
export function formatDelta(d: PeriodDelta, format: (n: number) => string): string {
  // Keyed on `absolute`, like deltaArrow and deltaTone. Reading `pct` first
  // made a steady metric read "no change" or "0.0%" depending only on whether
  // the earlier window happened to be empty — two labels for one state.
  if (d.absolute === 0) return "no change";
  if (d.pct === null) return `${d.absolute > 0 ? "+" : "−"}${format(Math.abs(d.absolute))}`;
  return `${d.pct > 0 ? "+" : "−"}${Math.abs(d.pct).toFixed(1)}%`;
}

export function deltaTone(d: PeriodDelta, direction: Direction): string {
  if (d.absolute === 0) return "text-cyber-cyan/30";
  if (direction === "down-good" && d.absolute > 0) return "text-cyber-danger";
  return "text-cyber-cyan/60";
}

export function deltaArrow(d: PeriodDelta): string {
  if (d.absolute === 0) return "→";
  return d.absolute > 0 ? "↑" : "↓";
}
