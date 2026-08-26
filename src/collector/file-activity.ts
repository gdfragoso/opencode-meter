import type { FileAction, FileActivityEntry } from "@/data/domain/file-activity";
export type { FileAction, FileActivityEntry };

/**
 * Pure, dependency-free classification of tool calls into per-session file
 * activity (read / created / modified / deleted).
 *
 * - Classified ONLY from tool-call shapes: `read`/`write`/`edit` carry a
 *   `filePath` arg; `apply_patch` reports touched files in
 *   `output.metadata.files` (patchText is NEVER parsed); `bash` is parsed
 *   conservatively for rm/rmdir/mv/touch with a single, unquoted, glob-free
 *   target.
 * - File existence is INJECTED via `ctx.existed` (this module never touches
 *   the filesystem); undefined existence is treated conservatively.
 * - The action enum is fixed at 4 values — a move is a delete (source) plus a
 *   create (destination).
 */

import { isAbsolute, resolve } from "node:path";



export interface ToolFileContext {
  tool: string;
  args?: Record<string, unknown>;
  output?: { metadata?: Record<string, unknown> };
  existed?: boolean;
}

/** Resolve relative paths against cwd; leave absolute paths untouched. */
export function normalizePath(p: string): string {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

// Glob characters that disqualify a bash target (conservative: never guess).
const GLOB_CHARS = /[*?[\]{}]/;

/**
 * Conservatively parse a bash command for single-target file mutations.
 * Only `rm`/`rmdir`/`mv`/`touch` are recognized, anchored at the start of a
 * line/command segment (split on `;`, `&&`, `|`). Returns only `{path, action}`;
 * the classifier stamps tool/ts.
 */
export function parseBashFileCommands(
  command: string
): Array<{ path: string; action: "created" | "deleted" }> {
  if (!command) return [];
  const results: Array<{ path: string; action: "created" | "deleted" }> = [];

  for (const raw of command.split(/[;&|]/)) {
    const segment = raw.trim();
    if (!segment) continue;

    const parsed = parseBashSegment(segment);
    if (!parsed) continue;
    // Ignore any target containing a glob char (never expand/guess).
    if (parsed.some((p) => GLOB_CHARS.test(p.path))) continue;

    results.push(...parsed);
  }

  return results;
}

/** Match one command segment. Targets must be a single unquoted token. */
function parseBashSegment(
  segment: string
): Array<{ path: string; action: "created" | "deleted" }> | null {
  // rm [flags] <target> — flags: any combination of -r/-f.
  let m = segment.match(/^rm(?:\s+-[fr]+)*\s+([^\s"']+)$/);
  if (m) return [{ path: m[1], action: "deleted" }];

  // rmdir <target>
  m = segment.match(/^rmdir\s+([^\s"']+)$/);
  if (m) return [{ path: m[1], action: "deleted" }];

  // mv [flags] <src> <dst> — move = deleted(src) + created(dst).
  m = segment.match(/^mv(?:\s+-[a-z]+)*\s+([^\s"']+)\s+([^\s"']+)$/);
  if (m) {
    return [
      { path: m[1], action: "deleted" },
      { path: m[2], action: "created" },
    ];
  }

  // touch <path>
  m = segment.match(/^touch\s+([^\s"']+)$/);
  if (m) return [{ path: m[1], action: "created" }];

  return null;
}

function stringArg(ctx: ToolFileContext, key: string): string | undefined {
  const value = ctx.args?.[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Classify a tool call into file-activity entries. Closed allowlist: only
 * read/write/edit/apply_patch/bash can produce entries.
 */
export function classifyFileActivity(ctx: ToolFileContext): FileActivityEntry[] {
  const ts = Date.now();

  switch (ctx.tool) {
    case "read": {
      const filePath = stringArg(ctx, "filePath");
      if (!filePath) return [];
      // Directory listings are not file reads.
      const display = ctx.output?.metadata?.display as { type?: string } | undefined;
      if (display?.type === "directory") return [];
      return [{ path: normalizePath(filePath), action: "read", tool: "read", ts }];
    }

    case "write": {
      const filePath = stringArg(ctx, "filePath");
      if (!filePath) return [];
      const action: FileAction = ctx.existed === false ? "created" : "modified";
      return [{ path: normalizePath(filePath), action, tool: "write", ts }];
    }

    case "edit": {
      const filePath = stringArg(ctx, "filePath");
      if (!filePath) return [];
      return [{ path: normalizePath(filePath), action: "modified", tool: "edit", ts }];
    }

    case "apply_patch": {
      const files = ctx.output?.metadata?.files;
      if (!Array.isArray(files)) return [];
      const entries: FileActivityEntry[] = [];
      for (const raw of files as Array<Record<string, unknown>>) {
        const filePath = typeof raw.filePath === "string" ? raw.filePath : "";
        if (!filePath) continue;
        const additions = typeof raw.additions === "number" ? raw.additions : undefined;
        const deletions = typeof raw.deletions === "number" ? raw.deletions : undefined;
        const base = { tool: "apply_patch", ts, additions, deletions };

        switch (raw.type) {
          case "add":
            entries.push({ ...base, path: normalizePath(filePath), action: "created" });
            break;
          case "update":
            entries.push({ ...base, path: normalizePath(filePath), action: "modified" });
            break;
          case "delete":
            entries.push({ ...base, path: normalizePath(filePath), action: "deleted" });
            break;
          case "move": {
            const movePath = typeof raw.movePath === "string" ? raw.movePath : "";
            entries.push({ ...base, path: normalizePath(filePath), action: "deleted" });
            if (movePath) {
              entries.push({ ...base, path: normalizePath(movePath), action: "created" });
            }
            break;
          }
        }
      }
      return entries;
    }

    case "bash": {
      const command = typeof ctx.args?.command === "string" ? ctx.args.command : "";
      return parseBashFileCommands(command).map((r) => ({
        path: normalizePath(r.path),
        action: r.action,
        tool: "bash",
        ts,
      }));
    }

    default:
      // Closed allowlist: grep/glob/task/skill/todowrite/webfetch/websearch/
      // lsp/question/plan and any unknown tool never produce file activity.
      return [];
  }
}
