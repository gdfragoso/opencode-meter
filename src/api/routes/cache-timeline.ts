import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getDb } from "@/data/db/connection";
import { parseDays } from "@/data/domain/validation";
import { getCacheTimeline } from "@/api/services/cache-timeline";

export function createCacheTimelineRoute(getDbFn?: () => Database): Hono {
  // Resolved per request, not in a default parameter — see createFilesRoute.
  const getDbFor = () => (getDbFn ?? getDb)();

  const app = new Hono();

  app.get("/api/models/cache-timeline", (c) => {
    const days = parseDays(c.req.query("days"));
    const project = c.req.query("project") || null;
    const branch = c.req.query("branch") || null;
    return c.json(getCacheTimeline(getDbFor(), days, project, branch));
  });

  return app;
}

export default createCacheTimelineRoute();
