import { compactWebLlmToolSchemas } from './compactWebLlmToolSchema';

type WebLlmPlanningTool = {
    type: 'function';
    function: { name: string; description?: string; parameters?: Record<string, unknown> };
};

/**
 * The system prompt a WebLLM tool-planning request sends: the planning prompt, then the schema
 * definitions two or more tools share, shown once, then every advertised tool spelled through its
 * compacted schema, then the reply format. Qwen3 has no native tool API, so this text is the whole
 * tool contract the model sees, and the request budget measures exactly this text.
 */
export function serializeWebLlmToolPlanningPrompt(systemPrompt: string, tools: readonly WebLlmPlanningTool[]): string {
    const compacted = compactWebLlmToolSchemas(tools);
    const sharedDefinitions: string[] = [];
    if (Object.keys(compacted.sharedDefinitions).length > 0) {
        sharedDefinitions.push(
            'Shared schema definitions; a tool parameter {"$ref":"#/$defs/<name>"} stands for the definition of that name:',
            JSON.stringify(compacted.sharedDefinitions),
            ''
        );
    }
    const toolDescriptions = compacted.tools
        .map((tool) => {
            const params = tool.function.parameters;
            const paramStr = params ? ` ${JSON.stringify(params)}` : '';
            const description = tool.function.description === undefined ? '' : `: ${tool.function.description}`;
            return `- ${tool.function.name}${description}${paramStr}`;
        })
        .join('\n');

    return [
        systemPrompt,
        '',
        ...sharedDefinitions,
        'Available tools:',
        toolDescriptions,
        '',
        'Respond with a JSON array of tool calls: [{"id":"unique_call_id","name":"tool_name","arguments":{...}}]',
        'Output ONLY valid JSON. No markdown, no explanation.',
    ].join('\n');
}
