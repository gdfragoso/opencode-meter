const BUILTIN_TOOLS = new Set([
  "read", "grep", "glob", "bash", "edit", "write", "task", "skill",
  "skill_mcp", "todowrite", "look_at", "question", "webfetch",
  "websearch_web_search_exa", "invalid",
  "lsp_diagnostics", "lsp_find_references", "lsp_goto_definition",
  "lsp_prepare_rename", "lsp_rename", "lsp_symbols", "lsp_status",
  "lsp_install_decision",
  "session_list", "session_info", "session_read", "session_search",
  "ddconfig", "ddsetup", "ddtoolsets",
  "list_mcp_resources", "list_mcp_resource_templates", "read_mcp_resource",
  "background_output", "background_cancel",
  "grep_app_searchGitHub",
]);

export interface ToolCount {
  name: string;
  count: number;
}

export interface McpGroup {
  server: string;
  tools: ToolCount[];
  total: number;
}

export function classifyTools(tools: ToolCount[]): {
  builtin: ToolCount[];
  mcp: McpGroup[];
} {
  const builtin: ToolCount[] = [];
  const mcpMap = new Map<string, ToolCount[]>();

  for (const t of tools) {
    if (BUILTIN_TOOLS.has(t.name)) {
      builtin.push(t);
    } else {
      const server = extractServer(t.name);
      if (!mcpMap.has(server)) mcpMap.set(server, []);
      mcpMap.get(server)!.push(t);
    }
  }

  const mcp: McpGroup[] = [...mcpMap.entries()]
    .map(([server, serverTools]) => ({
      server,
      tools: [...serverTools].sort((a, b) => b.count - a.count),
      total: serverTools.reduce((sum, t) => sum + t.count, 0),
    }))
    .sort((a, b) => b.total - a.total);

  return { builtin, mcp };
}

export function isBuiltinTool(name: string): boolean {
  return BUILTIN_TOOLS.has(name);
}

export function extractServer(name: string): string {
  // Common MCP patterns: servername_toolname or servername-toolname
  const parts = name.split("_");
  if (parts.length >= 2) return parts[0];
  const dotParts = name.split(".");
  if (dotParts.length >= 2) return dotParts[0];
  const hyphenParts = name.split("-");
  if (hyphenParts.length >= 2) return hyphenParts[0];
  return name;
}
