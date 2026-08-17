import { getMcpTools } from './helpers';

// ── Format converters (MCP → backend-specific) ──────────────────────────

/**
 * Convert MCP tools to OpenAI/Claude function calling format.
 * Used for hosted backends that accept a `tools` parameter.
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
