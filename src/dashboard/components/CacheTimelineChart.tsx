import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import { LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { fmtNum } from "@/dashboard/lib/format";
import { chartColors, cyan, magenta, yellow, donutExtras, bg, text } from "@/dashboard/lib/colors";
import type { CacheTimelineResponse } from "@/data/domain/metrics";

const SERIES_COLORS = [cyan, magenta, yellow, ...donutExtras];

/** `72.5%`, or a dash when the model read nothing. */
export function fmtRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/** `08/20` — matches how the other day-series charts label their axis. */
export function shortDate(date: string): string {
  const parts = date.split("-");
  return parts.length >= 3 ? `${parts[1]}/${parts[2]}` : date;
}

export default function CacheTimelineChart({
  data,
  loading,
}: {
  data: CacheTimelineResponse | null;
  loading: boolean;
}) {
  const chart = useMemo(() => {
    if (!data || data.series.length === 0) return null;

    return {
      labels: data.dates.map(shortDate),
      datasets: data.series.map((s, i) => ({
        label: s.model_id,
        data: s.rates.map((r) => (r === null ? null : r * 100)),
        borderColor: SERIES_COLORS[i % SERIES_COLORS.length]!,
        backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length]!,
        // A day the model was not used is a hole in the line, not a drop to
        // zero. Joining across it would draw a decline that never happened.
        spanGaps: false,
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 3,
        pointBorderColor: bg,
        pointBorderWidth: 1,
        pointHoverRadius: 5,
        fill: false,
      })),
    };
  }, [data]);

  if (loading) return <LoadingPlaceholder rows={4} />;
  if (!chart) return <EmptyState message="No cache activity yet" />;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: text,
          font: { family: "'Share Tech Mono', monospace", size: 10 },
          padding: 12,
          usePointStyle: true,
          pointStyleWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: bg,
        titleColor: cyan,
        bodyColor: text,
        borderColor: cyan,
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: (ctx: import("chart.js").TooltipItem<"line">) =>
            ` ${ctx.dataset.label}: ${(ctx.raw as number).toFixed(1)}%`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: text,
          font: { family: "'Share Tech Mono', monospace", size: 9 },
          maxTicksLimit: 14,
        },
      },
      y: {
        // Pinned to 0–100: an auto-scaled axis makes a wobble between 88% and
        // 91% look like a collapse.
        min: 0,
        max: 100,
        grid: { color: chartColors.scale.grid.color },
        ticks: {
          color: text,
          font: { family: "'Share Tech Mono', monospace", size: 10 },
          callback: (val: string | number) => `${val}%`,
        },
      },
    },
    interaction: { intersect: false, mode: "index" as const },
  };

  return (
    <>
      <div className="h-[300px]">
        <Line data={chart} options={options} />
      </div>

      <div className="overflow-x-auto mt-4">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
              <th className="text-left py-2 pr-4 font-normal">Model</th>
              <th className="text-left py-2 pr-4 font-normal">Provider</th>
              <th className="text-right py-2 pr-4 font-normal">Tokens</th>
              <th className="text-right py-2 font-normal">Hit Rate</th>
            </tr>
          </thead>
          <tbody>
            {data!.series.map((s) => (
              <tr key={s.model_id} className="border-b border-cyber-cyan/5">
                <td className="py-2 pr-4 text-cyber-cyan truncate max-w-[220px]">{s.model_id}</td>
                <td className="py-2 pr-4 text-cyber-cyan/50">{s.provider_id || "—"}</td>
                <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                  {fmtNum(s.tokens)}
                </td>
                <td className="py-2 text-right tabular-nums">{fmtRate(s.overallRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data!.omittedModels > 0 && (
        <p className="mt-3 text-[10px] tracking-[0.08em] uppercase text-cyber-cyan/30">
          {data!.omittedModels} quieter model{data!.omittedModels === 1 ? "" : "s"} not shown
        </p>
      )}
    </>
  );
}
