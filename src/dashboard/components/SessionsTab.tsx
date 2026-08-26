import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSessions } from "@/dashboard/hooks/useSessions";
import { useRange } from "@/dashboard/App";
import { fetchJSON } from "@/dashboard/lib/api";
import { LoadingPlaceholder, EmptyState } from "@/dashboard/components/ui";
import { fmtNum, fmtUSD, fmtDur, fmtTime } from "@/dashboard/lib/format";
import type { SessionRow } from "@/data/domain/session";

/* ── constants ──────────────────────────────────────────────────────── */

const PAGE_SIZE = 20;

type StatusFilter = "all" | "ok" | "error" | "running";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  ok: "OK",
  error: "Error",
  running: "Running",
};

const CSV_COLUMNS: (keyof SessionRow)[] = [
  "title",
  "id",
  "directory",
  "branch",
  "parent_id",
  "agent",
  "model_id",
  "provider_id",
  "started_at",
  "ended_at",
  "duration_ms",
  "status",
  "error_type",
  "error_message",
  "input_tokens",
  "output_tokens",
  "reasoning_tokens",
  "cache_read_tokens",
  "cache_write_tokens",
  "total_cost",
  "tools_total",
  "subagents_total",
  "messages_total",
  "additions",
  "deletions",
];

/* ── helpers ────────────────────────────────────────────────────────── */

