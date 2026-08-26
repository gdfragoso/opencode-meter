import { useEffect, useState } from "react";
import { fetchJSON } from "@/dashboard/lib/api";

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useApi<T>(path: string, refreshKey?: number): ApiState<T> {
  // Keyed by path: when the project, branch or range filter changes, the old
  // response must not stay on screen labelled as the new one. Holding the path
  // in state makes the swap happen in the same render as the new request,
  // instead of one commit later through an effect.
  const [state, setState] = useState<ApiState<T> & { path: string }>({
    path,
    data: null,
    loading: Boolean(path),
    error: null,
  });

  if (state.path !== path) {
    setState({ path, data: null, loading: Boolean(path), error: null });
  }

  useEffect(() => {
    if (!path) return;

    let cancelled = false;
    const controller = new AbortController();

    fetchJSON<T>(path, controller.signal)
      .then((result) => {
        if (!cancelled) setState({ path, data: result, loading: false, error: null });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          path,
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
    // refreshKey is not read inside the effect on purpose: bumping it is how
    // the auto-refresh asks every hook to re-fetch the same path.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies
  }, [path, refreshKey]);

  // Never hand back a response that belongs to a different path.
  return state.path === path
    ? { data: state.data, loading: state.loading, error: state.error }
    : { data: null, loading: Boolean(path), error: null };
}
