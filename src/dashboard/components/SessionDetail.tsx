import { useMemo, useState, type ReactNode } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useSession } from "@/dashboard/hooks/useSession";
import { useEvents } from "@/dashboard/hooks/useEvents";
import { useSessionTools } from "@/dashboard/hooks/useSessionTools";
import { useSessionFiles } from "@/dashboard/hooks/useSessionFiles";
import { useSessionTree } from "@/dashboard/hooks/useSessionTree";
import GanttChart from "@/dashboard/components/GanttChart";
import DelegationTree from "@/dashboard/components/DelegationTree";
import {
  Section,
  LoadingPlaceholder,
  EmptyState,
} from "@/dashboard/components/ui";
import { fmtNum, fmtUSD, fmtDur, fmtTime } from "@/dashboard/lib/format";
import { classifyTools } from "@/dashboard/lib/tools";
import type { EventRow } from "@/data/domain/event";
import type { ToolCount, McpGroup } from "@/dashboard/lib/tools";

/* ── helpers ────────────────────────────────────────────────────────── */

interface SkillInfo {
  name: string;
  type: string;
}

function extractSkills(
  events: import("@/data/domain/event").EventRow[],
): SkillInfo[] {
  const seen = new Set<string>();
  const skills: SkillInfo[] = [];

  for (const e of events) {
    if (e.type !== "skills.loaded" && e.type !== "skills.called") continue;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(e.data);
    } catch {
      continue;
    }

    const pushSkill = (name: string) => {
      const key = `${e.type}:${name}`;
      if (seen.has(key)) return;
      seen.add(key);
      skills.push({
        name,
        type: e.type === "skills.loaded" ? "loaded" : "called",
      });
    };

    if (e.type === "skills.loaded") {
      const arr = data.skills;
      if (Array.isArray(arr)) {
        arr.forEach((s: unknown) => {
          if (typeof s === "string") pushSkill(s);
        });
      }
    } else {
      const name = typeof data.name === "string" ? data.name : null;
      if (name) pushSkill(name);
    }
  }

  return skills;
}

function tryParseJSON(s: string | null): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function computeToolDurations(
  events: EventRow[],
): Map<string, number> {
  const durations = new Map<string, number>();
  const beforeMap = new Map<string, { ts: number; name: string }>();

  // First pass: collect tool.before events
  for (const e of events) {
    if (e.type !== "tool.before") continue;
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(e.data); } catch { continue; }
    const callID = d.callID as string | undefined;
    const tool = d.tool as string | undefined;
    if (!callID || !tool) continue;
    beforeMap.set(callID, { ts: e.ts, name: tool });
  }

  // Second pass: match tool.after events
  const seen = new Set<string>();
  for (const e of events) {
    if (e.type !== "tool.after") continue;
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(e.data); } catch { continue; }
    const callID = d.callID as string | undefined;
    if (!callID || seen.has(callID)) continue;
    const before = beforeMap.get(callID);
    if (!before) continue;

    seen.add(callID);
    const dur = e.ts - before.ts;
    durations.set(before.name, (durations.get(before.name) ?? 0) + dur);
  }

  return durations;
}

/* ── sub-components ─────────────────────────────────────────────────── */

function DetailHeader({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="text-cyber-cyan/40 text-[11px] tracking-[0.1em] uppercase w-20 shrink-0">
        {label}
      </span>
      <span className="text-cyber-cyan text-sm">{children}</span>
    </div>
  );
}

