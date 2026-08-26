import { Hono } from "hono";
import { getDb } from "@/data/db/connection";
import { parseDays } from "@/data/domain/validation";
import { getDailyRollups } from "@/api/services/daily";

const app = new Hono();

app.get("/api/daily", (c) => {
  const db = getDb();
  const days = parseDays(c.req.query("days")) ?? 30;

  const project = c.req.query("project") || null;
  const branch = c.req.query("branch") || null;
  const rows = getDailyRollups(db, days, project, branch);

  return c.json(rows);
});

export default app;
