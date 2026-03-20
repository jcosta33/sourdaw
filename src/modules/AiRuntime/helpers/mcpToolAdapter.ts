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

/**
 * MCP Tool call result, returned after tool execution.
 */
export type McpToolCallResult = {
    content: Array<{
        type: 'text';
        text: string;
    }>;
    isError?: boolean;
};

/**
 * MCP Tool call request from the model.
 */
export type McpToolCallRequest = {
    name: string;
    arguments: Record<string, unknown>;
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
            required: schema.function.parameters.required.length > 0
                ? schema.function.parameters.required
                : undefined,
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

/**
 * Serialize MCP tools as full JSON Schema for injection into system prompts.
 * Higher token usage but gives the model full type information.
 */
export function mcpToJsonPromptText(): string {
    return JSON.stringify(getMcpTools(), null, 2);
}

// ── Tool lookup ─────────────────────────────────────────────────────────

/**
 * Look up an MCP tool definition by name.
 */
export function getMcpToolByName(name: string): McpToolDefinition | undefined {
    return getMcpTools().find((t) => t.name === name);
}

/**
 * Get all tool names for validation.
 */
export function getMcpToolNames(): Set<string> {
    return new Set(getMcpTools().map((t) => t.name));
}
