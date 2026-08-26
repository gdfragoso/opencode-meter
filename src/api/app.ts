import { join } from "path";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import healthRoute from "./routes/health";
import sessionsRoute from "./routes/sessions";
import summaryRoute from "./routes/summary";
import dailyRoute from "./routes/daily";
import eventsRoute from "./routes/events";
import skillsRoute from "./routes/skills";
import toolsRoute from "./routes/tools";
import toolMetricsRoute from "./routes/tool-metrics";
import errorsRoute from "./routes/errors";
import modelsRoute from "./routes/models";
import projectsRoute from "./routes/projects";
import filesRoute from "./routes/files";

export const DEFAULT_PORT = 9393;

/** OPENCODE_METER_PORT, so the CLI and the Vite proxy can agree on one value. */
export function resolvePort(env: Record<string, string | undefined> = process.env): number {
  const raw = env.OPENCODE_METER_PORT;
  if (!raw) return DEFAULT_PORT;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : DEFAULT_PORT;
}

/** @deprecated Read the port with resolvePort() — kept so imports do not break. */
export const PORT = DEFAULT_PORT;

export function createApp(): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    console.error("[opencode-meter] route error:", err);
    return c.json({ error: "internal_error" }, 500);
  });

  app.use("*", async (c, next) => {
    await next();
    c.header("x-opencode-meter", "1");
  });

  app.route("/", healthRoute);
  app.route("/", sessionsRoute);
  app.route("/", summaryRoute);
  app.route("/", dailyRoute);
  app.route("/", eventsRoute);
  app.route("/", skillsRoute);
  app.route("/", toolsRoute);
  app.route("/", toolMetricsRoute);
  app.route("/", errorsRoute);
  app.route("/", modelsRoute);
  app.route("/", projectsRoute);
  app.route("/", filesRoute);

  const distDir = join(import.meta.dir, "..", "..", "dist");
  app.use("/assets/*", serveStatic({ root: distDir }));
  app.get("/", serveStatic({ path: "./index.html", root: distDir }));
  app.get("*", serveStatic({ root: distDir }));
  // serveStatic falls through via `await next()` when getContent returns null,
  // so unmatched paths reach the SPA fallback below.
  app.get("*", serveStatic({ path: "./index.html", root: distDir }));

  return app;
}
