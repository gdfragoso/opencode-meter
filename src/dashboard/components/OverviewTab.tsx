import { useMemo, useState } from "react";
import { Bar, Doughnut } from "react-chartjs-2";
import KPICard from "@/dashboard/components/KPICard";
import { Section, LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { useSummary } from "@/dashboard/hooks/useSummary";
import { useSessionTypes, type SessionTypesResponse } from "@/dashboard/hooks/useSessionTypes";
import { useSkills } from "@/dashboard/hooks/useSkills";
import { useToolMetrics } from "@/dashboard/hooks/useToolMetrics";
import { fmtNum, fmtUSD, fmtDur } from "@/dashboard/lib/format";
import { isBuiltinTool, extractServer } from "@/dashboard/lib/tools";
import { chartColors, cyan, magenta, yellow, bg } from "@/dashboard/lib/colors";
import type { SummaryResponse } from "@/data/domain/metrics";
import type { ToolMetricsRow } from "@/data/domain/event";
import type { SkillsResponse } from "@/dashboard/hooks/useSkills";

/* ── helpers ─────────────────────────────────────────────────────────── */

interface McpMetricsGroup {
  server: string;
  tools: ToolMetricsRow[];
  totalCalls: number;
  totalCost: number;
}

function classifyToolMetrics(metrics: ToolMetricsRow[]): {
  builtin: ToolMetricsRow[];
  mcp: McpMetricsGroup[];
} {
  const builtin: ToolMetricsRow[] = [];
  const mcpMap = new Map<string, ToolMetricsRow[]>();

  for (const m of metrics) {
    if (isBuiltinTool(m.tool)) {
      builtin.push(m);
    } else {
      const server = extractServer(m.tool);
      if (!mcpMap.has(server)) mcpMap.set(server, []);
      mcpMap.get(server)!.push(m);
    }
  }

  const mcp: McpMetricsGroup[] = [...mcpMap.entries()]
    .map(([server, tools]) => ({
      server,
      tools: tools.sort((a, b) => b.calls - a.calls),
      totalCalls: tools.reduce((s, t) => s + t.calls, 0),
      totalCost: tools.reduce((s, t) => s + (t.total_cost ?? 0), 0),
    }))
    .sort((a, b) => b.totalCalls - a.totalCalls);

  builtin.sort((a, b) => b.calls - a.calls);

  return { builtin, mcp };
}

/* ── KPI row ────────────────────────────────────────────────────────── */

function KPIRow({
  summary,
  skills,
}: {
  summary: SummaryResponse | null;
  skills: SkillsResponse | null;
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
      <KPICard
        label="Sessions"
        value={summary ? `${summary.totalUserSessions}` : "\u2014"}
        subtitle={summary ? `${summary.totalSessions} total incl. subagents` : undefined}
      />
      <KPICard
        label="Tokens"
        value={summary ? fmtNum(summary.totalTokens) : "\u2014"}
      />
      <KPICard
        label="Cost"
        value={summary ? fmtUSD(summary.totalCost) : "\u2014"}
      />
      <KPICard
        label="Tools"
        value={summary ? fmtNum(summary.totalTools) : "\u2014"}
      />
      <KPICard
        label="Agents"
        value={summary?.topAgents ? summary.topAgents.length : "\u2014"}
      />
      <KPICard
        label="Skills"
        value={skills ? skills.count : "\u2014"}
      />
    </div>
  );
}

/* ── Top Models table ───────────────────────────────────────────────── */

function TopModels({ summary }: { summary: SummaryResponse | null }) {
  if (!summary || summary.topModels.length === 0) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
            <th className="text-left py-2 pr-4 font-normal">Model</th>
            <th className="text-left py-2 pr-4 font-normal">Provider</th>
            <th className="text-right py-2 pr-4 font-normal">Sessions</th>
            <th className="text-right py-2 font-normal">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {summary.topModels.map((m) => (
            <tr
              key={`${m.provider_id}/${m.model_id}`}
              className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/5 transition-colors"
            >
              <td className="py-2 pr-4 text-cyber-cyan truncate max-w-[160px]">
                {m.model_id}
              </td>
              <td className="py-2 pr-4 text-cyber-cyan/50">{m.provider_id}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{m.sessions}</td>
              <td className="py-2 text-right tabular-nums">{fmtNum(m.tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Top Skills chart ───────────────────────────────────────────────── */

function TopSkillsChart({ skills }: { skills: SkillsResponse | null }) {
  if (!skills || skills.topSkills.length === 0) return <EmptyState />;

  const top10 = skills.topSkills.slice(0, 10);

  const data = {
    labels: top10.map((s) => s.name),
    datasets: [
      {
        label: "Usage",
        data: top10.map((s) => s.count),
        backgroundColor: [cyan, magenta, yellow, magenta, cyan, yellow, magenta, cyan, yellow, magenta],
        borderColor: "transparent",
        borderRadius: 0,
        borderWidth: 0,
      },
    ],
  };

  const options = {
    indexAxis: "y" as const,
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: bg,
        titleColor: cyan,
        bodyColor: chartColors.color,
        borderColor: cyan,
        borderWidth: 1,
      },
    },
    scales: {
      x: {
        grid: { color: chartColors.scale.grid.color },
        ticks: { color: chartColors.scale.ticks.color, callback: (val: string | number) => (Number(val) % 1 === 0 ? val : "") },
      },
      y: {
        grid: { display: false },
        ticks: { color: cyan, font: { family: "'Share Tech Mono', monospace", size: 11 } },
      },
    },
  };

  return (
    <div className="h-[320px]">
      <Bar data={data} options={options} />
    </div>
  );
}

/* ── Agents list ────────────────────────────────────────────────────── */

function AgentsList({ summary }: { summary: SummaryResponse | null }) {
  if (!summary || summary.topAgents.length === 0) return <EmptyState />;

  const agents = summary.topAgents.filter((a) => a.agent);

  return (
    <div className="space-y-2">
      {agents.map((a) => (
        <div
          key={a.agent}
          className="flex items-center justify-between border border-cyber-cyan/5 bg-cyber-cyan/[0.02] px-3 py-2"
        >
          <span className="text-cyber-cyan text-sm truncate">{a.agent}</span>
          <span className="text-cyber-cyan/40 text-xs tabular-nums ml-3 shrink-0">
            {a.sessions} session{a.sessions !== 1 ? "s" : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Tool 5-column table header ─────────────────────────────────────── */

function ToolTableHeader() {
  return (
    <div className="grid grid-cols-5 text-cyber-cyan/40 uppercase text-[10px] tracking-[0.12em] border-b border-cyber-cyan/10 pb-1.5 mb-1">
      <span>Tool</span>
      <span className="text-right">Calls</span>
      <span className="text-right">Avg Dur</span>
      <span className="text-right cursor-help" title="Estimated from step timing">~Tokens</span>
      <span className="text-right cursor-help" title="Estimated from step timing">~Cost</span>
    </div>
  );
}

/* ── Tool row (5 columns) ───────────────────────────────────────────── */

function ToolMetricsRow_({
  row,
  maxCost,
}: {
  row: ToolMetricsRow;
  maxCost: number;
}) {
  const cost = row.total_cost ?? 0;
  const pct = maxCost > 0 ? (cost / maxCost) * 100 : 0;
  const isTask = row.tool === "task";

  return (
    <div className="grid grid-cols-5 items-center py-1 border-b border-cyber-cyan/5 text-xs">
      <span className="text-cyber-cyan font-mono truncate pr-2">{row.tool}</span>
      <span className="text-right tabular-nums text-cyber-cyan/70">{fmtNum(row.calls)}</span>
      <span className="text-right tabular-nums text-cyber-cyan/60">
        {row.avg_duration_ms != null ? fmtDur(row.avg_duration_ms) : "\u2014"}
      </span>
      <span className="text-right tabular-nums text-cyber-cyan/50" title="Estimated from step timing">
        {isTask ? "n/a" : row.total_tokens > 0 ? `~${fmtNum(row.total_tokens)}` : "0"}
      </span>
      <span className="text-right tabular-nums text-cyber-cyan/60 flex items-center justify-end gap-1.5">
        <span title="Estimated from step timing">~{fmtUSD(cost)}</span>
        <div className="w-12 h-1.5 bg-white/5 rounded-full overflow-hidden flex-shrink-0">
          <div
            className="h-full bg-cyber-magenta/40 rounded-full transition-all"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
      </span>
    </div>
  );
}

/* ── Collapsible MCP server group ────────────────────────────────────── */

function McpServerGroup({
  group,
  maxCost,
  defaultOpen = false,
}: {
  group: McpMetricsGroup;
  maxCost: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border border-cyber-purple/10 bg-cyber-purple/[0.02] rounded">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-cyber-purple/[0.04] transition-colors cursor-pointer"
      >
        <span
          className="text-cyber-purple/60 text-[10px] transition-transform duration-200 inline-block"
          style={{ transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
        >
          ▶
        </span>
        <span className="text-cyber-purple/80 text-xs font-mono flex-1">
          {group.server}
        </span>
        <span className="text-cyber-purple/40 text-[10px] tabular-nums">
          {group.totalCalls} call{group.totalCalls !== 1 ? "s" : ""} — {fmtUSD(group.totalCost)}
        </span>
      </button>
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: open ? "2000px" : "0px" }}
      >
        <div className="px-3 pb-2 pt-1">
          <ToolTableHeader />
          {group.tools.map((t) => (
            <ToolMetricsRow_ key={t.tool} row={t} maxCost={maxCost} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Agent-Type Donut + Subagent section ────────────────────────────── */

const DONUT_TWO_COLORS = [cyan, magenta];

function AgentTypeSection({ data }: { data: SessionTypesResponse | null }) {
  if (!data) return <LoadingPlaceholder rows={3} />;
  if (data.main === 0 && data.subagent === 0) return <EmptyState />;

  const mainCount = data.main;
  const subagentCount = data.subagent;
  const avgSubagents = data.avgSubagentsPerMain;
  const subAgentRows = data.subagentShare;

  const donutData = {
    labels: ["Main", "Subagents"],
    datasets: [
      {
        data: [mainCount, subagentCount],
        backgroundColor: DONUT_TWO_COLORS,
        borderColor: bg,
        borderWidth: 2,
      },
    ],
  };

  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "60%",
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: {
          color: chartColors.color,
          font: { family: "'Share Tech Mono', monospace", size: 10 },
          padding: 12,
          usePointStyle: true,
        },
      },
      tooltip: {
        backgroundColor: bg,
        titleColor: cyan,
        bodyColor: chartColors.color,
        borderColor: cyan,
        borderWidth: 1,
      },
    },
  };

  return (
    <div className="space-y-4">
      {/* Donut + Cards row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Donut */}
        <div className="flex justify-center">
          <div className="h-[220px] w-[220px]">
            <Doughnut data={donutData} options={donutOptions} />
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 gap-3">
          <div className="border border-cyber-cyan/10 bg-cyber-cyan/[0.03] p-4">
            <div className="text-cyber-cyan/50 text-xs tracking-[0.1em] uppercase mb-1">
              Total Main Sessions
            </div>
            <div className="text-cyber-cyan text-2xl tabular-nums">{mainCount}</div>
          </div>
          <div className="border border-cyber-magenta/10 bg-cyber-magenta/[0.03] p-4">
            <div className="text-cyber-magenta/50 text-xs tracking-[0.1em] uppercase mb-1">
              Total Subagent Sessions
            </div>
            <div className="text-cyber-magenta text-2xl tabular-nums">{subagentCount}</div>
          </div>
          <div className="border border-cyber-purple/10 bg-cyber-purple/[0.03] p-4">
            <div className="text-cyber-purple/50 text-xs tracking-[0.1em] uppercase mb-1">
              Avg Subagents / Session
            </div>
            <div className="text-cyber-purple text-2xl tabular-nums">
              {avgSubagents.toFixed(1)}
            </div>
          </div>
        </div>
      </div>

      {/* Subagent Token Share table */}
      {subAgentRows.length > 0 && (
        <div>
          <h4 className="text-cyber-magenta/60 text-[10px] tracking-[0.12em] uppercase mb-3">
            Subagent Token Share
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
                  <th className="text-left py-2 pr-4 font-normal">Agent</th>
                  <th className="text-right py-2 pr-4 font-normal">Tokens</th>
                  <th className="text-right py-2 pr-4 font-normal">Cost</th>
                  <th className="text-right py-2 font-normal">% of Parent</th>
                </tr>
              </thead>
              <tbody>
                {subAgentRows.map((row) => (
                  <tr
                    key={row.agent}
                    className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/5 transition-colors"
                  >
                    <td className="py-2 pr-4 text-cyber-cyan truncate max-w-[200px]">
                      {row.agent}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">
                      {fmtNum(row.tokens)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {fmtUSD(row.cost)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-cyber-magenta">
                      {row.pctOfParent.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Tools section (stacked: builtin + MCP collapsible) ─────────────── */

function ToolsSection({
  metrics,
  loading,
  error,
}: {
  metrics: ToolMetricsRow[] | null;
  loading: boolean;
  error: string | null;
}) {
  // Hooks first, unconditionally. These sat after the early returns, so the
  // number of hooks changed with `loading` — React throws "rendered fewer
  // hooks than expected" the moment a load finishes.
  const classified = useMemo(() => classifyToolMetrics(metrics ?? []), [metrics]);
  const maxCost = useMemo(
    () => Math.max(0, ...(metrics ?? []).map((m) => m.total_cost ?? 0)),
    [metrics],
  );

  if (loading) return <LoadingPlaceholder rows={5} />;
  if (error) return <div className="text-cyber-danger text-xs">{error}</div>;
  if (!metrics || metrics.length === 0) return <EmptyState message="No tool data yet" />;

  return (
    <div className="space-y-4">
      {/* Built-in tools */}
      <div>
        <h3 className="text-cyber-cyan text-[10px] tracking-[0.08em] uppercase mb-2">Built-in</h3>
        {classified.builtin.length > 0 ? (
          <>
            <ToolTableHeader />
            {classified.builtin.map((t) => (
              <ToolMetricsRow_ key={t.tool} row={t} maxCost={maxCost} />
            ))}
          </>
        ) : (
          <EmptyState message="No harness tools" />
        )}
      </div>

      {/* MCP servers — collapsible groups */}
      <div>
        <h3 className="text-cyber-purple text-[10px] tracking-[0.08em] uppercase mb-2">MCPs</h3>
        {classified.mcp.length > 0 ? (
          <div className="space-y-2">
            {classified.mcp.map((group) => (
              <McpServerGroup
                key={group.server}
                group={group}
                maxCost={maxCost}
                defaultOpen={true}
              />
            ))}
          </div>
        ) : (
          <EmptyState message="No MCP tools" />
        )}
      </div>
    </div>
  );
}

/* ── Main OverviewTab ────────────────────────────────────────────────── */

export default function OverviewTab() {
  const { data: summary, loading: summaryLoading, error: summaryError } = useSummary();
  const { data: skills, loading: skillsLoading, error: skillsError } = useSkills();
  const { data: toolMetrics, loading: tmLoading, error: tmError } = useToolMetrics();
  const { data: sessionTypes, loading: stLoading, error: stError } = useSessionTypes();

  const anyLoading = summaryLoading || skillsLoading;
  const errors = [summaryError, skillsError, tmError].filter(Boolean);

  return (
    <div className="space-y-6">
      {/* Error Banner */}
      {errors.length > 0 && (
        <div className="text-cyber-danger text-sm p-4 border border-cyber-danger/30 rounded bg-cyber-danger/5">
          {errors.join(" | ")}
        </div>
      )}

      {/* KPI Row */}
      {anyLoading && (!summary || !skills) ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="border border-cyber-cyan/20 bg-cyber-cyan/5 p-4 animate-pulse"
            >
              <div className="h-3 bg-cyber-cyan/10 rounded mb-3 w-1/2" />
              <div className="h-6 bg-cyber-cyan/10 rounded w-3/4" />
            </div>
          ))}
        </div>
      ) : (
        <KPIRow summary={summary} skills={skills} />
      )}

      {/* Top Models */}
      <Section title="Top Models">
        {summaryLoading ? <LoadingPlaceholder rows={4} /> : summaryError ? <span className="text-cyber-danger text-xs">{summaryError}</span> : <TopModels summary={summary} />}
      </Section>

      {/* Top Skills Chart */}
      <Section title="Top Skills">
        {skillsLoading ? <LoadingPlaceholder rows={4} /> : skillsError ? <span className="text-cyber-danger text-xs">{skillsError}</span> : <TopSkillsChart skills={skills} />}
      </Section>

      {/* Top Tools — stacked layout with collapsible MCP groups */}
      <Section title="Top Tools">
        <ToolsSection metrics={toolMetrics} loading={tmLoading} error={tmError} />
      </Section>

      {/* Agent-Type Donut + Subagent Share */}
      <Section title="Agent Types">
        {stLoading ? <LoadingPlaceholder rows={3} /> : stError ? <span className="text-cyber-danger text-xs">{stError}</span> : <AgentTypeSection data={sessionTypes} />}
      </Section>

      {/* Agents */}
      <Section title="Agents">
        {summaryLoading ? <LoadingPlaceholder rows={3} /> : summaryError ? <span className="text-cyber-danger text-xs">{summaryError}</span> : <AgentsList summary={summary} />}
      </Section>
    </div>
  );
}
