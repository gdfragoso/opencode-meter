# opencode-meter — Session Metrics Plugin

**TypeScript + Bun + Hono + React 19 + SQLite**

## OVERVIEW

OpenCode plugin tracking session metrics (tokens, cost, tools, agents) into SQLite, with a Hono REST API and React/Vite dashboard.

## STRUCTURE

```
opencode-meter/
├── plugin.ts           # Plugin entry: getDb → initSchema → createSessionLifecycle → createCollector → hooks
├── src/
│   ├── collector/      # OpenCode hook wiring: hooks.ts, session-state.ts, file-activity.ts, task-link.ts
│   ├── ingest/         # Write side, runs inside OpenCode: session-lifecycle.ts, rollup-scheduler.ts
│   ├── data/           # Shared by both processes — no HTTP, no hooks
│   │   ├── db/         # connection.ts (bun:sqlite singleton), migrations.ts
│   │   ├── domain/     # model types + parse helpers (session, event, daily, metrics, errors, validation, projects, routing)
│   │   └── repositories/ # all SQL lives here (session, event, daily, projects, files, errors, session-aggregates)
│   ├── api/            # Read side, runs in `--serve`: app.ts, routes/, services/, port-conflict.ts
│   ├── dashboard/      # React SPA: components, hooks, lib, styles
│   ├── shared/         # Cross-cutting infra: logging.ts (Logger, createAppLogger, createConsoleLogger, errString)
│   └── cli.ts          # CLI entry: --json, --summary, --serve, --prune
├── docs/               # D2 architecture diagrams
├── dist/               # Vite build output
└── vite.config.ts      # Vite config: @/ alias, /api proxy → :9393
```

Top-level folders under `src/` answer **who runs this and when**:

