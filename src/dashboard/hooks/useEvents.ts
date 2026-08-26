import { useApi } from "@/dashboard/hooks/useApi";
import { useRefresh } from "@/dashboard/App";
import type { EventRow } from "@/data/domain/event";

export function useEvents(sessionID: string | null) {
  const { refreshKey } = useRefresh();
  const result = useApi<EventRow[]>(
    sessionID ? `/api/sessions/${encodeURIComponent(sessionID)}/events` : "",
    refreshKey,
  );

  return {
    events: result.data,
    loading: result.loading,
    error: result.error,
  };
}
