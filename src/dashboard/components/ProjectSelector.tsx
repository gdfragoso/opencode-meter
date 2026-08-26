import { useMemo } from "react";
import { useProject, useRange, useRefresh } from "@/dashboard/App";
import { useProjects } from "@/dashboard/hooks/useProjects";

const SELECT_CLASS =
  "bg-cyber-bg border border-cyber-cyan/20 text-cyber-cyan/70 text-xs px-2 py-0.5 tracking-wider uppercase cursor-pointer focus:outline-none focus:border-cyber-cyan/50 disabled:opacity-40 disabled:cursor-not-allowed";
const OPTION_CLASS = "bg-cyber-bg text-cyber-cyan";

export default function ProjectSelector() {
  const { project, branch, setProject, setBranch } = useProject();
  const { days } = useRange();
  const { refreshKey } = useRefresh();
  // useProjects reads days/refreshKey from context internally; the locals
  // above are referenced here so the dependency chain is explicit.
  void days;
  void refreshKey;
  const { projects: projectRows } = useProjects();

  const projectDirs = useMemo(() => {
    const seen = new Set<string>();
    if (!projectRows) return [] as string[];
    for (const row of projectRows) {
      if (row.directory) seen.add(row.directory);
    }
 return Array.from(seen).sort((a, b) => a.localeCompare(b));
  }, [projectRows]);

  const branches = useMemo(() => {
    if (!projectRows || !project) return [] as string[];
    // Find the single row for this project directory and parse its branches JSON
    const row = projectRows.find((r) => r.directory === project);
    if (!row) return [] as string[];
    try {
      const arr = JSON.parse(row.branches);
      return Array.isArray(arr) ? (arr as string[]).sort((a, b) => a.localeCompare(b)) : [];
    } catch {
      return [] as string[];
    }
  }, [projectRows, project]);

  return (
    <div className="flex items-center gap-2">
      <select
        value={project ?? ""}
        onChange={(e) => setProject(e.target.value || null)}
        aria-label="Filter by project"
        className={SELECT_CLASS}
      >
        <option value="" className={OPTION_CLASS}>
          All Projects
        </option>
        {projectDirs.map((p) => (
          <option key={p} value={p} className={OPTION_CLASS}>
            {p}
          </option>
        ))}
      </select>
      <select
        value={branch ?? ""}
        onChange={(e) => setBranch(e.target.value || null)}
        disabled={project === null}
        aria-label="Filter by branch"
        className={SELECT_CLASS}
      >
        <option value="" className={OPTION_CLASS}>
          All Branches
        </option>
        {branches.map((b) => (
          <option key={b} value={b} className={OPTION_CLASS}>
            {b}
          </option>
        ))}
      </select>
    </div>
  );
}
