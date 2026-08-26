// OpenCode plugin entry point — resolved by "oc-plugin": ["server"] convention.
// Bun resolves .js → .ts at runtime; keep the .js extension for compatibility
// with tooling that expects compiled output.
import type { PluginModule, PluginInput } from "@opencode-ai/plugin";
import { createCollector } from "@/collector";
import { createSessionLifecycle } from "@/ingest/session-lifecycle";
import { getDb, registerCleanup } from "@/data/db/connection";
import { initSchema } from "@/data/db/migrations";
import { createAppLogger } from "@/shared/logging";

export default {
  id: "opencode-meter",
  server: async (input: PluginInput) => {
    const db = getDb();
    const logger = createAppLogger(input.client);
    initSchema(db, logger);

    // After createSessionLifecycle: it registers an exit hook that flushes the
    // pending daily rollups, and exit handlers run in registration order — so
    // the handler that closes the database has to come second.
    const lifecycle = createSessionLifecycle(db, logger);
    registerCleanup(db);
    const collector = createCollector(lifecycle, logger);

    return collector.hooks;
  },
} satisfies PluginModule;