import { toMcpTools } from './toMcpTools';

export type McpPropertySchema = {
    type: string;
    description?: string;
    enum?: string[];
    items?: { type: string };
    default?: unknown;
};

// ── MCP Types (subset used for tool definitions) ────────────────────────

/**
 * MCP Tool definition following the 2025-11-25 specification.
 * @see https://modelcontextprotocol.io/specification/2025-11-25/server/tools
 */
export type McpToolDefinition = {
    /** Unique tool name (alphanumeric + underscore) */
    name: string;
    /** Human-readable description of what the tool does */
    description: string;
    /** JSON Schema describing the tool's input parameters */
    inputSchema: {
        type: 'object';
        properties: Record<string, McpPropertySchema>;
        required?: string[];
    };
};

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
