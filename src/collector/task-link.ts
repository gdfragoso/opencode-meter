const TASK_METADATA_BLOCK = /<task_metadata>([\s\S]*?)<\/task_metadata>/gi;
const EXPLICIT_SESSION_ID = /Session ID:\s*(ses_[a-zA-Z0-9_-]+)/g;

// opencode's task tool contract: the spawned child session id is either in the
// tool result metadata or embedded in the result text as a <task_metadata>
// block (stock opencode and oh-my-openagent both emit it).
export function extractTaskChildSessionID(
  metadata: Record<string, unknown> | undefined,
  outputText: string | undefined
): string | null {
  for (const key of ["sessionId", "sessionID", "session_id"]) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  if (!outputText) return null;

  const blocks = [...outputText.matchAll(TASK_METADATA_BLOCK)];
  const block = blocks.at(-1)?.[1];
  if (block) {
    for (const line of block.split("\n")) {
      const [key, ...rest] = line.trim().split(":");
      if (key.toLowerCase() === "session_id") {
        const value = rest.join(":").trim();
        if (value) return value;
      }
    }
  }

  const explicit = [...outputText.matchAll(EXPLICIT_SESSION_ID)].at(-1)?.[1];
  return explicit ?? null;
}
