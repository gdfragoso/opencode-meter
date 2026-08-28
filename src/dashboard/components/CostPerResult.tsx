import { LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { fmtNum, fmtUSD } from "@/dashboard/lib/format";
import type { CostEfficiencyResponse } from "@/data/domain/metrics";

/**
 * `fmtUSD` already renders null as an em-dash, so a ratio with no denominator
 * needs no special case at the call site — but it does need a reason, or the
 * dash reads as missing data. This says which it is.
 */
function ratioTitle(value: number | null, denominatorName: string): string | undefined {
  return value === null ? `No ${denominatorName} in this window` : undefined;
}

function Kpi({
  label,
  value,
  sub,
  title,
}: {
  label: string;
  value: string;
  sub?: string;
  title?: string;
}) {
  return (
    <div className="border border-cyber-cyan/10 bg-cyber-cyan/[0.03] p-4 text-center" title={title}>
      <div className="text-cyber-cyan/50 text-xs tracking-[0.12em] uppercase mb-2">{label}</div>
      <div className="text-cyber-cyan text-xl tabular-nums">{value}</div>
      {sub && <div className="text-cyber-cyan/30 text-[10px] tracking-[0.08em] mt-1">{sub}</div>}
    </div>
  );
}

export function CostPerResultKpis({ data }: { data: CostEfficiencyResponse | null }) {
  if (!data) return <LoadingPlaceholder rows={2} />;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Kpi
        label="Per File Changed"
        value={fmtUSD(data.costPerFile)}
        sub={`${fmtNum(data.files)} files`}
        title={ratioTitle(data.costPerFile, "file change")}
      />
      <Kpi
        label="Per Edit"
        value={fmtUSD(data.costPerEdit)}
        sub={`${fmtNum(data.edits)} writes`}
        title={ratioTitle(data.costPerEdit, "edit")}
      />
      <Kpi
        label="Per Line"
        value={fmtUSD(data.costPerLine)}
        sub={`+${fmtNum(data.additions)} / -${fmtNum(data.deletions)}`}
        title={ratioTitle(data.costPerLine, "line change")}
      />
      <Kpi
        label="Per Session"
        value={fmtUSD(data.costPerSession)}
        sub={`${fmtNum(data.totalSessions)} sessions`}
        title={ratioTitle(data.costPerSession, "session")}
      />
    </div>
  );
}

export function CostPerAgentResultTable({ data }: { data: CostEfficiencyResponse | null }) {
  if (!data) return <LoadingPlaceholder rows={4} />;
  if (data.byAgent.length === 0) return <EmptyState />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
            <th className="text-left py-2 pr-4 font-normal">Agent</th>
            <th className="text-right py-2 pr-4 font-normal">Sessions</th>
            <th className="text-right py-2 pr-4 font-normal">Cost</th>
            <th className="text-right py-2 pr-4 font-normal">Files</th>
            <th className="text-right py-2 pr-4 font-normal">Lines</th>
            <th className="text-right py-2 font-normal">Per File</th>
          </tr>
        </thead>
        <tbody>
          {data.byAgent.map((a) => (
            <tr key={a.agent} className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/5 transition-colors">
              <td className="py-2 pr-4 text-cyber-cyan truncate max-w-[200px]">{a.agent}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">{a.sessions}</td>
              <td className="py-2 pr-4 text-right tabular-nums">{fmtUSD(a.cost)}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">{fmtNum(a.files)}</td>
              <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/70">{fmtNum(a.lines)}</td>
              <td
                className="py-2 text-right tabular-nums"
                title={ratioTitle(a.costPerFile, "file change")}
              >
                {fmtUSD(a.costPerFile)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
