import { useMemo } from "react";
import { Doughnut, Line } from "react-chartjs-2";
import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { useSummary } from "@/dashboard/hooks/useSummary";
import { useDaily } from "@/dashboard/hooks/useDaily";
import { fmtNum, fmtUSD } from "@/dashboard/lib/format";
import { chartColors, cyan, magenta, yellow, bg, text } from "@/dashboard/lib/colors";
import type { SummaryResponse } from "@/data/domain/metrics";
import type { DailyRow } from "@/data/domain/daily";

/* ── Cost by Model Donut ────────────────────────────────────────────── */

const DONUT_COLORS = [cyan, magenta, yellow, "#00ff88", "#ff8800", "#8800ff", "#00aaff", "#ff4488", "#88ff00", "#ff00cc"];

function CostByModelDonut({ summary }: { summary: SummaryResponse | null }) {
  if (!summary || summary.topModels.length === 0) return <EmptyState />;

  const models = summary.topModels;
  const totalCost = models.reduce((sum, m) => sum + (m.cost ?? 0), 0);

  const data = {
    labels: models.map((m) => m.model_id),
    datasets: [
      {
        data: models.map((m) => Math.max(m.cost ?? 0, 0)),
        backgroundColor: models.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]!),
        borderColor: bg,
        borderWidth: 2,
        hoverBorderColor: bg,
        hoverBorderWidth: 3,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "60%",
    plugins: {
      legend: {
        position: "right" as const,
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
          label: (ctx: import("chart.js").TooltipItem<"doughnut">) => {
            const model = models[ctx.dataIndex];
            if (!model) return "";
            const share = totalCost > 0 ? ((model.cost ?? 0) / totalCost) * 100 : 0;
            return ` ${ctx.label}: ${fmtUSD(model.cost ?? 0)} (${share.toFixed(1)}%) • ${fmtNum(model.tokens)} tok`;
          },
        },
      },
    },
  };

  return (
    <div className="flex justify-center">
      <div className="h-[320px] w-[320px]">
        <Doughnut data={data} options={options} />
      </div>
    </div>
  );
}

/* ── Cache Savings ──────────────────────────────────────────────────── */

