# src/api — Hono HTTP API

**Hono + bun:sqlite (read-only) + WAL mode**

## OVERVIEW

REST API on port 9393, created by `app.ts` and served by the CLI (`--serve`) in a
process of its own. It is the **read side**: routes validate params, call a
service, return the payload. It never writes.

`src/api/` must not import `@/collector` or `@/ingest` at runtime — those run
inside OpenCode, this runs in the standalone server. Both sides meet at
`@/data` (repositories, schema, model types) and share nothing else.

## STRUCTURE

```
api/
├── app.ts             # createApp() — pure Hono factory: middleware, routes, static files
├── port-conflict.ts   # checkExistingServer(port) → boolean (not wired into --serve yet)
├── routes/
│   ├── health.ts      # GET /health
│   ├── sessions.ts    # GET /api/sessions?limit=&offset=&days=&search=&status=&project=&branch=
│   │                  # GET /api/sessions/:id/tree — delegation tree + per-branch totals
│   ├── summary.ts     # GET /api/summary
│   ├── daily.ts       # GET /api/daily?days=
│   ├── events.ts      # GET /api/events?session_id=
│   ├── skills.ts      # GET /api/skills
│   ├── tools.ts       # GET /api/tools/overview
│   ├── tool-metrics.ts # GET /api/tools, /api/tool-metrics
│   ├── errors.ts      # GET /api/errors
│   ├── models.ts      # GET /api/models
│   ├── projects.ts    # GET /api/projects + GET /api/projects/:directory
│   ├── files.ts       # GET /api/sessions/:id/files
│   ├── cost.ts        # GET /api/cost-efficiency?days=&project=&branch=
│   ├── comparison.ts  # GET /api/period-comparison?days=&project=&branch=
│   └── cache-timeline.ts # GET /api/models/cache-timeline?days=&project=&branch=
└── services/          # read-side query composition over @/data/repositories
    ├── metrics.ts     # getSummary — top models, agents, tokens
    ├── sessions.ts    # session list/detail
    ├── models.ts      # getModelStats
    ├── skills.ts      # skill usage aggregation
    ├── tools.ts       # tool overview + metrics
    ├── daily.ts       # daily rows (rollup table, or on the fly when filtered)
    ├── errors.ts      # error aggregation
    └── events.ts      # event queries
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Start here | `app.ts` | Route mount order, middleware, static serving |
| New endpoint | `routes/*.ts` | Export a default `Hono` router; mount it in `app.ts` |
| Query composition | `services/*.ts` | No SQL here — call `@/data/repositories` |
| SQL | `@/data/repositories/*.ts` | Shared with the write side; take `Database` as a param |
| Model types | `@/data/domain/*.ts` | Also imported by the dashboard |
| Param parsing | `@/data/domain/validation.ts` | `parseDays`, `parseLimit`, `parseOffset` |
| CLI server | `../cli.ts` | `--serve` starts the HTTP server, independent of OpenCode |

## CONVENTIONS

- **Port 9393** exported as `PORT` from `app.ts`; the CLI passes it to `Bun.serve`.
- **No CORS needed** — dashboard and API share the origin `127.0.0.1:9393`.
- **Routes mount at `/`**, not `/api`: `app.route("/", sessionsRoute)` → `/api/sessions`.
- **SPA fallback** — the two `app.get("*", serveStatic(...))` are not a duplicate:
  the first serves a real file from `dist/` by path, the second falls back to
  `index.html`. Both stay last, in that order.
- **Param validation**: `/api/events` requires `session_id` (400 otherwise);
  `/api/sessions?limit=` is clamped to [1, 200].
- **Logging**: this process has no OpenCode client, so `console.error` is correct
  here. In-OpenCode logging goes through `@/shared/logging` (`client.app.log`).
- **Read-only**: no route writes to the database. Writes live in `@/ingest`.
