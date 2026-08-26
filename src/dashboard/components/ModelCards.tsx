import { fmtNum, fmtUSD, fmtDur } from "@/dashboard/lib/format";
import type { SummaryResponse } from "@/data/domain/metrics";

type ModelInfo = SummaryResponse["topModels"][number];

interface ModelCardsProps {
  models: ModelInfo[];
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-cyber-cyan/40 text-[10px] tracking-[0.1em] uppercase">
        {label}
      </div>
      <div className="text-cyber-cyan/90 text-sm tabular-nums mt-0.5 truncate">
        {value}
      </div>
    </div>
  );
}

export default function ModelCards({ models }: ModelCardsProps) {
  if (models.length === 0) {
    return (
      <p className="text-cyber-cyan/30 text-sm tracking-[0.1em] uppercase">
        No model data available
      </p>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {models.map((m) => (
        <div
          key={`${m.provider_id}/${m.model_id}`}
          className="border border-cyber-cyan/15 bg-cyber-cyan/[0.03] p-4 backdrop-blur-sm hover:border-cyber-cyan/30 transition-colors"
        >
          {/* Header */}
          <div className="mb-3 pb-2 border-b border-cyber-cyan/10">
            <div className="text-cyber-cyan text-sm truncate" title={m.model_id}>
              {m.model_id}
            </div>
            <div className="text-cyber-cyan/40 text-[10px] tracking-[0.12em] uppercase mt-0.5">
              {m.provider_id}
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Stat label="Sessions" value={fmtNum(m.sessions)} />
            <Stat label="Tokens" value={fmtNum(m.tokens)} />
            <Stat label="Cost" value={fmtUSD(m.cost)} />
            <Stat label="TTFT" value={fmtDur(m.ttft_avg)} />
            <Stat
              label="Cache Hit"
              value={
                m.cache_hit_rate != null
                  ? `${(m.cache_hit_rate * 100).toFixed(1)}%`
                  : "\u2014"
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}
