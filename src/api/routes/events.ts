import { Hono } from "hono";
import { getDb } from "@/data/db/connection";
import { getEventsBySession } from "@/api/services/events";

const app = new Hono();

app.get("/api/events", (c) => {
  const db = getDb();
  const sessionID = c.req.query("session_id");

  if (!sessionID) {
    return c.json({ error: "session_id query param is required" }, 400);
  }

  const events = getEventsBySession(db, sessionID);

  return c.json(events);
});

export default app;
