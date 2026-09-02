import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getDb } from "@/data/db/connection";
import { parseLimit, parseOffset, parseDays } from "@/data/domain/validation";
import { listSessions, getSessionDetail, getSessionTree, getSessionTypes, getSessionEvents, getSessionTools, getSessionContext } from "@/api/services/sessions";

// Same shape as createFilesRoute: the database arrives as an argument so a test
// can pass an in-memory one instead of mocking the connection module, which
// replaces it for every suite in the run.
export function createSessionsRoute(getDbFn?: () => Database): Hono {
  // Resolved per request rather than in a default parameter. `export default
  // createSessionsRoute()` runs at import time, and a `getDb` captured then
  // would keep pointing at the real connection even after a suite swapped the
  // module with mock.module — which is exactly how days.test.ts drives it.
  const getDbFor = () => (getDbFn ?? getDb)();

  const app = new Hono();

  app.get("/api/sessions", (c) => {
    const db = getDbFor();
    const rawLimit = c.req.query("limit");
    const rawOffset = c.req.query("offset");
    const rawDays = c.req.query("days");
    const search = c.req.query("search") || null;
    const status = c.req.query("status") || null;
    const parent = c.req.query("parent") || null;
    const project = c.req.query("project") || null;
    const branch = c.req.query("branch") || null;

    const limit = parseLimit(rawLimit);
    const offset = parseOffset(rawOffset);
    const days = parseDays(rawDays);

    const rootOnly = parent === "null";

    const { rows, total } = listSessions(db, { limit, offset, days, search, status, rootOnly, project, branch });
    return c.json({ sessions: rows, total });
  });

  app.get("/api/sessions/types", (c) => {
    const db = getDbFor();
    const days = parseDays(c.req.query("days"));
    const project = c.req.query("project") || null;
    const branch = c.req.query("branch") || null;
    const data = getSessionTypes(db, days, project, branch);
    return c.json(data);
  });

  app.get("/api/sessions/:id", (c) => {
    const db = getDbFor();
    const id = c.req.param("id");
    const session = getSessionDetail(db, id);
    if (!session) return c.json({ error: "not_found" }, 404);

    return c.json(session);
  });

  app.get("/api/sessions/:id/tree", (c) => {
    const db = getDbFor();
    const id = c.req.param("id");
    const tree = getSessionTree(db, id);
    // A tree with no root means the session itself is not in the table — the
    // same condition GET /api/sessions/:id answers with a 404.
    if (!tree.root) return c.json({ error: "not_found" }, 404);
    return c.json(tree);
  });

  app.get("/api/sessions/:id/events", (c) => {
    const db = getDbFor();
    const id = c.req.param("id");
    const events = getSessionEvents(db, id);
    return c.json(events);
  });

  app.get("/api/sessions/:id/context", (c) => {
    const db = getDbFor();
    const id = c.req.param("id");
    // No 404 for an unknown session: an empty series is the honest answer, and
    // it is the same answer a real session with no recorded turns gives.
    return c.json(getSessionContext(db, id));
  });

  app.get("/api/sessions/:id/tools", (c) => {
    const db = getDbFor();
    const id = c.req.param("id");
    const tools = getSessionTools(db, id);
    return c.json(tools);
  });

  return app;
}

export default createSessionsRoute();
