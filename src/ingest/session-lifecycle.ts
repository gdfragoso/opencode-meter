import type { Database } from "bun:sqlite";
import type { CollectorOptions, SessionData } from "@/collector/session-state";
import { setParent, upsertRunning, upsert as upsertSession } from "@/data/repositories/session";
import { insert as insertEvent, deriveSessionCounters, deriveSessionDiff, findTaskRoutingLabel } from "@/data/repositories/event";
import { createRollupScheduler, type RollupSchedulerOptions } from "@/ingest/rollup-scheduler";
import { insertSessionFiles } from "@/data/repositories/files";
import { getGitBranch } from "@/ingest/git-branch";
import { createConsoleLogger, errString, type Logger } from "@/shared/logging";

export function createSessionLifecycle(
  db: Database,
  logger: Logger = createConsoleLogger(),
  rollupOptions: RollupSchedulerOptions = {}
): CollectorOptions {
  const rollups = createRollupScheduler(db, logger, rollupOptions);

  return {
    onSessionCreated: ({ sessionID, startedAt, title, directory, parentID }) => {
      try {
        const branch = getGitBranch(directory);
        setParent(db, { sessionID, startedAt, parentID: parentID ?? null, title, directory, branch });
      } catch (err) {
        logger.error("Failed to set session parent", { error: errString(err) });
      }
    },
    onSessionActive: ({ sessionID, title, agent, model, provider }) => {
      try {
        upsertRunning(db, { sessionID, startedAt: Date.now(), title, agent, model, provider });
      } catch (err) {
        logger.error("Failed to persist active session", { error: errString(err) });
      }
    },
    onSessionEnd: (sessionData: SessionData) => {
      try {
        // Counter columns are derived from the events table at write time so
        // duplicate session-end writes SET instead of accumulate (idempotent).
        const routing =
          sessionData.parentID && sessionData.agent
            ? findTaskRoutingLabel(db, sessionData.parentID, sessionData.startedAt)
            : null;
        const reconciled = {
          ...sessionData,
          ...deriveSessionCounters(db, sessionData.sessionID),
          ...deriveSessionDiff(db, sessionData.sessionID),
          ...(routing && routing !== sessionData.agent ? { agent: `${sessionData.agent} - ${routing}` } : {}),
        };
        upsertSession(db, reconciled);
        if (reconciled.fileActivity && reconciled.fileActivity.length > 0) {
          insertSessionFiles(db, reconciled.sessionID, reconciled.fileActivity);
        }
        const completionDate = new Date(reconciled.startedAt + (reconciled.durationMs ?? 0));
        rollups.schedule(completionDate.toISOString().slice(0, 10));
      } catch (err) {
        logger.error("Failed to persist session", { error: errString(err) });
      }
    },
    onEvent: (sessionID: string, type: string, data: Record<string, unknown>) => {
      if (!sessionID) return;
      try {
        insertEvent(db, sessionID, type, data);
      } catch (err) {
        logger.error("Failed to persist event", { error: errString(err) });
      }
    },
  };
}