| folder | process | when |
|--------|---------|------|
| `collector/`, `ingest/` | OpenCode | on every hook / turn |
| `data/` | both | whenever either side touches SQLite |
| `api/` | `opencode-meter --serve` | per request |
| `dashboard/` | browser | per render |

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Plugin entry | `plugin.ts` | Plugin entry: getDb → initSchema → createSessionLifecycle → createCollector → hooks — does NOT start HTTP server |
| Shared logging | `src/shared/logging.ts` | Logger interface + createAppLogger (opencode app.log) + createConsoleLogger (standalone) + errString |
| CLI entry | `src/cli.ts` | `--serve` starts dashboard (persistent, independent of OpenCode) |
| OpenCode hook handlers | `src/collector/hooks.ts` | chat.message, tool.execute, session.*, event |
| Cost tracking | `src/collector/hooks.ts` | costSource="opencode" — accumulated from message.updated events |
| File activity | `src/api/routes/files.ts` | GET /api/sessions/:id/files |
| Delegation tree | `src/data/repositories/session.ts` | findSessionTreeRows() — recursive walk down parent_id *and* child_session_ids |
| Cost per result | `src/api/services/cost.ts` | Denominators from session_files (action <> 'read'); ratios are null, never 0, when nothing was produced |
| Period comparison | `src/api/services/comparison.ts` | Half-open [from, to) windows so the boundary session is counted once; pct is null when the earlier window was empty; no range selected falls back to DEFAULT_COMPARISON_DAYS with `defaulted: true` |
| Per-tool cost | removed | Splitting a step's cost by how long each tool ran rewarded slow tools and ignored expensive ones. `step.finish` still records cost/tokens so a real attribution has history; nothing reads it. |
| Ghost series alignment | `src/dashboard/lib/windows.ts` | previousSeries() matches by date, not by position — both series skip quiet days, so index alignment invents trends |
| Delta rendering | `src/dashboard/lib/delta.ts` | One rule shared by the Analytics cards and the Overview KPIs; only `errors` is directional |
| Cache over time | `src/api/services/cache-timeline.ts` | Series aligned to a shared `dates` array; a null rate is "not used", never 0%; caps at 6 models and reports the count omitted |
| File activity classification | `src/collector/file-activity.ts` | Classifies tool calls into read/created/modified/deleted |
| Session state model | `src/collector/session-state.ts` | createSessionState(), SessionData interface |
| DB schema | `src/data/db/migrations.ts` | CREATE TABLE IF NOT EXISTS sessions/events/daily |
| API routes | `src/api/routes/*.ts` | Hono routers, mounted at `/` |
| Tools overview | `src/api/routes/tools.ts` | GET /api/tools/overview — aggregated tool/skill stats |
| Daily rollup | `src/data/repositories/daily.ts` | INSERT OR REPLACE INTO daily_rollups; event windows use a half-open epoch range, not `date(ts/1000)` |
| Daily rollup scheduling | `src/ingest/rollup-scheduler.ts` | createRollupScheduler(db) — coalesces a burst of session ends into one write per day, flushes on exit |
| Diff totals | `src/data/repositories/event.ts` | deriveSessionDiff(db, id) — last row per file from the session.diff events |
| Dashboard entry | `src/dashboard/main.tsx` | createRoot + StrictMode |
| API client | `src/dashboard/lib/api.ts` | fetch wrapper for /api/* endpoints |
| Tool names | `src/dashboard/lib/tools.ts` | Tool name normalization (strip prefix, map to display) |
| Projects API | `src/api/routes/projects.ts` | GET /api/projects + GET /api/projects/:directory |
| Projects repo | `src/data/repositories/projects.ts` | findProjects + findProjectDetail |
| Projects domain | `src/data/domain/projects.ts` | ProjectRow, ProjectDetail, ProjectBranchSummary |
| Projects tab | `src/dashboard/components/ProjectsTab.tsx` | Portfolio list with donut chart and KPIs |
| Project detail | `src/dashboard/components/ProjectDetail.tsx` | Branch breakdown, models, KPIs per project |
| Project selector | `src/dashboard/components/ProjectSelector.tsx` | Cascading project→branch header filter |
| useProjects hook | `src/dashboard/hooks/useProjects.ts` | Fetches project data with project/branch filters |
| Session lifecycle (writes) | `src/ingest/session-lifecycle.ts` | createSessionLifecycle(db) — collector callbacks → repository writes |

## CONVENTIONS

- **Path alias `@/*`** for all internal imports (tsconfig + vite).
- **DB injection**: repositories accept `Database` param (not hardcoded `getDb()`).
- **WAL mode** SQLite: `PRAGMA journal_mode=WAL`.
- **Error handling**: in-opencode logs go through `src/shared/logging.ts` via `client.app.log` with service `"opencode-meter"`; `console.error` stays only in standalone contexts (CLI `src/cli.ts`, HTTP server `src/api/app.ts`, browser dashboard) where no plugin client exists; onError returns `{ error: "internal_error" }` 500.
- **Limit clamping**: `/api/sessions?limit=` clamped [1, 200], default 50.
- **No prompt text on disk**: the collector never keeps what the user types, and `session.diff` is stripped of FileDiff's `before`/`after` before the event is written. Anything that would put message or file contents into the database is a bug, not a feature.
- **Token dedup**: `message.updated` deduped by `messageID` (assistant only, completed required).
- **Snapshot diffs**: `session.diff` carries the session's cumulative diff, re-sent on every edit. The collector keys it by path (`diffByFile`, last value wins) and the write derives the totals from the events (`deriveSessionDiff`) — same idempotency contract as `deriveSessionCounters`.
- **Rollups are debounced**: `session.idle` fires once per assistant turn, so `onSessionEnd` schedules the daily rollup instead of writing it inline. `createSessionLifecycle` registers the exit flush, so `registerCleanup(db)` must come after it in `plugin.ts`.
- **Dashboard**: React 19, ErrorBoundary, `useXxx` hooks, Chart.js via `lib/chartSetup.ts`, cyber palette (Share Tech Mono).
- **Routes mount at `/`** (not `/api`): `app.route("/", sessionsRoute)` → `/api/sessions`. Vite proxy targets `/api`.
- **SPA fallback**: `app.get("*", serveStatic)` must stay last in route mount order.
- **Project/branch filters**: `?project=` and `?branch=` query params filter sessions and metrics by project directory and branch.
- **Layering**: plugin → ingest → repo (writes), routes → service → repo (reads). `src/api/` has no runtime imports from `@/collector` or `@/ingest`, and neither side imports the other — they meet at `@/data`. Type-only imports of shared interfaces are OK.

## ANTI-PATTERNS

- **DO NOT hardcode DB path** — when testing, inject a temp-path `Database`.
- **DO NOT change port** without syncing `vite.config.ts` dev proxy.
- **All SQL lives in src/data/repositories/** — routes validate params → call a service → return the payload (the kitchen-sink src/api/types.ts no longer exists; model types live in src/data/domain/).
- **DO NOT sum `session.diff` counts** — the event is a snapshot, not a delta. Summing inflates additions/deletions on every re-emission.
- **DO NOT put heavy payloads in `events`** — `opencode-meter --prune --days N` is the only thing that shrinks it, and it is manual. `session.ended` carries a summary; user messages, steps, tool timings and file activity live in the `sessions` columns.
- **DO NOT filter events by `date(ts / 1000, 'unixepoch')`** — it is not sargable and forces a full scan. Use `ts >= ? AND ts < ?`.
- **DO NOT skip `message.updated` dedup** — token accumulation is gated to assistant + completed; non-assistant messages are intentionally excluded.
