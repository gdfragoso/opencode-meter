import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getDb } from "@/data/db/connection";
import { getSessionFiles } from "@/api/services/sessions";

export function createFilesRoute(getDbFn: () => Database = getDb): Hono {
  const app = new Hono();

  // No `if (!id) return 400` guard on purpose: Hono compiles `:id` to `[^/]+`,
  // so an empty segment never matches this route — an empty :id returns 404
  // from the router, never reaching the handler. A 400 guard here would be dead code.
  app.get("/api/sessions/:id/files", (c) => {
    const id = c.req.param("id");
    return c.json(getSessionFiles(getDbFn(), id));
  });

  return app;
}

export default createFilesRoute();
