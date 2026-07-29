import { ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { type OpenAiCompatibleCloudRuntime } from '../cloudSession';

type GenerateOpenAiCompatibleToolCallsInput = {
    runtime: OpenAiCompatibleCloudRuntime;
    systemPrompt: string;
    userMessage: string;
    toolSchemas: readonly ToolSchema[];
    signal?: AbortSignal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasAssistantContent(value: unknown): boolean {
    if (typeof value === 'string') {
        return value.trim().length > 0;
    }
    return Array.isArray(value) && value.length > 0;
}

function parseArguments(value: unknown): Record<string, unknown> | null {
    if (isRecord(value)) {
        return value;
    }
    if (typeof value !== 'string') {
        return null;
    }
    try {
        const parsed = JSON.parse(value) as unknown;
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseToolCalls(response: unknown): ToolCallResult[] {
    if (!isRecord(response) || !Array.isArray(response.choices)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    const choices: unknown[] = response.choices;
    const firstChoice = choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    if (firstChoice.message.refusal !== undefined && firstChoice.message.refusal !== null) {
        throw new ToolPlanningRejectedError('Hosted AI refused tool planning');
    }
    const finishReason = firstChoice.finish_reason;
    const hasValidFinishReason = finishReason === 'tool_calls' || finishReason === 'stop';
    if (!hasValidFinishReason) {
        throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
    }
    if (finishReason === 'stop' && hasAssistantContent(firstChoice.message.content)) {
        throw new ToolPlanningRejectedError('Hosted AI returned a non-tool response instead of a tool-call batch');
    }
    if (!Array.isArray(firstChoice.message.tool_calls)) {
        if (finishReason === 'stop') {
            return [];
        }
        throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
    }
    if (finishReason === 'stop' && firstChoice.message.tool_calls.length > 0) {
        throw new ToolPlanningRejectedError('Hosted AI returned an inconsistent tool-call batch');
    }

    const results: ToolCallResult[] = [];
    for (const rawCall of firstChoice.message.tool_calls) {
        if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-call batch');
        }
        const name = rawCall.function.name;
        const arguments_ = parseArguments(rawCall.function.arguments);
        if (typeof name !== 'string' || name.length === 0 || !arguments_) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-call batch');
        }
        results.push({ name, arguments: arguments_ });
    }
    if (finishReason === 'tool_calls' && results.length === 0) {
        throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
    }
    return results;
}

export async function generateOpenAiCompatibleToolCalls({
    runtime,
    systemPrompt,
    userMessage,
    toolSchemas,
    signal,
}: GenerateOpenAiCompatibleToolCallsInput): Promise<ToolCallResult[]> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };
    if (runtime.api_key) {
        headers.Authorization = `Bearer ${runtime.api_key}`;
    }

    const response = await fetch(`${runtime.base_url}/chat/completions`, {
        method: 'POST',
        signal,
        headers,
        body: JSON.stringify({
            model: runtime.model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage },
            ],
            tools: toolSchemas,
            tool_choice: 'auto',
            stream: false,
        }),
    });

    if (!response.ok) {
        throw new Error(`Hosted AI tool request failed with status ${String(response.status)}`);
    }

    let payload: unknown;
    try {
        payload = (await response.json()) as unknown;
    } catch {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    return parseToolCalls(payload);
}
