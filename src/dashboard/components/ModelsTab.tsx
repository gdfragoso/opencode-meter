import { Fragment, useMemo, useState } from "react";
import { Bar } from "react-chartjs-2";
import ModelCards from "@/dashboard/components/ModelCards";
import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { useModels } from "@/dashboard/hooks/useModels";
import { fmtNum, fmtUSD, fmtDur } from "@/dashboard/lib/format";
import { chartColors, cyan, magenta, yellow, bg } from "@/dashboard/lib/colors";
import type { ModelAggregateRow } from "@/data/domain/event";

type ModelInfo = ModelAggregateRow;

/* ── helpers ─────────────────────────────────────────────────────────── */

function computeModelCost(m: ModelInfo, allModels: ModelInfo[]): number {
  if (m.cost != null && m.cost > 0) return m.cost;
  const totalTokens = allModels.reduce((sum, t) => sum + t.tokens, 0);
  const totalCost = allModels.reduce((sum, t) => (t.cost != null ? sum + t.cost : sum), 0);
  if (totalCost > 0 && totalTokens > 0) {
    return (m.tokens / totalTokens) * totalCost;
  }
  return 0;
}

/* ── provider filter ────────────────────────────────────────────────── */

function ProviderFilter({
  providers,
  selected,
  onChange,
}: {
  providers: string[];
  selected: string;
  onChange: (p: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <label className="text-cyber-cyan/50 text-xs tracking-[0.12em] uppercase">
        Provider
      </label>
      <select
        value={selected}
        onChange={(e) => onChange(e.target.value)}
        className="bg-cyber-bg border border-cyber-cyan/20 text-cyber-cyan text-xs px-3 py-1.5 tracking-[0.08em] uppercase cursor-pointer outline-none focus:border-cyber-cyan/60 transition-colors"
      >
        <option value="all">ALL</option>
        {providers.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ── models table ───────────────────────────────────────────────────── */

function ModelsTable({ models }: { models: ModelInfo[] }) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  if (models.length === 0) return <EmptyState />;

  const allColumns = 7;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
            <th className="text-left py-2 pr-4 font-normal">Model</th>
            <th className="text-left py-2 pr-4 font-normal">Provider</th>
            <th className="text-right py-2 pr-4 font-normal">Sessions</th>
            <th className="text-right py-2 pr-4 font-normal">Tokens</th>
            <th className="text-right py-2 pr-4 font-normal">Cost</th>
            <th className="text-right py-2 pr-4 font-normal">Avg TTFT</th>
            <th className="text-right py-2 font-normal">Cache Hit</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m, idx) => {
            const isExpanded = expandedRow === idx;

            return (
              <Fragment key={`${m.provider_id}/${m.model_id}`}>
                <tr
                  className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/5 transition-colors cursor-pointer"
                  onClick={() =>
                    setExpandedRow(isExpanded ? null : idx)
                  }
                >
                  <td className="py-2 pr-4 text-cyber-cyan truncate max-w-[160px]">
                    <span
                      className={`inline-block transition-transform duration-200 mr-1.5 ${isExpanded ? "rotate-90" : ""}`}
                    >
                      ▶
                    </span>
                    {m.model_id}
                  </td>
                  <td className="py-2 pr-4 text-cyber-cyan/50">
                    {m.provider_id}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {fmtNum(m.sessions)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {fmtNum(m.tokens)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {fmtUSD(m.cost)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {fmtDur(m.ttft_avg_ms)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {m.cache_hit_rate != null
                      ? `${(m.cache_hit_rate * 100).toFixed(1)}%`
                      : "\u2014"}
                  </td>
                </tr>
                {isExpanded && (
                  <tr>
                    <td colSpan={allColumns} className="p-0">
                      <div className="bg-cyber-cyan/5 border-l-2 border-cyber-cyan/30 p-4 overflow-hidden transition-all duration-300">
                        <div className="grid grid-cols-4 gap-4 text-xs">
                          <div>
                            <div className="text-cyber-cyan/50 mb-1">
                              Error Rate
                            </div>
                            <div className="tabular-nums">
                              {m.error_rate != null
                                ? `${(m.error_rate * 100).toFixed(1)}%`
                                : "\u2014"}
                            </div>
                          </div>
                          <div>
                            <div className="text-cyber-cyan/50 mb-1">
                              Cache Hit
                            </div>
                            <div className="tabular-nums">
                              {m.cache_hit_rate != null
                                ? `${(m.cache_hit_rate * 100).toFixed(1)}%`
                                : "\u2014"}
                            </div>
                          </div>
                          <div>
                            <div className="text-cyber-cyan/50 mb-1">
                              Avg TTFT
                            </div>
                            <div className="tabular-nums">
                              {fmtDur(m.ttft_avg_ms)}
                            </div>
                          </div>
                          <div>
                            <div className="text-cyber-cyan/50 mb-1">
                              Tokens/s
                            </div>
                            <div className="tabular-nums">
                              {m.tokens_per_sec != null
                                ? m.tokens_per_sec.toFixed(1)
                                : "\u2014"}
                            </div>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── comparison chart ───────────────────────────────────────────────── */

interface ChartDatum {
  model_id: string;
  sessionsPct: number;
  tokensPct: number;
  costPct: number;
  sessionsRaw: number;
  tokensRaw: number;
  costRaw: number;
}

function ModelComparisonChart({ models }: { models: ModelInfo[] }) {
  if (models.length === 0) return <EmptyState />;

  /* compute totals before percentages */
  const totalSessions = models.reduce((sum, m) => sum + m.sessions, 0);
  const totalTokens = models.reduce((sum, m) => sum + m.tokens, 0);

  const data: ChartDatum[] = models.map((m) => {
    const cost = computeModelCost(m, models);
    return {
      model_id: m.model_id,
      sessionsPct: totalSessions > 0 ? (m.sessions / totalSessions) * 100 : 0,
      tokensPct: totalTokens > 0 ? (m.tokens / totalTokens) * 100 : 0,
      costPct: cost > 0 ? (cost / models.reduce((s, t) => s + computeModelCost(t, models), 0)) * 100 : 0,
      sessionsRaw: m.sessions,
      tokensRaw: m.tokens,
      costRaw: cost,
    };
  });

  const labels = data.map((d) => d.model_id);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Sessions %",
        data: data.map((d) => d.sessionsPct),
        backgroundColor: cyan,
        borderColor: "transparent",
        borderWidth: 0,
        borderRadius: 0,
      },
      {
        label: "Tokens %",
        data: data.map((d) => d.tokensPct),
        backgroundColor: magenta,
        borderColor: "transparent",
        borderWidth: 0,
        borderRadius: 0,
      },
      {
        label: "Cost %",
        data: data.map((d) => d.costPct),
        backgroundColor: yellow,
        borderColor: "transparent",
        borderWidth: 0,
        borderRadius: 0,
      },
    ],
  };

  const options = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: chartColors.color,
          font: { size: 11, family: "'Share Tech Mono', monospace" },
          padding: 16,
          usePointStyle: true,
          pointStyleWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: bg,
        titleColor: cyan,
        bodyColor: chartColors.color,
        borderColor: cyan,
        borderWidth: 1,
        callbacks: {
          label: function (tooltipItem: { dataset: { label?: string }; raw: unknown; dataIndex: number }) {
            const d = data[tooltipItem.dataIndex];
            const pct = (tooltipItem.raw as number).toFixed(1);
            let suffix = "";
            if (tooltipItem.dataset.label === "Sessions %") {
              suffix = ` (${fmtNum(d.sessionsRaw)} sessions)`;
            } else if (tooltipItem.dataset.label === "Tokens %") {
              suffix = ` (${fmtNum(d.tokensRaw)} tokens)`;
            } else if (tooltipItem.dataset.label === "Cost %") {
              suffix = ` (${fmtUSD(d.costRaw)})`;
            }
            return `${pct}%${suffix}`;
          },
        },
      },
    },
    scales: {
      x: {
        max: 100,
        grid: { color: chartColors.scale.grid.color },
        ticks: {
          color: chartColors.scale.ticks.color,
          callback: (val: string | number) => `${Number(val)}%`,
        },
      },
      y: {
        grid: { display: false },
        ticks: {
          color: cyan,
          font: { family: "'Share Tech Mono', monospace", size: 11 },
          callback: function (val: string | number, _index: number) {
            const label = labels[val as number] ?? "";
            return label.length > 28 ? label.slice(0, 28) + "…" : label;
          },
        },
      },
    },
  };

  const height = Math.max(280, data.length * 38 + 40);

  return (
    <div style={{ height: `${height}px` }}>
      <Bar data={chartData} options={options} />
    </div>
  );
}

/* ── Main ModelsTab ──────────────────────────────────────────────────── */

export default function ModelsTab() {
  const { data: modelsData, loading, error } = useModels();
  const [providerFilter, setProviderFilter] = useState("all");

  // `modelsData?.models ?? []` built a new array on every render, so both
  // memos below recomputed every time and memoised nothing.
  const allModels: ModelInfo[] = useMemo(() => modelsData?.models ?? [], [modelsData]);

  const uniqueProviders = useMemo(
    () =>
      [...new Set(allModels.map((m) => m.provider_id).filter(Boolean))].sort(),
    [allModels],
  );

  const filteredModels = useMemo(
    () =>
      providerFilter === "all"
        ? allModels
        : allModels.filter((m) => m.provider_id === providerFilter),
    [allModels, providerFilter],
  );

  /** ModelCards expects `ttft_avg` (old API shape); adapt from `ttft_avg_ms`. */
  const cardModels = useMemo(
    () =>
      filteredModels.map((m) => ({ ...m, ttft_avg: m.ttft_avg_ms })),
    [filteredModels],
  );

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="border border-cyber-cyan/15 bg-cyber-cyan/[0.03] p-4 animate-pulse"
            >
              <div className="h-3 bg-cyber-cyan/10 rounded mb-3 w-1/2" />
              <div className="h-2 bg-cyber-cyan/10 rounded mb-2 w-1/3" />
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="h-4 bg-cyber-cyan/10 rounded" />
                <div className="h-4 bg-cyber-cyan/10 rounded" />
                <div className="h-4 bg-cyber-cyan/10 rounded" />
                <div className="h-4 bg-cyber-cyan/10 rounded" />
              </div>
            </div>
          ))}
        </div>
        <Section title="Model Comparison">
          <LoadingPlaceholder rows={4} />
        </Section>
        <Section title="All Models">
          <LoadingPlaceholder rows={5} />
        </Section>
      </div>
    );
  }

  if (!modelsData || allModels.length === 0) {
    return (
      <div className="space-y-6">
        {error && (
          <div className="text-cyber-danger text-sm p-4 border border-cyber-danger/30 rounded bg-cyber-danger/5">
            {error}
          </div>
        )}
        <EmptyState />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {error && (
        <div className="text-cyber-danger text-sm p-4 border border-cyber-danger/30 rounded bg-cyber-danger/5">
          {error}
        </div>
      )}

      {/* Model cards */}
      <Section title="Model Stats">
        <ModelCards models={cardModels} />
      </Section>

      {/* Comparison chart + provider filter */}
      <Section title="Model Comparison">
        <ProviderFilter
          providers={uniqueProviders}
          selected={providerFilter}
          onChange={setProviderFilter}
        />
        <ModelComparisonChart models={filteredModels} />
      </Section>

      {/* Models table */}
      <Section title="All Models">
        <ProviderFilter
          providers={uniqueProviders}
          selected={providerFilter}
          onChange={setProviderFilter}
        />
        <ModelsTable models={filteredModels} />
      </Section>
    </div>
  );
}
