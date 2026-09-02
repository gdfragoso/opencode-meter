import type { Database } from "bun:sqlite";
import type { SessionRow, SubagentRow, SessionFilesResponse, SessionTreeNode, SessionTreeResponse, SessionTreeRow, SessionContextResponse, SessionContextTurn } from "@/data/domain/session";
import {
  findAll,
  findById,
  findByIds,
  findChildrenByParentId,
  findRootAncestorId,
  findSessionTreeRows,
  findSessionTypes,
  SESSION_TREE_MAX_DEPTH,
} from "@/data/repositories/session";
import { findBySession, findTaskRoutingLabel, findToolsBySession } from "@/data/repositories/event";
import { findFilesBySession } from "@/data/repositories/files";
import { findContextTurns, findCompactionEventIds } from "@/data/repositories/event";
import { cacheHitRate } from "@/api/services/cache-timeline";

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

/**
 * The ids in a `child_session_ids` column. Stored as a JSON array; databases
 * written before that format hold a comma-separated string, so both are read.
 */
export function parseChildSessionIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((childId: unknown): childId is string => typeof childId === "string" && childId.length > 0);
    }
  } catch {
    // Fall through to the legacy format.
  }
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

export function getSessionDetail(db: Database, id: string): (SessionRow & { subagents: SubagentRow[] }) | null {
  const session = findById(db, id);
  if (!session) return null;

  let subagents: SubagentRow[] = [];

  // 1) Try child_session_ids (stored as JSON array string like ["ses_abc","ses_def"])
  const childIds = parseChildSessionIds(session.child_session_ids);
  if (childIds.length > 0) {
    subagents = findByIds(db, childIds);
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

/**
 * The delegation tree rooted at `id`: who called whom, and what each branch
 * cost once its own descendants are counted in.
 *
 * The flat list from the repository is turned into a tree here rather than in
 * SQL because a session can be reached by two links (`parent_id` and the
 * parent's `child_session_ids`) and a node needs exactly one place in the tree.
 * `parent_id` wins when it points at a session inside the tree, since that is
 * what OpenCode itself reported; `child_session_ids` fills in the rest.
 */
export function getSessionTree(
  db: Database,
  id: string,
  maxDepth: number = SESSION_TREE_MAX_DEPTH
): SessionTreeResponse {
  // One level deeper than we keep, so `truncated` is an observation rather than
  // a guess: anything past the cap is proof the tree continues.
  const rows = findSessionTreeRows(db, id, maxDepth + 1);
  if (rows.length === 0) return { root: null, ancestorId: null, truncated: false };

  const truncated = rows.some(r => r.depth > maxDepth);
  const kept = rows.filter(r => r.depth <= maxDepth);
  const byId = new Map<string, SessionTreeRow>(kept.map(r => [r.id, r]));

  const parentOf = new Map<string, string>();
  const link = (childId: string, parentId: string) => {
    // The requested session is the root; nothing inside the tree adopts it.
    if (childId === id || childId === parentId || parentOf.has(childId)) return;
    if (!byId.has(childId)) return;
    parentOf.set(childId, parentId);
  };
  for (const row of kept) {
    if (row.parent_id) link(row.id, row.parent_id);
  }
  for (const row of kept) {
    for (const childId of parseChildSessionIds(row.child_session_ids)) link(childId, row.id);
  }

  const childrenOf = new Map<string, string[]>();
  for (const [childId, parentId] of parentOf) {
    const list = childrenOf.get(parentId);
    if (list) list.push(childId);
    else childrenOf.set(parentId, [childId]);
  }

  const visited = new Set<string>();

  const build = (nodeId: string, parentId: string | null): SessionTreeNode | null => {
    // Giving every node exactly one parent already makes a cycle unreachable
    // from the root: the nodes in it point at each other and nothing points in.
    // This keeps that true if the parent assignment above ever loosens, which is
    // the difference between a wrong tree and a request that never returns.
    if (visited.has(nodeId)) return null;
    const row = byId.get(nodeId);
    if (!row) return null;
    visited.add(nodeId);

    const children = (childrenOf.get(nodeId) ?? [])
      .map(childId => build(childId, nodeId))
      .filter((child): child is SessionTreeNode => child !== null)
      .sort((a, b) => (a.started_at ?? 0) - (b.started_at ?? 0));

    const tokens = (row.input_tokens ?? 0) + (row.output_tokens ?? 0);
    const subtree: SessionTreeNode["subtree"] = {
      sessions: 1,
      tokens,
      cost: row.total_cost ?? 0,
      tools: row.tools_total ?? 0,
      durationMs: row.duration_ms ?? 0,
    };
    for (const child of children) {
      subtree.sessions += child.subtree.sessions;
      subtree.tokens += child.subtree.tokens;
      subtree.cost += child.subtree.cost;
      subtree.tools += child.subtree.tools;
      subtree.durationMs += child.subtree.durationMs;
    }

    return {
      id: row.id,
      title: row.title,
      agent: row.agent,
      model_id: row.model_id,
      status: row.status,
      session_type: row.session_type,
      started_at: row.started_at,
      duration_ms: row.duration_ms,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      total_cost: row.total_cost,
      tools_total: row.tools_total,
      depth: row.depth,
      routingLabel:
        parentId !== null && row.started_at !== null
          ? findTaskRoutingLabel(db, parentId, row.started_at)
          : null,
      subtree,
      children,
    };
  };

  return { root: build(id, null), ancestorId: findRootAncestorId(db, id), truncated };
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

/**
 * Context size per assistant turn, with the position of each compaction.
 *
 * `input` and `cacheRead` are disjoint halves of the same prompt, so the
 * context is their sum. The hit rate reuses `cacheHitRate` rather than
 * repeating the formula: one definition of "cached share" for the whole app.
 */
export function getSessionContext(db: Database, id: string): SessionContextResponse {
  const turns: SessionContextTurn[] = findContextTurns(db, id).map((r) => {
    const input = r.input ?? 0;
    const cacheRead = r.cache_read ?? 0;
    // A prompt of zero tokens does not exist: the model always sees something.
    // So a turn adding up to nothing was not measured, and reporting it as 0
    // draws a plunge to the axis where the context never moved.
    //
    // Both spellings of "not measured" land here. Some messages omit the token
    // object entirely; others carry an explicit all-zero one — and those also
    // drop the `total` field every real turn has:
    //   {"tokens":{"input":0,"output":0,"cache":{"read":0,"write":0}},"cost":0}
    // Keying on the sum covers both without guessing which shape arrives.
    if (input + cacheRead === 0) {
      return { id: r.id, input: null, cacheRead: null, context: null, cacheRate: null };
    }
    return {
      id: r.id,
      input,
      cacheRead,
      context: input + cacheRead,
      cacheRate: cacheHitRate(cacheRead, input),
    };
  });

  // A compaction sits before the first turn recorded after it. One that
  // happened after the last turn has nothing to mark, and is dropped rather
  // than pinned to the end where it would read as a drop that never happened.
  const compactedBefore = [
    ...new Set(
      findCompactionEventIds(db, id)
        .map((eventId) => turns.findIndex((t) => t.id > eventId))
        .filter((index) => index !== -1)
    ),
  ].sort((a, b) => a - b);

  return {
    turns,
    compactedBefore,
    peakContext: turns.reduce((max, t) => Math.max(max, t.context ?? 0), 0),
  };
}
