import { useApi } from "@/dashboard/hooks/useApi";
import { useRefresh } from "@/dashboard/App";
import type { SessionRow } from "@/data/domain/session";

export function useSession(id: string | undefined) {
  const { refreshKey } = useRefresh();
  const path = id ? `/api/sessions/${encodeURIComponent(id)}` : "";
  return useApi<SessionRow>(path, refreshKey);
}
