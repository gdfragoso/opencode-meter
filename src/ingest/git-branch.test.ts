import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearGitDirCache, getGitBranch } from "./git-branch";

function repo(head: string): string {
  const root = mkdtempSync(join(tmpdir(), "gitbranch-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "HEAD"), head);
  clearGitDirCache();
  return root;
}

describe("getGitBranch", () => {
  it("reads the branch out of .git/HEAD", () => {
    expect(getGitBranch(repo("ref: refs/heads/main\n"))).toBe("main");
  });

  it("keeps slashes in the branch name", () => {
    expect(getGitBranch(repo("ref: refs/heads/feat/some-thing\n"))).toBe("feat/some-thing");
  });

  it("returns undefined for a detached HEAD", () => {
    expect(getGitBranch(repo("9f2a1c0e4b7d8a3f5c6e1b0d9a8c7e6f5d4c3b2a\n"))).toBeUndefined();
  });

  it("walks up from a subdirectory", () => {
    const root = repo("ref: refs/heads/main\n");
    const nested = join(root, "src", "deep", "deeper");
    mkdirSync(nested, { recursive: true });
    clearGitDirCache();

    expect(getGitBranch(nested)).toBe("main");
  });

  it("follows the gitdir pointer a worktree leaves behind", () => {
    const real = mkdtempSync(join(tmpdir(), "gitbranch-real-"));
    writeFileSync(join(real, "HEAD"), "ref: refs/heads/worktree-branch\n");

    const root = mkdtempSync(join(tmpdir(), "gitbranch-wt-"));
    writeFileSync(join(root, ".git"), `gitdir: ${real}\n`);
    clearGitDirCache();

    expect(getGitBranch(root)).toBe("worktree-branch");
  });

  it("returns undefined outside a repository, and for no directory at all", () => {
    clearGitDirCache();
    expect(getGitBranch(mkdtempSync(join(tmpdir(), "gitbranch-bare-")))).toBeUndefined();
    expect(getGitBranch(undefined)).toBeUndefined();
  });

  it("re-reads HEAD, so switching branches mid-session is picked up", () => {
    // Only the .git lookup is cached; the branch itself must stay live.
    const root = repo("ref: refs/heads/main\n");
    expect(getGitBranch(root)).toBe("main");

    writeFileSync(join(root, ".git", "HEAD"), "ref: refs/heads/other\n");
    expect(getGitBranch(root)).toBe("other");
  });
});
