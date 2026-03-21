/**
 * MCP (Model Context Protocol) adapter for DAW tool definitions.
 *
 * Converts internal DAW_TOOL_SCHEMAS to MCP-compatible tool definitions.
 * This provides a universal tool definition layer that works with:
 * - mistral.rs (local, via built-in MCP support)
 * - Claude API (cloud, via native tools parameter)
 * - OpenAI API (cloud, via function calling)
 * - WebLLM (browser, via JSON schema injection)
 *
 * MCP spec: https://modelcontextprotocol.io/specification
 */

import { DAW_TOOL_SCHEMAS } from './toolDefinitions';

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

export type McpPropertySchema = {
    type: string;
    description?: string;
    enum?: string[];
    items?: { type: string };
    default?: unknown;
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

// ── Format converters (MCP → backend-specific) ──────────────────────────

/**
 * Convert MCP tools to OpenAI/Claude function calling format.
 * Used for cloud API backends that accept a `tools` parameter.
 */
export function mcpToOpenAiTools(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
    return getMcpTools().map((tool) => ({
        type: 'function' as const,
        function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.inputSchema,
        },
    }));
}

/**
 * Serialize MCP tools as a compact text list for injection into system prompts.
 * Used for text-based backends (WebLLM, llama-server) that don't have native tool calling.
 *
 * Format: `toolName(param:type, ...) - description`
 * This dramatically reduces token usage compared to full JSON schemas.
 */
export function mcpToCompactPromptText(): string {
    return getMcpTools()
        .map((tool) => {
            const params = Object.entries(tool.inputSchema.properties)
                .map(([key, val]) => {
                    const typeStr = val.enum ? val.enum.join('|') : val.type;
                    return `${key}:${typeStr}`;
                })
                .join(', ');
            return `${tool.name}(${params}) - ${tool.description}`;
        })
        .join('\n');
}
