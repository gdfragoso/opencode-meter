import { Hono, type Context } from "hono";
import type { Database } from "bun:sqlite";
import { getDb } from "@/data/db/connection";
import { getModelStats } from "@/api/services/models";
import { parseDays } from "@/data/domain/validation";

export function createModelsRoute(getDbFn: () => Database = getDb) {
  const app = new Hono();

  app.get("/api/models", (c: Context) => {
    const db = getDbFn();
    const days = parseDays(c.req.query("days"));
    const project = c.req.query("project") || null;
    const branch = c.req.query("branch") || null;

    const models = getModelStats(db, days, project, branch);
    return c.json({ models });
  });

  return app;
}

export default createModelsRoute();