function csvValue(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function downloadCSV(rows: SessionRow[]) {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((col) => csvValue(row[col])).join(","),
  );
  // BOM for Excel UTF-8 compatibility
  const bom = "\uFEFF";
  const csv = bom + [header, ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function fetchAllSessions(
  days: number,
  search: string,
  status: StatusFilter,
  rootOnly: boolean,
): Promise<SessionRow[]> {
  const all: SessionRow[] = [];
  const limit = 200;
  let offset = 0;

  while (true) {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("offset", String(offset));
    if (days > 0) params.set("days", String(days));
    if (search.trim()) params.set("search", search.trim());
    if (status !== "all") params.set("status", status);
    if (rootOnly) params.set("parent", "null");

    const data = await fetchJSON<{ sessions: SessionRow[]; total: number }>(
      `/api/sessions?${params.toString()}`,
    );

    all.push(...data.sessions);
    if (all.length >= data.total || data.sessions.length === 0) break;
    offset += limit;
  }

  return all;
}

/* ── component ──────────────────────────────────────────────────────── */

export default function SessionsTab() {
  const navigate = useNavigate();
  const { days } = useRange();

  // Filter state
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [rootOnly, setRootOnly] = useState(true);

  // Pagination
  const [page, setPage] = useState(1);

  const offset = (page - 1) * PAGE_SIZE;

  const { sessions, total, loading, error } = useSessions({
    limit: PAGE_SIZE,
    offset,
    search,
    status: statusFilter,
    rootOnly,
  });

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);

  // The page can fall out of range when the result set shrinks under the
  // auto-refresh. Filters already reset to page 1 themselves, so this only
  // fires on data changing beneath us — an effect is the right escape hatch.
  useEffect(() => {
    if (page > totalPages) {
      // oxlint-disable-next-line react/set-state-in-effect
      setPage(totalPages);
    }
  }, [page, totalPages]);

  /* ── handlers ────────────────────────────────────────────────────── */

  const handleStatusClick = useCallback((f: StatusFilter) => {
    setStatusFilter(f);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(1);
    },
    [],
  );

  const handleRootToggle = useCallback(() => {
    setRootOnly((prev) => !prev);
    setPage(1);
  }, []);

  const handleCSVExport = useCallback(async () => {
    try {
      const rows = await fetchAllSessions(days, search, statusFilter, rootOnly);
      downloadCSV(rows);
    } catch (err) {
      console.error("[opencode-meter] CSV export failed", err);
    }
  }, [days, search, statusFilter, rootOnly]);

  const thClass =
    "text-left py-2 pr-4 font-normal select-none text-cyber-cyan/40";

  /* ── render ──────────────────────────────────────────────────────── */

  // Loading / error states
  if (loading) {
    return <LoadingPlaceholder rows={8} />;
  }

  if (error) {
    return (
      <div className="border border-cyber-danger/30 bg-cyber-danger/5 p-6 text-center">
        <p className="text-cyber-danger text-sm tracking-[0.1em] uppercase">
          Error loading sessions
        </p>
        <p className="text-cyber-danger/50 text-xs mt-2">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters bar */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Search — smaller */}
        <div className="flex-1 min-w-[200px]">
          <label className="block text-cyber-cyan/40 text-[10px] tracking-[0.1em] uppercase mb-1">
            Search
          </label>
          <input
            type="text"
            value={search}
            onChange={handleSearchChange}
            placeholder="title, agent, model..."
            className="w-full bg-cyber-bg border border-cyber-cyan/20 text-cyber-cyan/80 text-xs px-3 py-2 placeholder:text-cyber-cyan/20 focus:outline-none focus:border-cyber-cyan/50 transition-colors"
          />
        </div>

        {/* Root only toggle */}
        <button
          onClick={handleRootToggle}
          className={`text-[10px] tracking-[0.12em] uppercase px-3 py-2 border transition-all duration-200 cursor-pointer ${
            rootOnly
              ? "text-cyber-cyan border-cyber-cyan/50 bg-cyber-cyan/10"
              : "text-cyber-cyan/40 border-cyber-cyan/10 hover:text-cyber-cyan/70 hover:border-cyber-cyan/30"
          }`}
        >
          {rootOnly && <span className="mr-1.5">&#9656;</span>}
          Root only
        </button>

        {/* CSV Export */}
        <button
          onClick={handleCSVExport}
          title="Export CSV"
          className="text-cyber-cyan/50 hover:text-cyber-cyan text-sm border border-cyber-cyan/20 hover:border-cyber-cyan/50 px-3 py-2 transition-all duration-200 cursor-pointer"
        >
          ⬇
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex items-center gap-2">
        <span className="text-cyber-cyan/40 text-[10px] tracking-[0.1em] uppercase mr-2">
          Status:
        </span>
        {(Object.keys(STATUS_LABELS) as StatusFilter[]).map((f) => {
          const isActive = statusFilter === f;
          return (
            <button
              key={f}
              onClick={() => handleStatusClick(f)}
              className={`text-[10px] tracking-[0.12em] uppercase px-3 py-1.5 border transition-all duration-200 cursor-pointer ${
                isActive
                  ? f === "error"
                    ? "text-cyber-danger border-cyber-danger/50 bg-cyber-danger/10"
                    : "text-cyber-cyan border-cyber-cyan/50 bg-cyber-cyan/10"
                  : "text-cyber-cyan/40 border-cyber-cyan/10 hover:text-cyber-cyan/70 hover:border-cyber-cyan/30"
              }`}
            >
              {STATUS_LABELS[f]}
            </button>
          );
        })}
      </div>

      {/* Results count */}
      <div className="text-cyber-cyan/30 text-[10px] tracking-[0.08em]">
        {total} session{total !== 1 ? "s" : ""} found
      </div>

      {/* Table */}
      {sessions.length === 0 ? (
        <div className="border border-cyber-cyan/10 bg-cyber-bg/50 p-8 text-center">
          <EmptyState message="No sessions found" />
        </div>
      ) : (
        <div className="overflow-x-auto border border-cyber-cyan/10">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-cyber-cyan/40 uppercase tracking-[0.12em] border-b border-cyber-cyan/10">
                <th className={thClass + " pr-6"} role="columnheader">
                  Time
                </th>
                <th className={thClass} role="columnheader">
                  Name
                </th>
                <th className={thClass} role="columnheader">Project</th>
                <th className={thClass} role="columnheader">
                  Agent
                </th>
                <th className={thClass} role="columnheader">
                  Model
                </th>
                <th className={thClass + " text-right"} role="columnheader">
                  Duration
                </th>
                <th className={thClass + " text-right"} role="columnheader">
                  Tools
                </th>
                <th className={thClass + " text-right"} role="columnheader">
                  Cost
                </th>
                <th className={thClass + " text-right"} role="columnheader">
                  Tokens
                </th>
                <th className={thClass} role="columnheader">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const isChild = statusFilter === "all" && !!s.parent_id;
                const totalTokens =
                  (s.input_tokens ?? 0) + (s.output_tokens ?? 0);

                return (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => navigate(`/sessions/${s.id}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") navigate(`/sessions/${s.id}`);
                    }}
                    className="border-b border-cyber-cyan/5 hover:bg-cyber-cyan/5 transition-colors cursor-pointer"
                  >
                    <td className="py-2 pr-6 text-cyber-cyan/60 whitespace-nowrap tabular-nums">
                      {fmtTime(s.started_at)}
                    </td>
                    <td className="py-2 pr-4 text-cyber-cyan max-w-[200px] truncate">
                      {s.title || "\u2014"}
                    </td>
                    <td className="py-2 pr-4 text-cyber-cyan/50 max-w-[140px] truncate">
                      {s.directory ? [s.directory.split("/").pop() ?? s.directory, s.branch].filter(Boolean).join(":") : "\u2014"}
                    </td>
                    <td className="py-2 pr-4 text-cyber-cyan max-w-[180px] truncate">
                      {isChild && (
                        <span className="text-cyber-cyan/40 mr-1">
                          &#8618;
                        </span>
                      )}
                      {s.agent ?? "\u2014"}
                    </td>
                    <td className="py-2 pr-4 text-cyber-cyan/50 max-w-[160px] truncate">
                      {s.model_id ?? "\u2014"}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                      {fmtDur(s.wall_ms ?? s.duration_ms)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                      {fmtNum(s.tools_total)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan">
                      {fmtUSD(s.total_cost)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-cyber-cyan/60">
                      {fmtNum(totalTokens)}
                    </td>
                    <td className="py-2">
                      <span
                        className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.08em] uppercase ${
                          s.status === "error"
                            ? "text-cyber-danger"
                            : s.status === "running"
                              ? "text-cyber-cyan"
                              : "text-cyber-cyan/60"
                        }`}
                      >
                        {s.status === "running" && (
                          <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-cyan opacity-75" />
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyber-cyan" />
                          </span>
                        )}
                        {s.status === "error"
                          ? "ERROR"
                          : s.status === "running"
                            ? "RUNNING"
                            : s.status === "idle"
                              ? "IDLE"
                              : s.status?.toUpperCase() ?? "\u2014"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-cyber-cyan/30 text-[10px] tracking-[0.08em]">
            Page {safePage} of {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={safePage <= 1}
              className="text-cyber-cyan/50 hover:text-cyber-cyan disabled:text-cyber-cyan/15 disabled:cursor-not-allowed text-[10px] tracking-[0.12em] uppercase border border-cyber-cyan/20 disabled:border-cyber-cyan/10 hover:border-cyber-cyan/50 px-3 py-1.5 transition-all duration-200 cursor-pointer"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={safePage >= totalPages}
              className="text-cyber-cyan/50 hover:text-cyber-cyan disabled:text-cyber-cyan/15 disabled:cursor-not-allowed text-[10px] tracking-[0.12em] uppercase border border-cyber-cyan/20 disabled:border-cyber-cyan/10 hover:border-cyber-cyan/50 px-3 py-1.5 transition-all duration-200 cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