function McpServerCollapsible({
  group,
  defaultOpen = true,
  toolDurations,
}: {
  group: McpGroup;
  defaultOpen?: boolean;
  toolDurations: Map<string, number>;
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
        <span className="text-cyber-purple/80 text-xs font-mono flex-1">{group.server}</span>
        <span className="text-cyber-purple/40 text-[10px] tabular-nums">
          {group.total} call{group.total !== 1 ? "s" : ""}
        </span>
      </button>
      <div
        className="overflow-hidden transition-[max-height] duration-300 ease-in-out"
        style={{ maxHeight: open ? "2000px" : "0px" }}
      >
        <div className="px-3 pb-2 pt-1 space-y-1">
          {group.tools.map((t) => {
            const totalDuration = toolDurations.get(t.name) ?? 0;
            const avgDur = t.count > 0 ? totalDuration / t.count : 0;
            const fullName = t.name.replace(group.server + "_", "").replace(group.server + "-", "");
            return (
              <div key={t.name} className="grid grid-cols-[1fr_50px_70px_55px_60px] gap-2 py-1 border-b border-white/5 items-center pl-3">
                <span className="text-cyber-cyan/70 text-xs font-mono truncate">{fullName}</span>
                <span className="text-cyber-cyan/40 text-[10px] tabular-nums text-right">{t.count}</span>
                <span className="text-cyber-cyan/40 text-[10px] tabular-nums text-right">{fmtDur(avgDur)}</span>
                <span className="text-cyber-cyan/30 text-[10px] tabular-nums text-right" title="Estimated from step timing">~{fmtNum(t.estimated_tokens)}</span>
                <span className="text-cyber-cyan/30 text-[10px] tabular-nums text-right" title="Estimated from step timing">~{fmtUSD(t.estimated_cost)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ToolsUsedContent({
  classified,
  events,
}: {
  classified: { builtin: ToolCount[]; mcp: McpGroup[] };
  events: EventRow[] | null;
}) {
  const toolDurations = useMemo(() => {
    if (!events) return new Map<string, number>();
    return computeToolDurations(events);
  }, [events]);

  return (
    <div className="space-y-4">
      {/* Built-in tools */}
      <div>
        <h3 className="text-cyber-cyan text-[10px] tracking-[0.08em] uppercase mb-2">Built-in</h3>
        {classified.builtin.length > 0 ? (
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_50px_70px_55px_60px] gap-2 py-1 text-cyber-cyan/30 text-[9px] uppercase tracking-[0.08em]">
              <span>Tool</span>
              <span className="text-right">Calls</span>
              <span className="text-right">Avg Dur</span>
              <span className="text-right cursor-help" title="Estimated from step timing">~Tokens</span>
              <span className="text-right cursor-help" title="Estimated from step timing">~Cost</span>
            </div>
            {classified.builtin.map((t) => {
              const totalDuration = toolDurations.get(t.name) ?? 0;
              const avgDur = t.count > 0 ? totalDuration / t.count : 0;
              return (
                <div key={t.name} className="grid grid-cols-[1fr_50px_70px_55px_60px] gap-2 py-1.5 border-b border-white/5 items-center">
                  <span className="text-cyber-cyan text-xs font-mono truncate">{t.name}</span>
                  <span className="text-cyber-cyan/60 text-[10px] tabular-nums text-right">{t.count}</span>
                  <span className="text-cyber-cyan/60 text-[10px] tabular-nums text-right">{fmtDur(avgDur)}</span>
                  <span className="text-cyber-cyan/40 text-[10px] tabular-nums text-right" title="Estimated from step timing">~{fmtNum(t.estimated_tokens)}</span>
                  <span className="text-cyber-cyan/40 text-[10px] tabular-nums text-right" title="Estimated from step timing">~{fmtUSD(t.estimated_cost)}</span>
                </div>
              );
            })}
          </div>
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
              <McpServerCollapsible key={group.server} group={group} defaultOpen toolDurations={toolDurations} />
            ))}
          </div>
        ) : (
          <EmptyState message="No MCP tools" />
        )}
      </div>
    </div>
  );
}

/* ── session errors ─────────────────────────────────────────────────── */

interface SessionError {
  id: number;
  type: string;
  name: string;
  message: string;
  ts: number;
}

function extractSessionErrors(events: EventRow[]): SessionError[] {
  const out: SessionError[] = [];
  for (const e of events) {
    if (e.type !== "message.error" && e.type !== "session.error") continue;
    const data = tryParseJSON(e.data);
    const err =
      data && typeof data.error === "object" && data.error !== null
        ? (data.error as Record<string, unknown>)
        : null;
    const name =
      typeof err?.name === "string" && err.name.length > 0 ? err.name : e.type;
    const message =
      typeof err?.message === "string" && err.message.length > 0
        ? err.message
        : "\u2014";
    out.push({ id: e.id, type: e.type, name, message, ts: e.ts });
  }
  return out;
}

function SessionErrorList({ events }: { events: EventRow[] }) {
  const errors = useMemo(() => extractSessionErrors(events), [events]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);

  const handleCopy = async (id: number, message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setCopiedId(id);
      setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
    } catch {
      // clipboard unavailable (e.g. non-secure context) — ignore
    }
  };

  return (
    <Section
      title="Session Errors"
      meta={errors.length > 0 ? `(${errors.length})` : undefined}
    >
      {errors.length === 0 ? (
        <EmptyState message="No session errors" />
      ) : (
        <div className="max-h-[500px] overflow-y-auto">
          {errors.map((err) => (
            <div key={err.id} className="border-b border-cyber-danger/10">
              <button
                type="button"
                onClick={() =>
                  setExpandedId((id) => (id === err.id ? null : err.id))
                }
                className="w-full text-left py-3 px-4 flex items-center justify-between hover:bg-cyber-danger/5 transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-4 overflow-hidden">
                  <span className="text-cyber-danger/70 text-xs uppercase tracking-wider min-w-[100px]">
                    {err.name}
                  </span>
                  <span className="text-cyber-danger/50 text-xs shrink-0">
                    {fmtTime(err.ts)}
                  </span>
                  <span className="text-cyber-danger/80 text-sm truncate">
                    {err.message}
                  </span>
                </div>
                <span
                  className={`text-cyber-danger/50 text-xs transition-transform shrink-0 ${
                    expandedId === err.id ? "rotate-90" : ""
                  }`}
                >
                  &#9656;
                </span>
              </button>
              <div
                className="overflow-y-auto transition-[max-height] duration-300 ease-in-out"
                style={{ maxHeight: expandedId === err.id ? "200px" : "0px" }}
              >
                <div className="px-4 pb-4 pt-1">
                  <div className="border border-cyber-danger/20 bg-cyber-danger/5 p-3">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-cyber-danger/70 text-xs tracking-[0.1em] uppercase">
                        Full Message
                      </p>
                      <button
                        type="button"
                        onClick={() => handleCopy(err.id, err.message)}
                        className="text-cyber-danger/60 hover:text-cyber-danger text-[10px] tracking-[0.08em] uppercase border border-cyber-danger/30 hover:border-cyber-danger/60 px-2 py-0.5 transition-colors cursor-pointer"
                      >
                        {copiedId === err.id ? "Copied \u2713" : "Copy"}
                      </button>
                    </div>
                    <pre className="text-cyber-danger/90 text-xs font-mono whitespace-pre-wrap break-words">
                      {err.message}
                    </pre>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

/* ── main component ─────────────────────────────────────────────────── */

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: session, loading: sessionLoading } = useSession(id);

  const { events, loading: eventsLoading } = useEvents(id ?? "");

  // Replaces the flat subagent list this page used to build from
  // session.subagents: the tree carries the same children plus their own
  // descendants, why each was called, and per-branch totals.
  const { data: tree, loading: treeLoading } = useSessionTree(id);

  // ── derived data (must be BEFORE early returns — hook count stability) ──

  // Skills from events
  const skills = useMemo(() => {
    if (!events) return [] as SkillInfo[];
    return extractSkills(events);
  }, [events]);

  const { data: tools, loading: toolsLoading } = useSessionTools(id ?? "");

  const { files, loading: filesLoading } = useSessionFiles(id ?? "");

  // Count of file-activity ENTRIES (not unique paths) across all 4 groups.
  const total = files
    ? (files.read ?? []).length +
      (files.created ?? []).length +
      (files.modified ?? []).length +
      (files.deleted ?? []).length
    : undefined;

  const classified = useMemo(() => classifyTools(tools ?? []), [tools]);

  // Parse every numeric cost category from cost_breakdown (input, output,
  // cache_read, cache_write, reasoning, etc.) — render all in a grid.
  const costEntries = useMemo<[string, number][]>(() => {
    const breakdown = tryParseJSON(session?.cost_breakdown ?? null);
    if (!breakdown) return [];
    return Object.entries(breakdown).filter(
      ([, v]) => typeof v === "number" && v > 0,
    ) as [string, number][];
  }, [session?.cost_breakdown]);

  // Fallback breakdown when cost_breakdown is empty (reconciled-from-events sessions).
  const tokenBreakdown = useMemo<[string, number][]>(() => {
    const entries: Array<[string, number]> = [
      ["Input", session?.input_tokens ?? 0],
      ["Output", session?.output_tokens ?? 0],
      ["Reasoning", session?.reasoning_tokens ?? 0],
      ["Cache Read", session?.cache_read_tokens ?? 0],
      ["Cache Write", session?.cache_write_tokens ?? 0],
    ];
    return entries.filter(([, v]) => v > 0);
  }, [
    session?.input_tokens,
    session?.output_tokens,
    session?.reasoning_tokens,
    session?.cache_read_tokens,
    session?.cache_write_tokens,
  ]);

  const formatCostLabel = (k: string) =>
    k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // ── not found / loading guards ────────────────────────────────────

  const hasParent = !!session?.parent_id;
  const backLabel = hasParent ? "Back to Parent" : "Back to Sessions";
  const handleBack = () => {
    if (hasParent && session?.parent_id) {
      navigate(`/sessions/${session.parent_id}`);
    } else {
      navigate("/sessions");
    }
  };

  if (sessionLoading) {
    return <LoadingPlaceholder rows={8} />;
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <button
          onClick={handleBack}
          className="text-cyber-cyan/60 hover:text-cyber-cyan text-xs tracking-[0.12em] uppercase border border-cyber-cyan/20 hover:border-cyber-cyan/50 px-3 py-1.5 transition-all duration-200 cursor-pointer"
        >
          &#8592; {backLabel}
        </button>
        <div className="border border-cyber-danger/30 bg-cyber-danger/5 p-8 text-center">
          <p className="text-cyber-danger text-sm tracking-[0.1em] uppercase">
            Session not found
          </p>
          <p className="text-cyber-danger/50 text-xs mt-2 font-mono">
            ID: {id}
          </p>
        </div>
      </div>
    );
  }

  const totalTokens =
    (session.input_tokens ?? 0) + (session.output_tokens ?? 0);

  return (
    <div className="space-y-4">
      {/* Back button + Title */}
      <div className="flex items-center gap-4 mb-2">
        <button
          onClick={handleBack}
          className="text-cyber-cyan/60 hover:text-cyber-cyan text-xs tracking-[0.12em] uppercase border border-cyber-cyan/20 hover:border-cyber-cyan/50 px-3 py-1.5 transition-all duration-200 cursor-pointer"
        >
          &#8592; {backLabel}
        </button>
        {session.title && (
          <h2 className="text-cyber-cyan text-sm truncate max-w-md">
            {session.title}
          </h2>
        )}
        <div className="flex-1" />
        <span className="text-cyber-cyan/30 text-[10px] tracking-[0.08em] uppercase font-mono">
          {session.id}
        </span>
      </div>

      {/* Summary */}
      <Section
        title="Summary"
        meta={
          session.status === "error"
            ? `(${session.status})`
            : session.agent
              ? `(${session.agent})`
              : undefined
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1">
          <DetailHeader label="Agent">
            {session.agent ?? "\u2014"}
          </DetailHeader>
          <DetailHeader label="Model">
            {session.model_id ?? "\u2014"}
            {session.provider_id && (
              <span className="text-cyber-cyan/30 ml-1 text-[10px]">
                ({session.provider_id})
              </span>
            )}
          </DetailHeader>
          <DetailHeader label="Tokens">
            <span className="tabular-nums">{fmtNum(totalTokens)}</span>
            <span className="text-cyber-cyan/30 ml-1 text-[10px]">
              ({fmtNum(session.input_tokens)} in / {fmtNum(session.output_tokens)} out)
            </span>
          </DetailHeader>
          <DetailHeader label="Cost">
            <span className="tabular-nums">{fmtUSD(session.total_cost)}</span>
          </DetailHeader>
          <DetailHeader label="Duration">
            <span className="tabular-nums">
              {fmtDur(session.wall_ms ?? session.duration_ms)}
            </span>
          </DetailHeader>
          <DetailHeader label="Status">
            <span
              className={`text-[11px] tracking-[0.1em] uppercase ${
                session.status === "error"
                  ? "text-cyber-danger"
                  : "text-cyber-cyan"
              }`}
            >
              {session.status ?? "\u2014"}
            </span>
          </DetailHeader>
          <DetailHeader label="Project">
            {session.directory ?? "\u2014"}
          </DetailHeader>
          <DetailHeader label="Branch">
            {session.branch ?? "\u2014"}
          </DetailHeader>
          {session.started_at && (
            <DetailHeader label="Started">
              {fmtTime(session.started_at)}
            </DetailHeader>
          )}
          {session.ended_at && (
            <DetailHeader label="Ended">
              {fmtTime(session.ended_at)}
            </DetailHeader>
          )}
          <DetailHeader label="Tools">
            {fmtNum(session.tools_total)}
          </DetailHeader>
          <DetailHeader label="Messages">
            {fmtNum(session.messages_total)}
          </DetailHeader>
        </div>
      </Section>

      {/* Cost Breakdown */}
      {costEntries.length > 0 ? (
        <Section title="Cost Breakdown">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            {costEntries.map(([key, value]) => (
              <DetailHeader key={key} label={formatCostLabel(key)}>
                <span className="tabular-nums">{fmtUSD(value)}</span>
              </DetailHeader>
            ))}
          </div>
        </Section>
      ) : tokenBreakdown.length > 0 ? (
        <Section title="Cost Breakdown (tokens)">
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            {tokenBreakdown.map(([label, value]) => (
              <DetailHeader key={label} label={label}>
                <span className="tabular-nums">{fmtNum(value)}</span>
              </DetailHeader>
            ))}
          </div>
        </Section>
      ) : (
        <Section title="Cost Breakdown">
          <EmptyState message="No cost data" />
        </Section>
      )}

      {/* Session Errors */}
      {eventsLoading ? (
        <Section title="Session Errors">
          <LoadingPlaceholder />
        </Section>
      ) : (
        <SessionErrorList events={events ?? []} />
      )}

      {/* Delegation tree — who called whom, and what each branch cost */}
      <DelegationTree
        tree={tree}
        loading={treeLoading}
        currentId={id}
      />

      {/* Skills */}
      <Section
        title="Skills"
        meta={skills.length > 0 ? `(${skills.length})` : undefined}
      >
        {eventsLoading ? (
          <LoadingPlaceholder />
        ) : skills.length === 0 ? (
          <EmptyState message="No skills used" />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {skills.map((sk, i) => (
              <div
                key={`${sk.type}:${sk.name}:${i}`}
                className="border border-cyber-cyan/10 bg-cyber-cyan/[0.03] px-3 py-2 flex items-center gap-2"
              >
                <span
                  className={`text-[9px] tracking-[0.08em] uppercase shrink-0 ${
                    sk.type === "loaded"
                      ? "text-cyber-magenta/70"
                      : "text-cyber-cyan/50"
                  }`}
                >
                  {sk.type}
                </span>
                <span className="text-cyber-cyan/80 text-xs truncate">
                  {sk.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

        {/* Tools Used */}
      <Section title="Tools Used" meta={tools && tools.length > 0 ? `(${tools.length} unique)` : undefined}>
        {toolsLoading ? <LoadingPlaceholder rows={5} /> : !tools?.length ? <EmptyState message="No tools used" /> : (
          <ToolsUsedContent classified={classified} events={events} />
        )}
      </Section>

      {/* Files */}
      <Section title="Files" meta={total !== undefined ? `(${total})` : undefined}>
        {filesLoading ? (
          <LoadingPlaceholder rows={5} />
        ) : !files ? (
          <EmptyState message="Sem dados de arquivos" />
        ) : (
          <div className="grid gap-4">
            <div>
              <h4 className="text-xs uppercase tracking-wider text-cyber-cyan mb-2">Lidos</h4>
              {(files.read ?? []).length === 0 ? (
                <EmptyState message="Nenhum arquivo lido" />
              ) : (
                <ul className="space-y-1">
                  {(files.read ?? []).map((f) => (
                    <li key={f.path} className="flex items-center gap-2 border border-cyber-cyan/10 bg-cyber-cyan/[0.03] px-2 py-1">
                      <span className="font-mono text-xs truncate flex-1">{f.path}</span>
                      <span className="border border-cyber-cyan/20 text-cyber-cyan/70 text-[10px] px-1.5 py-0.5 tabular-nums">{f.count}</span>
                      <span className="text-[9px] text-cyber-cyan/40">{f.tool}</span>
                      <span className="text-[9px] text-cyber-cyan/40">{fmtTime(f.lastTs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wider text-emerald-400 mb-2">Criados</h4>
              {(files.created ?? []).length === 0 ? (
                <EmptyState message="Nenhum arquivo criado" />
              ) : (
                <ul className="space-y-1">
                  {(files.created ?? []).map((f) => (
                    <li key={f.path} className="flex items-center gap-2 border border-cyber-cyan/10 bg-cyber-cyan/[0.03] px-2 py-1">
                      <span className="font-mono text-xs truncate flex-1">{f.path}</span>
                      <span className="border border-emerald-400/20 text-emerald-400/70 text-[10px] px-1.5 py-0.5 tabular-nums">{f.count}</span>
                      <span className="text-[9px] text-cyber-cyan/40">{f.tool}</span>
                      <span className="text-[9px] text-cyber-cyan/40">{fmtTime(f.lastTs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wider text-amber-400 mb-2">Modificados</h4>
              {(files.modified ?? []).length === 0 ? (
                <EmptyState message="Nenhum arquivo modificado" />
              ) : (
                <ul className="space-y-1">
                  {(files.modified ?? []).map((f) => (
                    <li key={f.path} className="flex items-center gap-2 border border-cyber-cyan/10 bg-cyber-cyan/[0.03] px-2 py-1">
                      <span className="font-mono text-xs truncate flex-1">{f.path}</span>
                      <span className="border border-amber-400/20 text-amber-400/70 text-[10px] px-1.5 py-0.5 tabular-nums">{f.count}</span>
                      <span className="text-[9px] text-cyber-cyan/40">{f.tool}</span>
                      <span className="text-[9px] text-cyber-cyan/40">{fmtTime(f.lastTs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h4 className="text-xs uppercase tracking-wider text-cyber-danger mb-2">Deletados</h4>
              {(files.deleted ?? []).length === 0 ? (
                <EmptyState message="Nenhum arquivo deletado" />
              ) : (
                <ul className="space-y-1">
                  {(files.deleted ?? []).map((f) => (
                    <li key={f.path} className="flex items-center gap-2 border border-cyber-cyan/10 bg-cyber-cyan/[0.03] px-2 py-1">
                      <span className="font-mono text-xs truncate flex-1">{f.path}</span>
                      <span className="border border-cyber-danger/20 text-cyber-danger/70 text-[10px] px-1.5 py-0.5 tabular-nums">{f.count}</span>
                      <span className="text-[9px] text-cyber-cyan/40">{f.tool}</span>
                      <span className="text-[9px] text-cyber-cyan/40">{fmtTime(f.lastTs)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Section>

      {/* Tools Timeline (Gantt) */}
      {eventsLoading ? (
        <Section title="Tools Timeline">
          <LoadingPlaceholder />
        </Section>
      ) : (
        <GanttChart events={events} />
      )}
    </div>
  );
}
