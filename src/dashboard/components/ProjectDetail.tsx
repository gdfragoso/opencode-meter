import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Doughnut } from "react-chartjs-2";
import "@/dashboard/lib/chartSetup";
import KPICard from "@/dashboard/components/KPICard";
import {
  Section,
  LoadingPlaceholder,
  EmptyState,
} from "@/dashboard/components/ui";
import { useApi } from "@/dashboard/hooks/useApi";
import { useRange, useRefresh } from "@/dashboard/App";
import { fmtNum, fmtUSD, fmtTime } from "@/dashboard/lib/format";
import { chartColors, cyan, bg, donutExtras } from "@/dashboard/lib/colors";
import type { ProjectDetail, ProjectBranchSummary } from "@/dashboard/lib/api";

/* ── helpers ─────────────────────────────────────────────────────────── */

function basename(directory: string): string {
  return directory.split("/").pop() || directory;
}

/* ── KPI row (detail) ─────────────────────────────────────────────────── */

function ProjectKPIRow({ detail }: { detail: ProjectDetail }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <KPICard label="Sessions" value={fmtNum(detail.sessions)} />
      <KPICard label="Total Cost" value={fmtUSD(detail.total_cost)} />
      <KPICard label="Branches" value={detail.branch_count} />
      <KPICard label="Top Model" value={detail.top_model ?? "\u2014"} />
      <KPICard label="Errors" value={fmtNum(detail.error_count)} />
      <KPICard
        label="Avg Cost / Session"
        value={fmtUSD(detail.avg_cost_per_session)}
      />
      <KPICard
        label="Tokens / $"
        value={
          detail.tokens_per_dollar > 0
            ? fmtNum(detail.tokens_per_dollar)
            : "\u2014"
        }
      />
      <KPICard label="Tools" value={fmtNum(detail.tools_total)} />
    </div>
  );
}

/* ── cost-by-branch donut ─────────────────────────────────────────────── */

function CostByBranchChart({
  branches,
}: {
  branches: ProjectBranchSummary[];
}) {
  const sorted = useMemo(
    () => [...branches].sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0)),
    [branches],
  );

  if (sorted.length === 0) return <EmptyState message="No branch data" />;

  const labels = sorted.map((b) => b.branch ?? "\u2014");
  const values = sorted.map((b) => b.total_cost ?? 0);
  const palette = [cyan, ...donutExtras];

  const data = {
    labels,
    datasets: [
      {
        data: values,
        backgroundColor: labels.map((_, i) => palette[i % palette.length]),
        borderColor: bg,
        borderWidth: 2,
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
          color: chartColors.color,
          font: { family: "'Share Tech Mono', monospace", size: 10 },
          padding: 12,
          usePointStyle: true,
          boxWidth: 8,
        },
      },
      tooltip: {
        backgroundColor: bg,
        titleColor: cyan,
        bodyColor: chartColors.color,
        borderColor: cyan,
        borderWidth: 1,
        callbacks: {
          label: (ctx: { dataIndex: number; raw: unknown }) => {
            const v = Number(ctx.raw);
            const total = values.reduce((s, x) => s + x, 0);
            const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0.0";
            return `${fmtUSD(v)} (${pct}%)`;
          },
        },
      },
    },
  };

  return (
    <div className="h-[320px]">
      <Doughnut data={data} options={options} />
    </div>
  );
}

/* ── branch breakdown table ───────────────────────────────────────────── */

