import { getMcpTools } from './helpers';

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