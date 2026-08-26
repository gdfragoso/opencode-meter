import { Hono } from "hono";
import { getDb } from "@/data/db/connection";
import { parseDays } from "@/data/domain/validation";
import { getSummary } from "@/api/services/metrics";

const app = new Hono();

app.get("/api/summary", (c) => {
  const db = getDb();
  const project = c.req.query("project") || null;
  const branch = c.req.query("branch") || null;
  const days = parseDays(c.req.query("days"));

  const summary = getSummary(db, days, project, branch);
  return c.json(summary);
});

export default app;
