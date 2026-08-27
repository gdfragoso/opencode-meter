import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { useDaily } from "@/dashboard/hooks/useDaily";
import { usePeriodComparison } from "@/dashboard/hooks/usePeriodComparison";
import PeriodComparison from "@/dashboard/components/PeriodComparison";
import { fmtNum, fmtUSD } from "@/dashboard/lib/format";
import { chartColors, cyan, magenta, danger } from "@/dashboard/lib/colors";
import type { DailyRow } from "@/data/domain/daily";

/* ── helpers ─────────────────────────────────────────────────────────── */

function errorRate(row: DailyRow): number {
  if (!row.sessions) return 0;
  return (row.errors_total / row.sessions) * 100;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/* ── base chart option factory ───────────────────────────────────────── */

function baseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: chartColors.color,
          font: { family: "'Share Tech Mono', monospace", size: 11 },
          boxWidth: 12,
          boxHeight: 2,
        },
      },
      tooltip: {
        backgroundColor: "#0a0a0f",
        titleColor: cyan,
        bodyColor: chartColors.color,
        borderColor: cyan,
        borderWidth: 1,
        bodyFont: { family: "'Share Tech Mono', monospace" },
      },
    },
    scales: {
      x: {
        grid: { color: chartColors.scale.grid.color },
        ticks: { color: chartColors.scale.ticks.color, font: { size: 10 } },
      },
      y: {
        grid: { color: chartColors.scale.grid.color },
        ticks: { color: chartColors.scale.ticks.color, font: { size: 10 } },
        beginAtZero: true,
      },
    },
  } as const;
}

/* ── chart color helpers ─────────────────────────────────────────────── */

function lineDataset(
  label: string,
  color: string,
  data: number[],
  fillAlpha = 0.08,
) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: `${color}${Math.round(fillAlpha * 255)
      .toString(16)
      .padStart(2, "0")
      .toUpperCase()}`,
    pointBackgroundColor: color,
    pointBorderColor: color,
    pointRadius: 2,
    pointHoverRadius: 4,
    tension: 0.3,
    fill: true,
    borderWidth: 1.5,
  };
}

/* ── chart sub-components ────────────────────────────────────────────── */

function SessionsChart({ data }: { data: DailyRow[] }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((r) => formatDate(r.date)),
      datasets: [lineDataset("Sessions", cyan, data.map((r) => r.sessions))],
    }),
    [data],
  );

  return (
    <Section title="Daily Sessions">
      <div className="h-[260px]">
        <Line data={chartData} options={baseOptions()} />
      </div>
    </Section>
  );
}

function TokensChart({ data }: { data: DailyRow[] }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((r) => formatDate(r.date)),
      datasets: [
        lineDataset("In", cyan, data.map((r) => r.tokens_in)),
        lineDataset("Out", magenta, data.map((r) => r.tokens_out)),
      ],
    }),
    [data],
  );

  const options = useMemo(() => {
    const opts = baseOptions();
    return {
      ...opts,
      scales: {
        ...opts.scales,
        y: {
          ...opts.scales.y,
          ticks: {
            ...opts.scales.y.ticks,
            callback: (val: string | number) => fmtNum(Number(val)),
          },
        },
      },
    };
  }, []);

  return (
    <Section title="Daily Tokens">
      <div className="h-[260px]">
        <Line data={chartData} options={options} />
      </div>
    </Section>
  );
}

function CostChart({ data }: { data: DailyRow[] }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((r) => formatDate(r.date)),
      datasets: [lineDataset("Cost", magenta, data.map((r) => r.total_cost))],
    }),
    [data],
  );

  const options = useMemo(() => {
    const opts = baseOptions();
    return {
      ...opts,
      scales: {
        ...opts.scales,
        y: {
          ...opts.scales.y,
          ticks: {
            ...opts.scales.y.ticks,
            callback: (val: string | number) => fmtUSD(Number(val)),
          },
        },
      },
    };
  }, []);

  return (
    <Section title="Daily Cost (USD)">
      <div className="h-[260px]">
        <Line data={chartData} options={options} />
      </div>
    </Section>
  );
}

function ErrorRateChart({ data }: { data: DailyRow[] }) {
  const chartData = useMemo(
    () => ({
      labels: data.map((r) => formatDate(r.date)),
      datasets: [
        lineDataset("Error Rate %", danger, data.map((r) => errorRate(r)), 0.1),
      ],
    }),
    [data],
  );

  const options = useMemo(() => {
    const opts = baseOptions();
    return {
      ...opts,
      scales: {
        ...opts.scales,
        y: {
          ...opts.scales.y,
          ticks: {
            ...opts.scales.y.ticks,
            callback: (val: string | number) => `${Number(val).toFixed(1)}%`,
          },
        },
      },
    };
  }, []);

  return (
    <Section title="Error Rate">
      <div className="h-[260px]">
        <Line data={chartData} options={options} />
      </div>
    </Section>
  );
}

/* ── Main AnalyticsTab ────────────────────────────────────────────────── */

export default function AnalyticsTab() {
  const { data, loading, error } = useDaily();
  const { data: comparison, loading: comparisonLoading } = usePeriodComparison();

  if (error) {
    return (
      <div className="border border-cyber-danger/20 bg-cyber-danger/5 p-6">
        <p className="text-cyber-danger text-sm">{error}</p>
      </div>
    );
  }

  const hasData = data && data.length > 0;

  return (
    <div className="space-y-6">
      {/* Where the period landed relative to the one before it, before any
          of the charts show how it got there. */}
      <PeriodComparison data={comparison} loading={comparisonLoading} />

      {loading ? (
        <div className="space-y-6">
          {[0, 1, 2, 3].map((i) => (
            <Section key={i} title="">
              <LoadingPlaceholder />
            </Section>
          ))}
        </div>
      ) : hasData ? (
        <>
          <SessionsChart data={data} />
          <TokensChart data={data} />
          <CostChart data={data} />
          <ErrorRateChart data={data} />
        </>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}