function CacheSavings({ daily, totalCost }: { daily: DailyRow[] | null; totalCost: number }) {
  const stats = useMemo(() => {
    if (!daily) return null;
    let totalCacheRead = 0;
    for (const d of daily) {
      totalCacheRead += d.cache_read ?? 0;
    }
    const saved = totalCacheRead * 0.000001;
    const pct = totalCost > 0 ? (saved / totalCost) * 100 : 0;
    return { totalCacheRead, saved, pct };
  }, [daily, totalCost]);

  if (!stats) return <LoadingPlaceholder rows={2} />;
  if (stats.totalCacheRead === 0) return <EmptyState />;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div className="border border-cyber-cyan/10 bg-cyber-cyan/[0.03] p-4 text-center">
        <div className="text-cyber-cyan/50 text-xs tracking-[0.12em] uppercase mb-2">
          Cache Tokens Read
        </div>
        <div className="text-cyber-cyan text-xl tabular-nums">
          {fmtNum(stats.totalCacheRead)}
        </div>
      </div>
      <div className="border border-cyber-cyan/10 bg-cyber-cyan/[0.03] p-4 text-center">
        <div className="text-cyber-cyan/50 text-xs tracking-[0.12em] uppercase mb-2">
          Estimated Savings
        </div>
        <div className="text-cyber-cyan text-xl tabular-nums">
          {fmtUSD(stats.saved)}
        </div>
      </div>
      <div className="border border-cyber-cyan/10 bg-cyber-cyan/[0.03] p-4 text-center">
        <div className="text-cyber-cyan/50 text-xs tracking-[0.12em] uppercase mb-2">
          % of Total Cost
        </div>
        <div className="text-cyber-cyan text-xl tabular-nums">
          {stats.pct.toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

/* ── Cost per Agent Table ───────────────────────────────────────────── */

interface AgentCost {
  agent: string;
  sessions: number;
  totalCost: number;
  avgCost: number;
  type: string;
}

function CostPerAgentTable({ agents }: { agents: SummaryResponse["topAgents"] | null }) {
  const agentCosts = useMemo(() => {
    if (!agents) return null;
    const result: AgentCost[] = agents.map((a) => ({
      agent: a.agent,
      sessions: a.sessions,
      totalCost: a.cost ?? 0,
      avgCost: a.sessions > 0 ? (a.cost ?? 0) / a.sessions : 0,
      type: a.type.charAt(0).toUpperCase() + a.type.slice(1),
    }));
    result.sort((a, b) => b.sessions - a.sessions);
    return result;
  }, [agents]);

  if (!agentCosts) return <LoadingPlaceholder rows={4} />;
  if (agentCosts.length === 0) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
            <th className="text-left py-2 pr-4 font-normal">Agent</th>
            <th className="text-center py-2 pr-4 font-normal">Type</th>
            <th className="text-right py-2 pr-4 font-normal">Sessions</th>
            <th className="text-right py-2 pr-4 font-normal">Total Cost</th>
            <th className="text-right py-2 font-normal">Avg / Session</th>
          </tr>
        </thead>
        <tbody>
          {agentCosts.map((a) => (
            <tr
              key={a.agent}
              className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/5 transition-colors"
            >
              <td className="py-2 pr-4 text-cyber-cyan truncate max-w-[200px]">
                {a.agent}
              </td>
              <td className="py-2 pr-4 text-center">
                <span className={`text-[10px] tracking-[0.08em] uppercase ${
                  a.type === "Both" ? "text-cyber-purple" :
                  a.type === "Main" ? "text-cyber-cyan/70" :
                  a.type === "Sub" ? "text-cyber-magenta" :
                  "text-cyber-cyan/40"
                }`}>
                  {a.type}
                </span>
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">
                {a.sessions}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {fmtUSD(a.totalCost)}
              </td>
              <td className="py-2 text-right tabular-nums text-cyber-cyan/70">
                {fmtUSD(a.avgCost)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Cost Trend Line Chart ──────────────────────────────────────────── */

function CostTrendChart({ daily }: { daily: DailyRow[] | null }) {
  if (!daily || daily.length === 0) return <EmptyState />;

  const labels = daily.map((d) => {
    if (!d.date) return "";
    const parts = d.date.split("-");
    return parts.length >= 2 ? `${parts[1]}/${parts[2]}` : d.date;
  });

  const data = {
    labels,
    datasets: [
      {
        label: "Cost",
        data: daily.map((d) => d.total_cost),
        borderColor: cyan,
        backgroundColor: `${cyan}26`, // 15% alpha
        fill: true,
        tension: 0.3,
        pointRadius: 3,
        pointBackgroundColor: cyan,
        pointBorderColor: bg,
        pointBorderWidth: 1,
        pointHoverRadius: 5,
        pointHoverBackgroundColor: magenta,
        borderWidth: 2,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: bg,
        titleColor: cyan,
        bodyColor: text,
        borderColor: cyan,
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: (ctx: import("chart.js").TooltipItem<"line">) => ` ${fmtUSD(ctx.raw as number)}`,
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
        grid: { color: chartColors.scale.grid.color },
        ticks: {
          color: text,
          font: { family: "'Share Tech Mono', monospace", size: 10 },
          callback: (val: string | number) => fmtUSD(Number(val)),
        },
      },
    },
    interaction: {
      intersect: false,
      mode: "index" as const,
    },
  };

  return (
    <div className="h-[280px]">
      <Line data={data} options={options} />
    </div>
  );
}

/* ── Main CostTab ───────────────────────────────────────────────────── */

export default function CostTab() {
  const { data: summary, loading: summaryLoading, error: summaryError } = useSummary();
  const { data: daily, loading: dailyLoading, error: dailyError } = useDaily();

  const totalCost = summary?.totalCost ?? 0;
  const errors = [summaryError, dailyError].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {errors.length > 0 && (
        <div className="text-cyber-danger text-sm p-4 border border-cyber-danger/30 rounded bg-cyber-danger/5">
          {errors.join(" | ")}
        </div>
      )}

      {/* Cost by Model — Donut Chart */}
      <Section title="Cost by Model">
        {summaryLoading ? (
          <LoadingPlaceholder rows={4} />
        ) : summaryError ? (
          <span className="text-cyber-danger text-xs">{summaryError}</span>
        ) : (
          <CostByModelDonut summary={summary} />
        )}
      </Section>

      {/* Cache Savings */}
      <Section title="Cache Savings">
        <CacheSavings daily={daily} totalCost={totalCost} />
      </Section>

      {/* Cost per Agent Table */}
      <Section title="Cost per Agent">
        {summaryLoading ? (
          <LoadingPlaceholder rows={4} />
        ) : summaryError ? (
          <span className="text-cyber-danger text-xs">{summaryError}</span>
        ) : (
          <CostPerAgentTable agents={summary?.topAgents ?? null} />
        )}
      </Section>

      {/* Cost Trend */}
      <Section title="Cost Trend">
        {dailyLoading ? (
          <LoadingPlaceholder rows={3} />
        ) : dailyError ? (
          <span className="text-cyber-danger text-xs">{dailyError}</span>
        ) : (
          <CostTrendChart daily={daily} />
        )}
      </Section>
    </div>
  );
}
