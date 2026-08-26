import type { Database } from "bun:sqlite";
import type { SessionRow, SubagentRow, SessionFilesResponse } from "@/data/domain/session";
import { findAll, findById, findByIds, findChildrenByParentId, findSessionTypes } from "@/data/repositories/session";
import { findBySession, findToolsBySession } from "@/data/repositories/event";
import { findFilesBySession } from "@/data/repositories/files";

export function listSessions(
  db: Database,
  params: {
    limit: number;
    offset: number;
    days: number | null;
    search: string | null;
    status: string | null;
    rootOnly: boolean;
    project: string | null;
    branch: string | null;
  }
): { rows: SessionRow[]; total: number } {
  return findAll(db, params.limit, params.offset, params.days, params.search, params.status, params.rootOnly, params.project, params.branch);
}

export function getSessionDetail(db: Database, id: string): (SessionRow & { subagents: SubagentRow[] }) | null {
  const session = findById(db, id);
  if (!session) return null;

  let subagents: SubagentRow[] = [];

  // 1) Try child_session_ids (stored as JSON array string like ["ses_abc","ses_def"])
  if (session.child_session_ids) {
    let childIds: string[] = [];
    try {
      const parsed = JSON.parse(session.child_session_ids);
      if (Array.isArray(parsed)) {
        childIds = parsed.filter((childId: unknown): childId is string => typeof childId === "string");
      }
    } catch {
      // Fallback: old comma-separated format
      childIds = session.child_session_ids
        .split(",")
        .map(s => s.trim())
        .filter(Boolean);
    }
    if (childIds.length > 0) {
      subagents = findByIds(db, childIds);
    }
  }

  // 2) Also query by parent_id and merge with dedup (catches subagents not tracked in child_session_ids)
  const byParentId = findChildrenByParentId(db, id) as SubagentRow[];
  const existingIds = new Set(subagents.map(s => s.id));
  for (const child of byParentId) {
    if (!existingIds.has(child.id)) {
      subagents.push(child);
    }
  }

  return { ...session, subagents };
}

export function getSessionTypes(db: Database, days: number | null, project: string | null = null, branch: string | null = null) {
  return findSessionTypes(db, days, project, branch);
}

export function getSessionEvents(db: Database, id: string) {
  return findBySession(db, id);
}

export function getSessionTools(db: Database, id: string) {
  return findToolsBySession(db, id);
}

export function getSessionFiles(db: Database, id: string): SessionFilesResponse {
  const groups: SessionFilesResponse = { read: [], created: [], modified: [], deleted: [] };
  for (const row of findFilesBySession(db, id)) {
    const group = groups[row.action as keyof SessionFilesResponse];
    if (!group) continue; // discard unknown actions
    group.push({
      path: row.path,
      count: row.count,
      tool: row.tool,
      lastTs: row.lastTs,
      additions: row.additions,
      deletions: row.deletions,
    });
  }
  return groups;
}
