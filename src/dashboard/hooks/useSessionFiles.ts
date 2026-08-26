import { useApi } from "@/dashboard/hooks/useApi";
import { useRefresh } from "@/dashboard/App";
import type { SessionFilesResponse } from "@/data/domain/session";

export function useSessionFiles(sessionID: string) {
  const { refreshKey } = useRefresh();
  const path = sessionID ? `/api/sessions/${encodeURIComponent(sessionID)}/files` : "";
  const { data: files, loading, error } = useApi<SessionFilesResponse>(path, refreshKey);
  return { files, loading, error };
}
