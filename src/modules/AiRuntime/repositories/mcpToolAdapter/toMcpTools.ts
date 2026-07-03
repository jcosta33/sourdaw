import { DAW_TOOL_SCHEMAS } from '../../models/ToolDefinitions';

import { type McpPropertySchema, type McpToolDefinition } from './helpers';

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
