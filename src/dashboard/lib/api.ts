import type { SessionFilesResponse } from "@/data/domain/session";

export const API_BASE =
  import.meta.env.VITE_API_BASE ?? "";

export async function fetchJSON<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { signal });
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export function fetchSessionFiles(id: string): Promise<SessionFilesResponse> {
  return fetchJSON<SessionFilesResponse>(`/api/sessions/${encodeURIComponent(id)}/files`);
}

export interface ProjectRow {
  directory: string;
  branches: string;
  sessions: number;
  tokens_in: number;
  tokens_out: number;
  total_cost: number;
  tools_total: number;
  subagents_total: number;
  last_active: number | null;
  top_model: string | null;
  error_count: number;
  branch_count: number;
  avg_cost_per_session: number;
  tokens_per_dollar: number;
}

export interface ProjectBranchSummary {
  branch: string | null;
  sessions: number;
  total_cost: number;
  tokens_in: number;
  tokens_out: number;
  last_active: number | null;
  top_model: string | null;
}

export interface ProjectDetail extends ProjectRow {
  branch_summaries: ProjectBranchSummary[];
  models: Array<{ model_id: string; sessions: number; cost: number }>;
}

export interface ProjectsResponse {
  projects: ProjectRow[];
  detail: ProjectDetail | null;
}

export function fetchProjects(
  days?: number,
  project?: string | null,
  branch?: string | null,
): Promise<ProjectRow[] | ProjectsResponse> {
  const params = new URLSearchParams();
  if (days != null) params.set("days", String(days));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  return fetchJSON<ProjectRow[] | ProjectsResponse>(`/api/projects${query ? `?${query}` : ""}`);
}
