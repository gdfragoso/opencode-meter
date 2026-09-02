import { useMemo } from "react";
import { Line } from "react-chartjs-2";
import type { Chart, Plugin } from "chart.js";
import { LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { fmtNum } from "@/dashboard/lib/format";
import { chartColors, cyan, magenta, bg, text } from "@/dashboard/lib/colors";
import type { SessionContextResponse, SessionContextTurn } from "@/data/domain/session";

/**
 * The prompt the model saw on each turn: the outer line is the context, the
 * inner one the part served from cache, and the band between them is what was
 * billed fresh.
 *
 * Two independent series rather than a stack. Stacking drew the same picture,
 * but Chart.js coerces null to 0 when it sums a stack, so an unmeasured turn
 * came out as a vertical plunge to the axis no matter what `spanGaps` said.
 * Plotting the context directly also means the top line is the number, not a
 * sum the reader has to do.
 *
 * Charting `input` on its own was the original plan and it was wrong: `input`
 * and `cache.read` are disjoint, so `input` alone tracks the size of the delta,
 * not the size of the context. On a real session it understated the context by
 * roughly 7x and moved in the opposite direction from it.
 */

/** `72.5%`, or a dash for a turn that reported no prompt. */
export function fmtCacheRate(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Vertical rules where a compaction landed. A per-chart plugin rather than a
 * dependency: chartjs-plugin-annotation would be the whole library for two
 * dashed lines, and most sessions draw none of them.
 */
export function compactionMarks(indices: number[]): Plugin<"line"> {
  return {
    id: "compactionMarks",
    afterDatasetsDraw(chart: Chart<"line">) {
      if (indices.length === 0) return;
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      if (!x) return;
      ctx.save();
      ctx.strokeStyle = magenta;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const index of indices) {
        const px = x.getPixelForValue(index);
        if (px < chartArea.left || px > chartArea.right) continue;
        ctx.beginPath();
        ctx.moveTo(px, chartArea.top);
        ctx.lineTo(px, chartArea.bottom);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

/**
 * The two series the chart draws, as data rather than as canvas.
 *
 * Exported because the claim worth testing lives here — that the outer line is
 * the context itself and that an unmeasured turn stays null — and Chart.js
 * paints the chart onto a canvas the DOM cannot be asked about.
 */
export function contextDatasets(turns: SessionContextTurn[]) {
  return [
    {
      label: "Context",
      data: turns.map((t) => t.context),
      borderColor: magenta,
      backgroundColor: "rgba(255, 0, 255, 0.16)",
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      // An unmeasured turn is a hole. Joining across it would draw a collapse
      // the context never had.
      spanGaps: false,
      fill: "origin" as const,
      tension: 0.2,
    },
    {
      label: "Cached",
      data: turns.map((t) => t.cacheRead),
      borderColor: cyan,
      backgroundColor: "rgba(0, 255, 204, 0.18)",
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      spanGaps: false,
      fill: "origin" as const,
      tension: 0.2,
    },
  ];
}

export default function ContextChart({
  data,
  loading,
}: {
  data: SessionContextResponse | null;
  loading: boolean;
}) {
  const chart = useMemo(() => {
    if (!data || data.turns.length === 0) return null;
    return {
      labels: data.turns.map((_, i) => String(i + 1)),
      datasets: contextDatasets(data.turns),
    };
  }, [data]);

  const totals = useMemo(() => {
    if (!data || data.turns.length === 0) return null;
    const cacheRead = data.turns.reduce((sum, t) => sum + (t.cacheRead ?? 0), 0);
    const input = data.turns.reduce((sum, t) => sum + (t.input ?? 0), 0);
    const all = cacheRead + input;
    return { cacheRead, input, rate: all > 0 ? cacheRead / all : null };
  }, [data]);

  if (loading) return <LoadingPlaceholder rows={4} />;
  if (!chart || !data || !totals) return <EmptyState message="No context recorded" />;

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
          title: (items: Array<{ dataIndex: number }>) => `Turn ${(items[0]?.dataIndex ?? 0) + 1}`,
          label: (ctx: import("chart.js").TooltipItem<"line">) =>
            ctx.raw === null
              ? ` ${ctx.dataset.label}: —`
              : ` ${ctx.dataset.label}: ${fmtNum(ctx.raw as number)}`,
          footer: (items: Array<{ dataIndex: number }>) => {
            const turn = data.turns[items[0]?.dataIndex ?? 0];
            if (!turn) return "";
            if (turn.context === null) return "no tokens recorded for this turn";
            return `context ${fmtNum(turn.context)} · cached ${fmtCacheRate(turn.cacheRate)}`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: {
          color: text,
          font: { family: "'Share Tech Mono', monospace", size: 9 },
          maxTicksLimit: 20,
        },
      },
      y: {
        // Not stacked: the Context series already carries input + cacheRead,
        // and stacking is what turned an unmeasured turn into a drop to zero.
        beginAtZero: true,
        grid: { color: chartColors.scale.grid.color },
        ticks: {
          color: text,
          font: { family: "'Share Tech Mono', monospace", size: 10 },
          // Absolute tokens on purpose. A percentage of the model's window
          // would need a context limit that this data does not carry.
          callback: (val: string | number) => fmtNum(Number(val)),
        },
      },
    },
    interaction: { intersect: false, mode: "index" as const },
  };

  return (
    <>
      <div className="h-[300px]">
        <Line data={chart} options={options} plugins={[compactionMarks(data.compactedBefore)]} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-1 mt-4 text-xs">
        <div>
          <span className="text-cyber-cyan/40 uppercase tracking-[0.1em] text-[10px]">Turns</span>
          <div className="tabular-nums text-cyber-cyan">{data.turns.length}</div>
        </div>
        <div>
          <span className="text-cyber-cyan/40 uppercase tracking-[0.1em] text-[10px]">Peak context</span>
          <div className="tabular-nums text-cyber-cyan">{fmtNum(data.peakContext)}</div>
        </div>
        <div>
          <span className="text-cyber-cyan/40 uppercase tracking-[0.1em] text-[10px]">Cached share</span>
          <div className="tabular-nums text-cyber-cyan">{fmtCacheRate(totals.rate)}</div>
        </div>
        <div>
          <span className="text-cyber-cyan/40 uppercase tracking-[0.1em] text-[10px]">Compactions</span>
          <div className="tabular-nums text-cyber-cyan">{data.compactedBefore.length}</div>
        </div>
      </div>

      {data.compactedBefore.length > 0 && (
        <p className="mt-3 text-[10px] tracking-[0.08em] uppercase text-cyber-magenta/50">
          Dashed rules mark a compaction
        </p>
      )}
    </>
  );
}
