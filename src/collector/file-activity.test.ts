import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  classifyFileActivity,
  normalizePath,
  parseBashFileCommands,
  type FileActivityEntry,
  } from "./file-activity";

function onlyPaths(entries: FileActivityEntry[]): string[] {
  return entries.map((e) => e.path);
}

describe("normalizePath", () => {
  test("absolute path is returned unchanged", () => {
    expect(normalizePath("/abs/x.ts")).toBe("/abs/x.ts");
  });

  test("relative path is resolved against cwd (absolute result)", () => {
    const resolved = normalizePath("foo/bar.ts");
    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved).toBe(path.resolve(process.cwd(), "foo/bar.ts"));
  });
});

describe("classifyFileActivity — read", () => {
  test("read of a file returns a read entry", () => {
    const entries = classifyFileActivity({
      tool: "read",
      args: { filePath: "src/a.ts" },
      output: { metadata: { display: { type: "file" } } },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("read");
    expect(entries[0].tool).toBe("read");
    expect(typeof entries[0].ts).toBe("number");
    expect(onlyPaths(entries)).toEqual([
      path.resolve(process.cwd(), "src/a.ts"),
    ]);
  });

  test("read of a directory (display.type === directory) is ignored", () => {
    expect(
      classifyFileActivity({
        tool: "read",
        args: { filePath: "src" },
        output: { metadata: { display: { type: "directory" } } },
      })
    ).toEqual([]);
  });

  test("read with metadata absent still counts as read (fallback)", () => {
    const entries = classifyFileActivity({
      tool: "read",
      args: { filePath: "notes.md" },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("read");
  });

  test("read without filePath arg returns []", () => {
    expect(classifyFileActivity({ tool: "read", args: {} })).toEqual([]);
    expect(classifyFileActivity({ tool: "read" })).toEqual([]);
  });
});

describe("classifyFileActivity — write", () => {
  test("write with existed=false is created", () => {
    const entries = classifyFileActivity({
      tool: "write",
      args: { filePath: "new.txt" },
      existed: false,
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("created");
  });

  test("write with existed=true is modified", () => {
    const entries = classifyFileActivity({
      tool: "write",
      args: { filePath: "existing.txt" },
      existed: true,
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("modified");
  });

  test("write with existed=undefined is conservatively modified", () => {
    const entries = classifyFileActivity({
      tool: "write",
      args: { filePath: "unknown.txt" },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("modified");
  });

  test("write without filePath returns []", () => {
    expect(classifyFileActivity({ tool: "write", args: { content: "x" } })).toEqual([]);
  });
});

describe("classifyFileActivity — edit", () => {
  test("edit with filePath returns modified", () => {
    const entries = classifyFileActivity({
      tool: "edit",
      args: { filePath: "src/a.ts", oldString: "a", newString: "b" },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("modified");
    expect(entries[0].tool).toBe("edit");
  });

  test("edit without filePath returns []", () => {
    expect(classifyFileActivity({ tool: "edit", args: { oldString: "a" } })).toEqual([]);
  });
});

describe("classifyFileActivity — apply_patch", () => {
  test("add/update/delete/move map to the fixed 4-action enum (move = deleted+created)", () => {
    const entries = classifyFileActivity({
      tool: "apply_patch",
      output: {
        metadata: {
          files: [
            { filePath: "new.ts", type: "add", additions: 5 },
            { filePath: "edit.ts", type: "update", additions: 2, deletions: 1 },
            { filePath: "old.ts", type: "delete", deletions: 3 },
            { filePath: "src/a.ts", type: "move", movePath: "src/b.ts", additions: 1, deletions: 1 },
          ],
        },
      },
    });
    expect(entries.length).toBe(5);
    expect(entries.map((e) => e.action)).toEqual([
      "created",
      "modified",
      "deleted",
      "deleted",
      "created",
    ]);
    expect(entries[0].path).toContain("new.ts");
    expect(entries[0].additions).toBe(5);
    expect(entries[1].additions).toBe(2);
    expect(entries[1].deletions).toBe(1);
    expect(entries[3].path).toContain("src/a.ts");
    expect(entries[4].path).toContain("src/b.ts");
    // every entry is stamped with the tool
    for (const e of entries) expect(e.tool).toBe("apply_patch");
  });

  test("apply_patch without metadata.files array returns [] (never parses patchText)", () => {
    expect(
      classifyFileActivity({ tool: "apply_patch", args: { patchText: "--- a/x\n+++ b/x" } })
    ).toEqual([]);
    expect(
      classifyFileActivity({
        tool: "apply_patch",
        output: { metadata: { files: "not-an-array" } },
      })
    ).toEqual([]);
  });
});

describe("classifyFileActivity — bash", () => {
  test("bash rm produces deleted entry", () => {
    const entries = classifyFileActivity({
      tool: "bash",
      args: { command: "rm old.txt" },
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe("deleted");
    expect(entries[0].tool).toBe("bash");
    expect(typeof entries[0].ts).toBe("number");
  });

  test("bash mv produces deleted+created", () => {
    const entries = classifyFileActivity({
      tool: "bash",
      args: { command: "mv a.txt b.txt" },
    });
    expect(entries.length).toBe(2);
    expect(entries[0].action).toBe("deleted");
    expect(entries[1].action).toBe("created");
  });

  test("bash with glob target returns []", () => {
    expect(
      classifyFileActivity({ tool: "bash", args: { command: "rm -rf dist/*" } })
    ).toEqual([]);
  });

  test("bash without command returns []", () => {
    expect(classifyFileActivity({ tool: "bash" })).toEqual([]);
  });
});

describe("classifyFileActivity — closed allowlist", () => {
  test("known non-file tools return []", () => {
    for (const tool of [
      "grep",
      "glob",
      "task",
      "skill",
      "todowrite",
      "webfetch",
      "websearch",
      "lsp",
      "question",
      "plan",
    ]) {
      expect(
        classifyFileActivity({ tool, args: { filePath: "x.txt" } }),
        `tool ${tool} must yield no file activity`
      ).toEqual([]);
    }
  });

  test("any other tool returns []", () => {
    expect(
      classifyFileActivity({ tool: "random_tool", args: { filePath: "x.txt" } })
    ).toEqual([]);
  });
});

describe("parseBashFileCommands", () => {
  test("rm variants are deleted", () => {
    expect(parseBashFileCommands("rm /tmp/x.txt")).toEqual([
      { path: "/tmp/x.txt", action: "deleted" },
    ]);
    expect(parseBashFileCommands("rm -rf dist")).toEqual([{ path: "dist", action: "deleted" }]);
    expect(parseBashFileCommands("rm -fr cache")).toEqual([{ path: "cache", action: "deleted" }]);
    expect(parseBashFileCommands("rm -r tmp")).toEqual([{ path: "tmp", action: "deleted" }]);
    expect(parseBashFileCommands("rm -f stale.txt")).toEqual([
      { path: "stale.txt", action: "deleted" },
    ]);
  });

  test("rmdir is deleted", () => {
    expect(parseBashFileCommands("rmdir empty-dir")).toEqual([
      { path: "empty-dir", action: "deleted" },
    ]);
  });

  test("mv is deleted(src) + created(dst), optional flags allowed", () => {
    expect(parseBashFileCommands("mv a.txt b.txt")).toEqual([
      { path: "a.txt", action: "deleted" },
      { path: "b.txt", action: "created" },
    ]);
    expect(parseBashFileCommands("mv -f src.ts dst.ts")).toEqual([
      { path: "src.ts", action: "deleted" },
      { path: "dst.ts", action: "created" },
    ]);
  });

  test("touch is created", () => {
    expect(parseBashFileCommands("touch new.txt")).toEqual([
      { path: "new.txt", action: "created" },
    ]);
  });

  test("glob targets are ignored", () => {
    expect(parseBashFileCommands("rm -rf dist/*")).toEqual([]);
    expect(parseBashFileCommands("rm foo[1-3].txt")).toEqual([]);
    expect(parseBashFileCommands("rm build/{a,b}.js")).toEqual([]);
  });

  test("quoted or multi-target commands are ignored", () => {
    expect(parseBashFileCommands('rm "a b.txt"')).toEqual([]);
    expect(parseBashFileCommands("rm file1 file2")).toEqual([]);
    expect(parseBashFileCommands("mv a.txt b.txt c.txt")).toEqual([]);
  });

  test("command chains: only supported commands after separators are captured", () => {
    expect(parseBashFileCommands("mkdir x && rm y.txt")).toEqual([
      { path: "y.txt", action: "deleted" },
    ]);
    expect(parseBashFileCommands("cd /tmp; rm -rf x")).toEqual([
      { path: "x", action: "deleted" },
    ]);
    expect(parseBashFileCommands("echo hi | touch z.txt")).toEqual([
      { path: "z.txt", action: "created" },
    ]);
  });

  test("unsupported commands and empty input return []", () => {
    expect(parseBashFileCommands("")).toEqual([]);
    expect(parseBashFileCommands("sed -i s/a/b/ x.txt")).toEqual([]);
    expect(parseBashFileCommands("cp a.txt b.txt")).toEqual([]);
    expect(parseBashFileCommands("grep foo *.ts")).toEqual([]);
  });
});
