import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { fmtNum, fmtUSD } from "@/dashboard/lib/format";
import type {
  PeriodComparisonResponse,
  PeriodDelta,
  PeriodDeltaKey,
} from "@/data/domain/metrics";

/* ── which way is up ────────────────────────────────────────────────────
   Only `errors` has a direction worth colouring. Spending more, running more
   sessions or touching more files is not worse — it usually just means more
   work happened, and painting it red would turn a busy week into an alarm. The
   judgement about whether that spend was worth it belongs to the Cost tab,
   where it has a denominator. So everything else gets a neutral arrow: visible,
   but not an opinion.
   ─────────────────────────────────────────────────────────────────────── */

type Direction = "down-good" | "neutral";

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

/** `+12.5%`, or the absolute change when the earlier window was empty. */
export function formatDelta(d: PeriodDelta, format: (n: number) => string): string {
  if (d.pct === null) {
    if (d.absolute === 0) return "no change";
    return `${d.absolute > 0 ? "+" : "−"}${format(Math.abs(d.absolute))}`;
  }
  const sign = d.pct > 0 ? "+" : d.pct < 0 ? "−" : "";
  return `${sign}${Math.abs(d.pct).toFixed(1)}%`;
}

export function deltaTone(d: PeriodDelta, direction: Direction): string {
  if (d.absolute === 0) return "text-cyber-cyan/30";
  if (direction === "down-good" && d.absolute > 0) return "text-cyber-danger";
  return "text-cyber-cyan/60";
}

function arrow(d: PeriodDelta): string {
  if (d.absolute === 0) return "→";
  return d.absolute > 0 ? "↑" : "↓";
}

function DeltaCard({ spec, d }: { spec: MetricSpec; d: PeriodDelta }) {
  return (
    <div className="border border-cyber-cyan/10 bg-cyber-cyan/[0.03] p-4">
      <div className="text-cyber-cyan/50 text-xs tracking-[0.12em] uppercase mb-2">
        {spec.label}
      </div>
      <div className="text-cyber-cyan text-xl tabular-nums">{spec.format(d.current)}</div>
      <div className={`text-xs tracking-[0.08em] mt-1.5 ${deltaTone(d, spec.direction)}`}>
        <span className="mr-1">{arrow(d)}</span>
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

  if (!data.previous || !data.deltas) {
    return (
      <Section title="This Period vs Last">
        <EmptyState message="Pick a range to compare it against the period before" />
      </Section>
    );
  }

  const { deltas, current, previous } = data;

  return (
    <Section
      title="This Period vs Last"
      meta={`${formatRange(current.from, current.to)} vs ${formatRange(previous.from, previous.to)}`}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {METRICS.map((spec) => (
          <DeltaCard key={spec.key} spec={spec} d={deltas[spec.key]} />
        ))}
      </div>
    </Section>
  );
}
