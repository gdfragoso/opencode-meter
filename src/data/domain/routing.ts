// Derives a display label from a task tool's args. Reading `category`/`subagent_type`
// as plain keys keeps this generic: the collector never interprets arg semantics,
// and harnesses that don't pass these keys simply get null (no label applied).
export function routingLabel(args: unknown): string | null {
  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  const record = args as Record<string, unknown>;
  if (typeof record.category === "string" && record.category.length > 0) return record.category;
  if (typeof record.subagent_type === "string" && record.subagent_type.length > 0) return record.subagent_type;
  return null;
}
