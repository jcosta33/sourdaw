import { DAW_TOOL_SCHEMAS } from '../../models/toolDefinitions';

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

// ── Conversion ──────────────────────────────────────────────────────────

/**
 * Convert all DAW_TOOL_SCHEMAS to MCP-compatible tool definitions.
 * The conversion is 1:1 since our internal schema already uses JSON Schema.
 */
export function toMcpTools(): McpToolDefinition[] {
    return DAW_TOOL_SCHEMAS.map((schema) => ({
        name: schema.function.name,
        description: schema.function.description,
        inputSchema: {
            type: 'object' as const,
            properties: schema.function.parameters.properties as Record<string, McpPropertySchema>,
            required: schema.function.parameters.required.length > 0 ? schema.function.parameters.required : undefined,
        },
    }));
}

export // Cached — tool schemas don't change at runtime
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