import { useApi } from "@/dashboard/hooks/useApi";
import { useRefresh } from "@/dashboard/App";

interface ToolCount {
  name: string;
  count: number;
}

export function useSessionTools(sessionID: string) {
  const { refreshKey } = useRefresh();
  return useApi<ToolCount[]>(`/api/sessions/${sessionID}/tools`, refreshKey);
}
