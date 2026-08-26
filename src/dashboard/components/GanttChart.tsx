import { useMemo } from "react";
import { fmtDur } from "@/dashboard/lib/format";
import type { EventRow } from "@/data/domain/event";

/* ── types ──────────────────────────────────────────────────────────── */

interface ToolBar {
  name: string;
  callID: string;
  startTs: number;
  endTs: number;
  durationMs: number;
}

interface GanttChartProps {
  events: EventRow[] | null;
}

/* ── helpers ────────────────────────────────────────────────────────── */

function parseEventData(data: string): Record<string, unknown> {
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

function pairToolEvents(events: EventRow[]): ToolBar[] {
  const beforeMap = new Map<string, { ts: number; name: string }>();

  for (const e of events) {
    if (e.type !== "tool.before" && e.type !== "tool.after") continue;
    const d = parseEventData(e.data);
    const callID = d.callID as string | undefined;
    if (!callID) continue;

    if (e.type === "tool.before") {
      beforeMap.set(callID, {
        ts: e.ts,
        name: (d.tool as string) ?? "unknown",
      });
    }
  }

  const bars: ToolBar[] = [];
  const seen = new Set<string>();

  for (const e of events) {
    if (e.type !== "tool.after") continue;
    const d = parseEventData(e.data);
    const callID = d.callID as string | undefined;
    if (!callID || seen.has(callID)) continue;
    const before = beforeMap.get(callID);
    if (!before) continue;

    seen.add(callID);
    bars.push({
      name: before.name,
      callID,
      startTs: before.ts,
      endTs: e.ts,
      durationMs: e.ts - before.ts,
    });
  }

  return bars;
}

const CATEGORY_COLORS: Record<string, string> = {
  bash: "#ffff00",
  read: "#00ff88",
  edit: "#3388ff",
  task: "#ff8800",
  grep: "#a855f7",
  write: "#ff4488",
  glob: "#88ff00",
};

function getCategoryColor(toolName: string): string {
  for (const prefix of Object.keys(CATEGORY_COLORS)) {
    if (toolName.startsWith(prefix)) return CATEGORY_COLORS[prefix];
  }
  return "#666666";
}

interface StepBand {
  step: number;
  startTs: number;
  endTs: number;
}

function pairStepEvents(events: EventRow[]): StepBand[] {
  const starts: { step: number; ts: number }[] = [];
  const finishes: { step: number; ts: number }[] = [];

  for (const e of events) {
    if (e.type === "step.start") {
      const d = parseEventData(e.data);
      const step = d.step as number | undefined;
      if (step !== undefined) {
        starts.push({ step, ts: e.ts });
      }
    } else if (e.type === "step.finish") {
      const d = parseEventData(e.data);
      const step = d.step as number | undefined;
      if (step !== undefined) {
        finishes.push({ step, ts: e.ts });
      }
    }
  }

  const bands: StepBand[] = [];
  const finishIdx = new Map<number, number[]>();
  for (const f of finishes) {
    const arr = finishIdx.get(f.step) ?? [];
    arr.push(f.ts);
    finishIdx.set(f.step, arr);
  }

  for (const s of starts) {
    const pending = finishIdx.get(s.step);
    if (pending && pending.length > 0) {
      const endTs = pending.shift()!;
      bands.push({ step: s.step, startTs: s.ts, endTs });
    }
  }

  return bands;
}

/* ── component ──────────────────────────────────────────────────────── */

export default function GanttChart({ events }: GanttChartProps) {
  const bars = useMemo(() => {
    if (!events) return [];
    const paired = pairToolEvents(events);
    paired.sort((a, b) => a.startTs - b.startTs);
    return paired;
  }, [events]);

  const stepBands = useMemo(() => {
    if (!events) return [];
    return pairStepEvents(events);
  }, [events]);

  if (!events || bars.length === 0) {
    return (
      <p className="text-cyber-cyan/30 text-sm tracking-[0.1em] uppercase py-8 text-center">
        No tool events
      </p>
    );
  }

  const firstTs = bars[0].startTs;
  const lastTs = bars[bars.length - 1].endTs;
  const totalSpan = lastTs - firstTs || 1;

  // Generate tick marks for the time axis
  const tickCount = Math.min(8, bars.length);
  const ticks: { label: string; pct: number }[] = [];
  for (let i = 0; i <= tickCount; i++) {
    const pct = (i / tickCount) * 100;
    const ms = (pct / 100) * totalSpan;
    ticks.push({ label: fmtDur(ms), pct });
  }

  const labelWidth = 220;
  const barHeight = 16;
  const rowHeight = 28;
  const topAxisHeight = 28;
  const totalWidth = labelWidth + bars.length * 120;

  return (
    <div className="border border-cyber-cyan/10 bg-cyber-bg/50">
      {/* Color legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-b border-cyber-cyan/10">
        {Object.entries(CATEGORY_COLORS).map(([name, color]) => (
          <span key={name} className="text-[10px] tracking-[0.06em] flex items-center gap-1" style={{ color }}>
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
            {name}
          </span>
        ))}
      </div>

      {/* Header */}
      <div className="border-b border-cyber-cyan/10 px-4 py-2 flex items-center gap-2">
        <span className="text-cyber-cyan/70 text-xs tracking-[0.12em] uppercase">
          &#9656; Tools Timeline
        </span>
        <span className="text-cyber-cyan/30 text-[10px] tracking-[0.08em]">
          ({bars.length} tool{bars.length !== 1 ? "s" : ""})
        </span>
        {stepBands.length > 0 && (
          <span className="text-cyber-cyan/30 text-[10px] tracking-[0.06em] ml-auto">
            {stepBands.length} step{stepBands.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Gantt area with horizontal scroll */}
      <div className="overflow-x-auto" data-testid="gantt-scroll-area">
        <div style={{ minWidth: totalWidth }}>
          {/* Time axis */}
          <div
            className="relative border-b border-cyber-cyan/10"
            style={{ height: topAxisHeight, marginLeft: labelWidth }}
          >
            {ticks.map((t, i) => (
              <div
                key={i}
                className="absolute top-0 text-cyber-cyan/40 text-[9px] tracking-[0.06em]"
                style={{ left: `${t.pct}%`, transform: "translateX(-50%)" }}
              >
                {t.label}
              </div>
            ))}
            {stepBands.map((band, i) => {
              const stepColors = ["#00ffcc", "#a855f7", "#22ff77", "#ffff00"];
              const color = stepColors[i % stepColors.length];
              const leftPct = Math.max(0, ((band.startTs - firstTs) / totalSpan) * 100);
              const duration = fmtDur(band.endTs - band.startTs);
              const toolCount = bars.filter(
                (b) => b.startTs >= band.startTs && b.startTs < band.endTs,
              ).length;
              return (
                <div
                  key={`step-marker-${band.step}`}
                  className="absolute"
                  style={{
                    left: `${leftPct}%`,
                    bottom: 0,
                    transform: "translateX(-50%)",
                    color: color,
                    fontSize: "10px",
                    lineHeight: 1,
                    cursor: "default",
                    zIndex: 2,
                  }}
                  title={`Step ${band.step}: ${duration}, ${toolCount} tools`}
                  data-testid="gantt-step-marker"
                  data-step={band.step}
                >
                  ▼
                </div>
              );
            })}
          </div>

          {/* Bars container */}
          <div className="relative">
            {/* Tool bars */}
            {bars.map((bar) => {
              const leftPct = ((bar.startTs - firstTs) / totalSpan) * 100;
              const widthPct = Math.max(
                (bar.durationMs / totalSpan) * 100,
                0.5,
              );
              const categoryColor = getCategoryColor(bar.name);

              return (
                <div
                  key={bar.callID}
                  className="flex items-center border-b border-cyber-cyan/5 hover:bg-cyber-cyan/[0.03] transition-colors"
                  style={{ height: rowHeight, zIndex: 1 }}
                >
                  {/* Tool label */}
                    <div
                      className="shrink-0 text-right pr-3 text-cyber-cyan/60 text-[11px] tracking-[0.06em] truncate"
                      style={{
                        width: labelWidth,
                        position: "sticky",
                        left: 0,
                        zIndex: 3,
                        backgroundColor: "#0a0a0f",
                        borderRight: "1px solid rgba(0,255,204,0.1)",
                      }}
                    title={`${bar.name} — ${fmtDur(bar.durationMs)}`}
                  >
                    <span className="text-cyber-cyan/90">{bar.name}</span>
                    <span className="text-cyber-cyan/30 ml-2">
                      {fmtDur(bar.durationMs)}
                    </span>
                  </div>

                  {/* Bar area */}
                  <div className="relative flex-1" style={{ height: barHeight }}>
                    <div
                      className="absolute top-0 rounded-sm"
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height: "100%",
                        background: `${categoryColor}22`,
                        borderLeft: `1px solid ${categoryColor}88`,
                        borderRight: `1px solid ${categoryColor}88`,
                      }}
                      title={`${bar.name}: ${fmtDur(bar.durationMs)}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
