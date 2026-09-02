import { useApi } from "@/dashboard/hooks/useApi";
import { useRefresh } from "@/dashboard/App";
import type { SessionContextResponse } from "@/data/domain/session";

export function useSessionContext(id: string | undefined) {
  const { refreshKey } = useRefresh();
  const path = id ? `/api/sessions/${encodeURIComponent(id)}/context` : "";
  return useApi<SessionContextResponse>(path, refreshKey);
}
