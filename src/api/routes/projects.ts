import { Hono, type Context } from "hono";
import type { Database } from "bun:sqlite";
import { getDb } from "@/data/db/connection";
import { parseDays } from "@/data/domain/validation";
import { findProjects, findProjectDetail } from "@/data/repositories/projects";

export function createProjectsRoute(getDbFn: () => Database = getDb) {
  const app = new Hono();

  app.get("/api/projects", (c: Context) => {
    const db = getDbFn();
    const days = parseDays(c.req.query("days"));
    const project = c.req.query("project");

    if (project) {
      const detail = findProjectDetail(db, days, project);
      const projects = findProjects(db, days);
      return c.json({ projects, detail });
    }

    return c.json(findProjects(db, days));
  });

  app.get("/api/projects/:directory", (c: Context) => {
    const db = getDbFn();
    const days = parseDays(c.req.query("days"));
    const directory = decodeURIComponent(c.req.param("directory") ?? "");
    const detail = findProjectDetail(db, days, directory);
    return c.json(detail);
  });

  return app;
}

export default createProjectsRoute();