import { Hono } from "hono";
import { getDb } from "@/data/db/connection";
import { parseLimit, parseOffset, parseDays } from "@/data/domain/validation";
import { listSessions, getSessionDetail, getSessionTypes, getSessionEvents, getSessionTools } from "@/api/services/sessions";

const app = new Hono();

app.get("/api/sessions", (c) => {
  const db = getDb();
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
  const db = getDb();
  const days = parseDays(c.req.query("days"));
  const project = c.req.query("project") || null;
  const branch = c.req.query("branch") || null;
  const data = getSessionTypes(db, days, project, branch);
  return c.json(data);
});

app.get("/api/sessions/:id", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const session = getSessionDetail(db, id);
  if (!session) return c.json({ error: "not_found" }, 404);

  return c.json(session);
});

app.get("/api/sessions/:id/events", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const events = getSessionEvents(db, id);
  return c.json(events);
});

app.get("/api/sessions/:id/tools", (c) => {
  const db = getDb();
  const id = c.req.param("id");
  const tools = getSessionTools(db, id);
  return c.json(tools);
});

export default app;
