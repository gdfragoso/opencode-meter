import { Hono } from "hono";
import { getDb } from "@/data/db/connection";
import { parseDays } from "@/data/domain/validation";
import { getSkills } from "@/api/services/skills";

const app = new Hono();

app.get("/api/skills", (c) => {
  const db = getDb();
  const days = parseDays(c.req.query("days"));

  const project = c.req.query("project") || null;
  const branch = c.req.query("branch") || null;

  const skills = getSkills(db, days, project, branch);
  return c.json(skills);
});

export default app;
