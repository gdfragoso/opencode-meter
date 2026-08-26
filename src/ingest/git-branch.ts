import { readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const MAX_WALK_DEPTH = 64;

// Resolved once per directory: finding the .git directory means walking up the
// tree, and that answer does not change while OpenCode is open. HEAD itself is
// re-read every time, so switching branches mid-session is still picked up.
const gitDirCache = new Map<string, string | null>();

function findGitDir(directory: string): string | null {
  let dir = resolve(directory);

  for (let depth = 0; depth < MAX_WALK_DEPTH; depth++) {
    const candidate = join(dir, ".git");
    try {
      const stats = statSync(candidate);
      if (stats.isDirectory()) return candidate;
      if (stats.isFile()) {
        // Worktrees and submodules use a file: "gitdir: /absolute/or/relative".
        const pointer = readFileSync(candidate, "utf-8").match(/^gitdir:\s*(.+)$/m);
        return pointer ? resolve(dir, pointer[1]!.trim()) : null;
      }
    } catch {
      // Not here; keep walking up.
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

/**
 * The current branch, read straight from .git/HEAD.
 *
 * This used to be `execSync("git branch --show-current")` inside the
 * session.created hook — a blocking fork of git on OpenCode's thread, once per
 * session, subagents included. A session that spawns 50 subagents paid for 50
 * of them. Reading one small file costs microseconds and needs no git binary.
 *
 * Returns undefined for a detached HEAD, which has no branch to report.
 */
export function getGitBranch(directory?: string): string | undefined {
  if (!directory) return undefined;

  let gitDir = gitDirCache.get(directory);
  if (gitDir === undefined) {
    gitDir = findGitDir(directory);
    gitDirCache.set(directory, gitDir);
  }
  if (gitDir === null) return undefined;

  try {
    const head = readFileSync(join(gitDir, "HEAD"), "utf-8").trim();
    const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return ref ? ref[1]!.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** Test seam: the resolution cache lives for the process otherwise. */
export function clearGitDirCache(): void {
  gitDirCache.clear();
}
