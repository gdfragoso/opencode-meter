import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Doughnut } from "react-chartjs-2";
import "@/dashboard/lib/chartSetup";
import KPICard from "@/dashboard/components/KPICard";
import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { useProjects } from "@/dashboard/hooks/useProjects";
import { fmtNum, fmtUSD, fmtTime } from "@/dashboard/lib/format";
import { chartColors, cyan, bg, donutExtras } from "@/dashboard/lib/colors";
import type { ProjectRow } from "@/dashboard/lib/api";

/* ── helpers ─────────────────────────────────────────────────────────── */

function basename(directory: string): string {
  return directory.split("/").pop() || directory;
}

function parseBranches(p: ProjectRow): string[] {
  try {
    const arr = JSON.parse(p.branches);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/* ── KPI row (portfolio) ──────────────────────────────────────────────── */

function KPIRow({ projects }: { projects: ProjectRow[] }) {
  const totalCost = projects.reduce((s, p) => s + (p.total_cost ?? 0), 0);
  const totalSessions = projects.reduce((s, p) => s + (p.sessions ?? 0), 0);
  const totalErrors = projects.reduce((s, p) => s + (p.error_count ?? 0), 0);
  const avgCostPerSession =
    totalSessions > 0 ? totalCost / totalSessions : 0;

  let mostActive: ProjectRow | null = null;
  for (const p of projects) {
    if (p.last_active != null && (!mostActive || (mostActive.last_active ?? -1) < p.last_active)) {
      mostActive = p;
    }
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      <KPICard label="Projects" value={projects.length} />
      <KPICard label="Total Cost" value={fmtUSD(totalCost)} />
      <KPICard label="Total Sessions" value={fmtNum(totalSessions)} />
      <KPICard
        label="Most Active"
        value={mostActive ? basename(mostActive.directory) : "\u2014"}
        subtitle={mostActive?.last_active != null ? fmtTime(mostActive.last_active) : undefined}
      />
      <KPICard label="Errors" value={fmtNum(totalErrors)} />
      <KPICard label="Avg Cost / Session" value={fmtUSD(avgCostPerSession)} />
      <KPICard label="Tokens / $" value={totalCost > 0 ? fmtNum(projects.reduce((s, p) => s + p.tokens_in + p.tokens_out, 0) / totalCost) : "\u2014"} />
    </div>
  );
}

/* ── projects table (portfolio) ───────────────────────────────────────── */

function ProjectsTable({
  projects,
  totalCost,
  onRowClick,
}: {
  projects: ProjectRow[];
  totalCost: number;
  onRowClick: (p: ProjectRow) => void;
}) {
  const sorted = useMemo(
    () =>
      [...projects].sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0)),
    [projects],
  );

  if (sorted.length === 0) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
            <th className="text-left py-2 pr-4 font-normal">Project</th>
            <th className="text-left py-2 pr-4 font-normal">Branches</th>
            <th className="text-right py-2 pr-4 font-normal">Sessions</th>
            <th className="text-right py-2 pr-4 font-normal">Tokens In</th>
            <th className="text-right py-2 pr-4 font-normal">Tokens Out</th>
            <th className="text-right py-2 pr-4 font-normal">Cost</th>
            <th className="text-right py-2 pr-4 font-normal">% Cost</th>
            <th className="text-right py-2 pr-4 font-normal">Errors</th>
            <th className="text-right py-2 pr-4 font-normal">Avg Cost</th>
            <th className="text-right py-2 pr-4 font-normal">Last Active</th>
            <th className="text-left py-2 font-normal">Top Model</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const pct = totalCost > 0 ? ((p.total_cost ?? 0) / totalCost) * 100 : 0;
            const branchList = parseBranches(p);
            return (
              <tr
                key={p.directory}
                tabIndex={0}
                role="button"
                onClick={() => onRowClick(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRowClick(p);
                }}
                className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/5 transition-colors cursor-pointer"
              >
                <td
                  className="py-2 pr-4 text-cyber-cyan truncate max-w-[140px]"
                  title={p.directory}
                >
                  {basename(p.directory)}
                </td>
                <td className="py-2 pr-4 text-cyber-cyan/50 truncate max-w-[100px]">
                  {branchList.length > 0 ? (
                    <span className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 text-xs rounded-full bg-cyber-cyan/10 text-cyber-cyan border border-cyber-cyan/20">
                      {branchList.length}
                    </span>
                  ) : "\u2014"}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {fmtNum(p.sessions)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">
                  {fmtNum(p.tokens_in)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">
                  {fmtNum(p.tokens_out)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums">
                  {fmtUSD(p.total_cost)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-cyber-magenta">
                  {pct.toFixed(1)}%
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-cyber-danger">
                  {p.error_count > 0 ? fmtNum(p.error_count) : "\u2014"}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                  {fmtUSD(p.avg_cost_per_session)}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60 whitespace-nowrap">
                  {fmtTime(p.last_active)}
                </td>
                <td className="py-2 text-cyber-cyan/50 truncate max-w-[140px]">
                  {p.top_model ?? "\u2014"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ── cost-by-project donut (portfolio) ────────────────────────────────── */

function CostByProjectChart({ projects }: { projects: ProjectRow[] }) {
  const sorted = useMemo(
    () =>
      [...projects]
        .sort((a, b) => (b.total_cost ?? 0) - (a.total_cost ?? 0))
        .slice(0, 8),
    [projects],
  );

  if (sorted.length === 0) return null;

  const labels = sorted.map((p) => basename(p.directory));
  const values = sorted.map((p) => p.total_cost ?? 0);
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

/* ── Main ProjectsTab ─────────────────────────────────────────────────── */

export default function ProjectsTab() {
  const { loading, error, projects } = useProjects();
  const navigate = useNavigate();

  const totalCost = useMemo(
    () => projects.reduce((s, p) => s + (p.total_cost ?? 0), 0),
    [projects],
  );

  const handleRowClick = (p: ProjectRow) => {
    navigate(`/projects/${encodeURIComponent(p.directory)}`);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="border border-cyber-cyan/20 bg-cyber-cyan/5 p-4 animate-pulse"
            >
              <div className="h-3 bg-cyber-cyan/10 rounded mb-3 w-1/2" />
              <div className="h-6 bg-cyber-cyan/10 rounded w-3/4" />
            </div>
          ))}
        </div>
        <Section title="Cost by Project">
          <LoadingPlaceholder rows={4} />
        </Section>
        <Section title="All Projects">
          <LoadingPlaceholder rows={6} />
        </Section>
      </div>
    );
  }

  if (projects.length === 0) {
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

      {/* KPI Row */}
      <KPIRow projects={projects} />

      {/* Cost-by-project donut */}
      <Section title="Cost by Project">
        <CostByProjectChart projects={projects} />
      </Section>

      {/* Projects table */}
      <Section title="All Projects" meta={`${projects.length} project${projects.length !== 1 ? "s" : ""}`}>
        <ProjectsTable projects={projects} totalCost={totalCost} onRowClick={handleRowClick} />
      </Section>
    </div>
  );
}
