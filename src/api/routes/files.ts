import { Hono } from "hono";
import type { Database } from "bun:sqlite";
import { getDb } from "@/data/db/connection";
import { getSessionFiles } from "@/api/services/sessions";

export function createFilesRoute(getDbFn?: () => Database): Hono {
  // Resolved per request, not in a default parameter: `createFilesRoute()` runs
  // at import time, so a `getDb` captured there would keep pointing at the real
  // connection after a suite swapped the module with mock.module.
  const getDbFor = () => (getDbFn ?? getDb)();

  const app = new Hono();

  // No `if (!id) return 400` guard on purpose: Hono compiles `:id` to `[^/]+`,
  // so an empty segment never matches this route — an empty :id returns 404
  // from the router, never reaching the handler. A 400 guard here would be dead code.
  app.get("/api/sessions/:id/files", (c) => {
    const id = c.req.param("id");
    return c.json(getSessionFiles(getDbFor(), id));
  });

  return app;
}

export default createFilesRoute();
