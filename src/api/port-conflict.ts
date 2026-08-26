export async function checkExistingServer(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { "x-opencode-meter-check": "1" },
    });
    return res.headers.get("x-opencode-meter") === "1";
  } catch {
    return false;
  }
}
