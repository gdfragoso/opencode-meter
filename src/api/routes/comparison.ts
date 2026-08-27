import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getDb } from "@/data/db/connection";
import { parseDays } from "@/data/domain/validation";
import { getPeriodComparison } from "@/api/services/comparison";

export function createComparisonRoute(getDbFn?: () => Database): Hono {
  // Resolved per request, not in a default parameter — see createFilesRoute.
  const getDbFor = () => (getDbFn ?? getDb)();

  const app = new Hono();

  app.get("/api/period-comparison", (c) => {
    const days = parseDays(c.req.query("days"));
    const project = c.req.query("project") || null;
    const branch = c.req.query("branch") || null;
    return c.json(getPeriodComparison(getDbFor(), days, project, branch));
  });

  return app;
}

export default createComparisonRoute();
