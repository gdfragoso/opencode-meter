import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { fmtNum, fmtUSD } from "@/dashboard/lib/format";
import { deltaArrow, deltaTone, formatDelta, type Direction } from "@/dashboard/lib/delta";
import type {
  PeriodComparisonResponse,
  PeriodDelta,
  PeriodDeltaKey,
} from "@/data/domain/metrics";

interface MetricSpec {
  key: PeriodDeltaKey;
  label: string;
  format: (n: number) => string;
  direction: Direction;
}

export const METRICS: MetricSpec[] = [
  { key: "cost", label: "Cost", format: fmtUSD, direction: "neutral" },
  { key: "sessions", label: "Sessions", format: fmtNum, direction: "neutral" },
  { key: "files", label: "Files Changed", format: fmtNum, direction: "neutral" },
  { key: "lines", label: "Lines Changed", format: fmtNum, direction: "neutral" },
  { key: "tokens", label: "Tokens", format: fmtNum, direction: "neutral" },
  { key: "tools", label: "Tool Calls", format: fmtNum, direction: "neutral" },
  { key: "errors", label: "Errors", format: fmtNum, direction: "down-good" },
  { key: "activeDays", label: "Active Days", format: fmtNum, direction: "neutral" },
];

function DeltaCard({ spec, d }: { spec: MetricSpec; d: PeriodDelta }) {
  return (
    <div className="border border-cyber-cyan/10 bg-cyber-cyan/[0.03] p-4">
      <div className="text-cyber-cyan/50 text-xs tracking-[0.12em] uppercase mb-2">
        {spec.label}
      </div>
      <div className="text-cyber-cyan text-xl tabular-nums">{spec.format(d.current)}</div>
      <div className={`text-xs tracking-[0.08em] mt-1.5 ${deltaTone(d, spec.direction)}`}>
        <span className="mr-1">{deltaArrow(d)}</span>
        {formatDelta(d, spec.format)}
      </div>
      <div className="text-cyber-cyan/30 text-[10px] tracking-[0.08em] mt-1">
        was {spec.format(d.previous)}
      </div>
    </div>
  );
}

/** `Aug 12 – Aug 19`, the half-open range read as the days it covers. */
export function formatRange(from: number, to: number): string {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  // `to` is exclusive, so the last day actually covered is the millisecond
  // before it — otherwise a 7-day window reads as spanning 8 dates.
  return `${new Date(from).toLocaleDateString(undefined, opts)} – ${new Date(to - 1).toLocaleDateString(undefined, opts)}`;
}

export default function PeriodComparison({
  data,
  loading,
}: {
  data: PeriodComparisonResponse | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <Section title="This Period vs Last">
        <LoadingPlaceholder rows={2} />
      </Section>
    );
  }

  if (!data) {
    return (
      <Section title="This Period vs Last">
        <EmptyState />
      </Section>
    );
  }

  const { deltas, current, previous } = data;

  return (
    <Section
      title="This Period vs Last"
      meta={`${formatRange(current.from, current.to)} vs ${formatRange(previous.from, previous.to)}`}
    >
      {/* The header names both windows, so the dates are never ambiguous — but
          when they were chosen for the reader rather than by them, the charts
          below are on a different range and that has to be said out loud. */}
      {data.defaulted && (
        <p className="mb-3 text-[10px] tracking-[0.08em] uppercase text-cyber-cyan/30">
          Range is set to All — comparing the last {data.days} days with the {data.days} before
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {METRICS.map((spec) => (
          <DeltaCard key={spec.key} spec={spec} d={deltas[spec.key]} />
        ))}
      </div>
    </Section>
  );
}
