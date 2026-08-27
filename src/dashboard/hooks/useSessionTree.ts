import { useApi } from "@/dashboard/hooks/useApi";
import { useRefresh } from "@/dashboard/App";
import type { SessionTreeResponse } from "@/data/domain/session";

export function useSessionTree(id: string | undefined) {
  const { refreshKey } = useRefresh();
  const path = id ? `/api/sessions/${encodeURIComponent(id)}/tree` : "";
  return useApi<SessionTreeResponse>(path, refreshKey);
}
