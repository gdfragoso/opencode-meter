import { Hono } from "hono";
import { getDb } from "@/data/db/connection";
import { parseDays } from "@/data/domain/validation";
import { getToolsOverview } from "@/api/services/tools";

const app = new Hono();

app.get("/api/tools/overview", (c) => {
  const db = getDb();
  const days = parseDays(c.req.query("days"));

  const project = c.req.query("project") || null;
  const branch = c.req.query("branch") || null;

  return c.json(getToolsOverview(db, days, project, branch));
});

export default app;