function BranchTable({ branches }: { branches: ProjectBranchSummary[] }) {
  const sorted = useMemo(
    () => [...branches].sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0)),
    [branches],
  );

  if (sorted.length === 0) return <EmptyState message="No branch data" />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
            <th className="text-left py-2 pr-4 font-normal">Branch</th>
            <th className="text-right py-2 pr-4 font-normal">Sessions</th>
            <th className="text-right py-2 pr-4 font-normal">Cost</th>
            <th className="text-right py-2 pr-4 font-normal">Tokens In</th>
            <th className="text-right py-2 pr-4 font-normal">Tokens Out</th>
            <th className="text-right py-2 pr-4 font-normal">Last Active</th>
            <th className="text-left py-2 font-normal">Top Model</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((b) => (
            <tr
              key={b.branch ?? "null"}
              className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/5 transition-colors"
            >
              <td className="py-2 pr-4 text-cyber-cyan truncate max-w-[180px]">
                {b.branch ?? "\u2014"}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {fmtNum(b.sessions)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums">
                {fmtUSD(b.total_cost)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">
                {fmtNum(b.tokens_in)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">
                {fmtNum(b.tokens_out)}
              </td>
              <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60 whitespace-nowrap">
                {fmtTime(b.last_active)}
              </td>
              <td className="py-2 text-cyber-cyan/50 truncate max-w-[160px]">
                {b.top_model ?? "\u2014"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── model distribution ──────────────────────────────────────────────── */

function ModelDistribution({
  models,
}: {
  models: Array<{ model_id: string; sessions: number; cost: number }>;
}) {
  if (models.length === 0) return <EmptyState message="No model data" />;

  const totalCost = models.reduce((s, m) => s + m.cost, 0);

  return (
    <div className="space-y-2">
      {models.map((m) => {
        const pct = totalCost > 0 ? (m.cost / totalCost) * 100 : 0;
        return (
          <div key={m.model_id} className="flex items-center gap-3">
            <span
              className="text-cyber-cyan text-xs w-[200px] truncate"
              title={m.model_id}
            >
              {m.model_id}
            </span>
            <div className="flex-1 h-4 bg-cyber-cyan/5 rounded overflow-hidden">
              <div
                className="h-full bg-cyber-cyan/30 rounded transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-cyber-cyan/60 text-xs tabular-nums w-[80px] text-right">
              {fmtUSD(m.cost)}
            </span>
            <span className="text-cyber-cyan/40 text-xs tabular-nums w-[60px] text-right">
              {fmtNum(m.sessions)} ses
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── main component ──────────────────────────────────────────────────── */

export default function ProjectDetail() {
  const { directory } = useParams<{ directory: string }>();
  const navigate = useNavigate();
  const { days } = useRange();
  const { refreshKey } = useRefresh();

  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  const url = directory
    ? `/api/projects/${encodeURIComponent(directory)}?${params}`
    : "";

  const { data: detail, loading, error } = useApi<ProjectDetail | null>(
    url,
    refreshKey,
  );

  const handleBack = () => navigate("/projects");

  if (loading) {
    return (
      <div className="space-y-4">
        <button
          onClick={handleBack}
          className="text-cyber-cyan/60 hover:text-cyber-cyan text-xs tracking-[0.12em] uppercase border border-cyber-cyan/20 hover:border-cyber-cyan/50 px-3 py-1.5 transition-all duration-200 cursor-pointer"
        >
          &#8592; Back to Projects
        </button>
        <LoadingPlaceholder rows={8} />
      </div>
    );
  }

  if (!directory || !detail) {
    return (
      <div className="space-y-4">
        <button
          onClick={handleBack}
          className="text-cyber-cyan/60 hover:text-cyber-cyan text-xs tracking-[0.12em] uppercase border border-cyber-cyan/20 hover:border-cyber-cyan/50 px-3 py-1.5 transition-all duration-200 cursor-pointer"
        >
          &#8592; Back to Projects
        </button>
        {error ? (
          <div className="border border-cyber-danger/30 bg-cyber-danger/5 p-8 text-center">
            <p className="text-cyber-danger text-sm tracking-[0.1em] uppercase">
              Error loading project
            </p>
            <p className="text-cyber-danger/50 text-xs mt-2">{error}</p>
          </div>
        ) : (
          <div className="border border-cyber-danger/30 bg-cyber-danger/5 p-8 text-center">
            <p className="text-cyber-danger text-sm tracking-[0.1em] uppercase">
              Project not found
            </p>
            <p className="text-cyber-danger/50 text-xs mt-2 font-mono">
              {directory ? decodeURIComponent(directory) : "\u2014"}
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button + header */}
      <div className="flex items-center gap-4 mb-2">
        <button
          onClick={handleBack}
          className="text-cyber-cyan/60 hover:text-cyber-cyan text-xs tracking-[0.12em] uppercase border border-cyber-cyan/20 hover:border-cyber-cyan/50 px-3 py-1.5 transition-all duration-200 cursor-pointer"
        >
          &#8592; Back to Projects
        </button>
        <div className="flex-1" />
      </div>

      <div>
        <h2 className="text-cyber-cyan text-2xl tracking-[0.08em] uppercase">
          {basename(detail.directory)}
        </h2>
        <p className="text-cyber-cyan/40 text-xs tracking-[0.1em] mt-1 truncate">
          {detail.directory}
        </p>
      </div>

      {/* KPI row */}
      <ProjectKPIRow detail={detail} />

      {/* Cost by branch donut + model distribution side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section title="Cost by Branch">
          <CostByBranchChart branches={detail.branch_summaries} />
        </Section>
        <Section
          title="Model Distribution"
          meta={`${detail.models.length} model${detail.models.length !== 1 ? "s" : ""}`}
        >
          <ModelDistribution models={detail.models} />
        </Section>
      </div>

      {/* Branch breakdown table */}
      <Section
        title="Branch Breakdown"
        meta={`${detail.branch_summaries.length} branch${detail.branch_summaries.length !== 1 ? "es" : ""}`}
      >
        <BranchTable branches={detail.branch_summaries} />
      </Section>
    </div>
  );
}
