import { type McpToolDefinition, toMcpTools } from './toMcpTools';

// Cached — tool schemas don't change at runtime
let cachedMcpTools: McpToolDefinition[] | null = null;

/**
 * Get MCP tool definitions (cached after first call).
 */
export function getMcpTools(): McpToolDefinition[] {
    if (!cachedMcpTools) {
        cachedMcpTools = toMcpTools();
    }
    return cachedMcpTools;
}
