import { createAiRuntimeError } from '../../errors/AiRuntimeError';

import { generateToolPlanningOutcome } from './inference';

import type { ToolSchema } from '../../models/ToolDefinitions';
import type { ToolCallResult } from '../../transformers/toolCallParser';

export async function generateToolCalls(
    systemPrompt: string,
    userMessage: string,
    toolSchemas?: readonly ToolSchema[],
    signal?: AbortSignal
): Promise<ToolCallResult[]> {
    const outcome = await generateToolPlanningOutcome(systemPrompt, userMessage, toolSchemas, signal);
    if (outcome.status === 'rejected') {
        throw createAiRuntimeError(outcome.reason);
    }
    return outcome.toolCalls;
}
