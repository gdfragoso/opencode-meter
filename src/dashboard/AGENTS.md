# src/dashboard — React SPA Metrics Dashboard

**React 19 + Vite 5 + Tailwind CSS 4 + Chart.js 4 + react-router-dom 7**

## OVERVIEW

Single-page React application displaying session metrics. Built with Vite, proxied to the Hono API (:9393). Components fetch from `/api/*` endpoints.

## STRUCTURE

```
dashboard/
├── main.tsx              # Vite entry: createRoot + StrictMode
├── App.tsx               # Router: BrowserRouter, tab-based navigation
├── hooks/
│   ├── useApi.ts            # Generic fetch wrapper with loading/error state
│   ├── useSessions.ts       # GET /api/sessions
│   ├── useSummary.ts        # GET /api/summary
│   ├── useDaily.ts          # GET /api/daily
│   ├── useEvents.ts         # GET /api/events
│   ├── useSkills.ts         # GET /api/skills
│   ├── useToolsOverview.ts  # GET /api/tools/overview
│   ├── useSessionTools.ts   # GET /api/tools/overview filtered by session
│   ├── useProjects.ts       # GET /api/projects with project/branch filters
│   ├── useAutoRefresh.ts    # Auto-refresh polling for API queries
│   ├── useModels.ts         # GET /api/models
│   ├── useSession.ts        # GET /api/sessions/:id
│   ├── useSessionFiles.ts   # GET /api/sessions/:id/files
│   ├── useSessionTypes.ts   # GET /api/sessions/types
│   └── useToolMetrics.ts    # GET /api/tool-metrics
├── components/
│   ├── Layout.tsx        # App shell: nav + content area
│   ├── OverviewTab.tsx   # KPI summary cards + model/agent breakdown
│   ├── SessionsTab.tsx   # Session list with search/filter
│   ├── SessionDetail.tsx # Single session: events, tokens, tools
│   ├── AnalyticsTab.tsx  # Charts: daily trends (Chart.js)
│   ├── CostTab.tsx       # Cost breakdown by model
│   ├── ModelsTab.tsx     # Per-model metrics
│   ├── KPICard.tsx       # Stat card component
│   ├── ModelCards.tsx    # Model comparison grid
│   ├── GanttChart.tsx    # Session timeline visualization
│   ├── ErrorBoundary.tsx # React error boundary with fallback UI
│   ├── ProjectsTab.tsx   # Portfolio list with donut chart and KPIs
│   ├── ProjectDetail.tsx # Branch breakdown, model distribution, KPIs per project
│   ├── ProjectSelector.tsx # Cascading project→branch header filter
│   ├── ErrorsTab.tsx      # Error session analysis dashboard
│   ├── RangeSelector.tsx  # Days-range filter for API queries
│   └── ui.tsx            # Shared UI primitives
├── lib/
│   ├── api.ts            # Fetch functions for /api/* endpoints
│   ├── chartSetup.ts     # Chart.js global registration (side-effect)
│   ├── colors.ts         # Chart color palette
│   ├── format.ts         # Number/date formatting helpers
│   └── tools.ts          # Tool name normalization (split prefix → display name)
└── styles/
    └── globals.css       # Tailwind v4 @import + @theme tokens
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Entry point | `main.tsx` | `createRoot(document.getElementById("root")!)` |
| Routing | `App.tsx` | Tab bar: Overview, Sessions, Analytics, Cost, Models, Projects, Errors |
| API calls | `lib/api.ts` + `hooks/use*.ts` | Each hook wraps fetch + loading/error state |
| Charts | `AnalyticsTab.tsx`, `GanttChart.tsx`, `chartSetup.ts` | Uses react-chartjs-2, Chart.js components |
| Tool stats | `lib/tools.ts` + `hooks/useToolsOverview.ts` | Normalizes tool names (strip `mcp__` prefix, split by `__`) |
| Styling | `styles/globals.css` | Tailwind v4 `@import "tailwindcss"` + `@theme` block |
| Errors | `components/ErrorsTab.tsx` | Error session breakdown |

| Range selector | `components/RangeSelector.tsx` | Days-range filter for API queries |
| Projects list | `ProjectsTab.tsx` | Portfolio table + donut chart |
| Project detail | `ProjectDetail.tsx` | Branch breakdown, model distribution, KPIs |
| Project selector | `ProjectSelector.tsx` | Cascading project→branch filter in header |
| useProjects | `hooks/useProjects.ts` | Fetches /api/projects data |

## CONVENTIONS

- **Data fetching**: hooks pattern (`useApi` base → `useSessions`, `useSummary`, etc.).
- **Error boundary**: `ErrorBoundary` wraps the entire app.
- **Chart setup**: `lib/chartSetup.ts` imported as side-effect in entry.
- **Theme**: cyber palette (bg `#0a0a0f`, cyan `#00ffcc`, magenta `#ff00ff`, danger `#ff4466`), mono font Share Tech Mono.
- **API base**: calls go to `/api/*` (proxied to `localhost:9393` in dev; same-origin in production via Hono static serve).
