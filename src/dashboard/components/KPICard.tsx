import { deltaArrow, deltaTone, formatDelta, type Direction } from "@/dashboard/lib/delta";
import type { PeriodDelta } from "@/data/domain/metrics";

interface KPICardProps {
  label: string;
  value: string | number;
  subtitle?: string;
  /**
   * Change against the period before this one. The whole delta rather than a
   * bare percentage, because a change from an empty window has no percentage
   * and the card still has to say something true.
   *
   * Was a `number` that nothing ever passed, rendered with any fall painted
   * red — which would have called a quieter week a problem.
   */
  delta?: PeriodDelta;
  /** How to render the absolute fallback; should match how `value` is formatted. */
  deltaFormat?: (n: number) => string;
  /** Defaults to neutral — see `Direction`. Only errors earn a red arrow. */
  deltaDirection?: Direction;
}

export default function KPICard({
  label,
  value,
  subtitle,
  delta,
  deltaFormat = (n) => String(n),
  deltaDirection = "neutral",
}: KPICardProps) {
  return (
    <div className="border border-cyber-cyan/20 bg-cyber-cyan/5 p-4 backdrop-blur-sm">
      <div className="text-cyber-cyan/50 text-xs tracking-[0.15em] uppercase mb-2">
        {label}
      </div>
      <div className="text-cyber-cyan text-2xl tracking-wider tabular-nums">
        {value}
      </div>
      {subtitle && (
        <div className="text-cyber-cyan/30 text-[10px] tracking-[0.1em] uppercase mt-1">
          {subtitle}
        </div>
      )}
      {delta && (
        <div className={`text-xs tracking-[0.1em] mt-1.5 ${deltaTone(delta, deltaDirection)}`}>
          <span className="mr-1">{deltaArrow(delta)}</span>
          {formatDelta(delta, deltaFormat)}
          <span className="text-cyber-cyan/30 ml-1.5">vs prev</span>
        </div>
      )}
    </div>
  );
}
