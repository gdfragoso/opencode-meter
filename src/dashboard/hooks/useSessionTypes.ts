import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";

interface SessionTypesResponse {
  main: number;
  subagent: number;
  avgSubagentsPerMain: number;
  subagentShare: Array<{
    agent: string;
    tokens: number;
    cost: number;
    pctOfParent: number;
  }>;
}

export type { SessionTypesResponse };

export function useSessionTypes() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();
  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const url = query ? `/api/sessions/types?${query}` : "/api/sessions/types";
  return useApi<SessionTypesResponse>(url, refreshKey);
}
