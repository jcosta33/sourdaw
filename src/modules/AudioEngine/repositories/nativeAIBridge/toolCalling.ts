import { invokeAI } from './isTauri';

export type ToolDefinition = {
    name: string;
    description: string;
    parameters_schema: Record<string, unknown>;
};

export type ToolCall = {
    tool_name: string;
    arguments: Record<string, unknown>;
};

export async function executeToolCalling(
    systemPrompt: string,
    userMessage: string,
    tools: ToolDefinition[],
    temperature?: number
): Promise<ToolCall[]> {
    return (await invokeAI('execute_tool_calling', {
        request: {
            system_prompt: systemPrompt,
            user_message: userMessage,
            tools,
            temperature,
        },
    })) as ToolCall[];
}
