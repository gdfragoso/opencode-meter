/**
 * Whether an opencode-meter dashboard is already answering on this port.
 *
 * Probes `/health`, which is a real route. It used to probe `/api/health`,
 * which is not one — that reached the dashboard's SPA fallback and passed only
 * because the `x-opencode-meter` header is set by middleware on every response,
 * including responses to paths that do not exist. The header is still what
 * identifies the server; hitting a route that exists is what makes the check
 * mean what it says.
 */
export async function checkExistingServer(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { "x-opencode-meter-check": "1" },
    });
    return res.headers.get("x-opencode-meter") === "1";
  } catch {
    return false;
  }
}
