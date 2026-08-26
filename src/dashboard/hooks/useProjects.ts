import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";
import type { ProjectRow, ProjectDetail, ProjectsResponse } from "@/dashboard/lib/api";

export function useProjects() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();
  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const url = `/api/projects?${params}`;
  const result = useApi<ProjectRow[] | ProjectsResponse>(url, refreshKey);

  // Parse the response – when ?project= is set, backend returns { projects, detail }
  if (result.data && !Array.isArray(result.data)) {
    return {
      loading: result.loading,
      error: result.error,
      projects: result.data.projects,
      detail: result.data.detail,
    };
  }

  return {
    loading: result.loading,
    error: result.error,
    projects: (result.data as ProjectRow[]) ?? [],
    detail: null as ProjectDetail | null,
  };
}