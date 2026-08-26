import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getDb } from "@/data/db/connection";
import { parseDays } from "@/data/domain/validation";
import { getErrors } from "@/api/services/errors";

export function createErrorsRoute(getDbFn: () => Database = getDb) {
  const app = new Hono();

  app.get("/api/errors", (c) => {
    const db = getDbFn();
    const days = parseDays(c.req.query("days"));
    const project = c.req.query("project") || null;
    const branch = c.req.query("branch") || null;
    return c.json(getErrors(db, days, project, branch));
  });

  return app;
}

export default createErrorsRoute();
