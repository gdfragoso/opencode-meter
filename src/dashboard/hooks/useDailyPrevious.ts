import { useApi } from "@/dashboard/hooks/useApi";
import { useProject, useRefresh, useRange } from "@/dashboard/App";
import type { DailyRow } from "@/data/domain/daily";

/**
 * Twice the selected range, so the window before the current one is available
 * to draw behind it.
 *
 * A separate request from `useDaily` rather than a widened one: every other tab
 * reads `useDaily` and must keep getting exactly the selected range. This one
 * is only ever read through a date lookup, so the overlap with the current
 * window is harmless.
 *
 * Returns nothing when the range is "all time" — there is no window before it.
 */
export function useDailyPrevious() {
  const { days } = useRange();
  const { project, branch } = useProject();
  const { refreshKey } = useRefresh();

  const params = new URLSearchParams();
  if (days > 0) params.set("days", String(days * 2));
  if (project) params.set("project", project);
  if (branch) params.set("branch", branch);
  const query = params.toString();
  const url = days > 0 ? `/api/daily?${query}` : "";

  const { data, loading, error } = useApi<DailyRow[]>(url, refreshKey);
  return { rows: data, days, loading, error };
}
