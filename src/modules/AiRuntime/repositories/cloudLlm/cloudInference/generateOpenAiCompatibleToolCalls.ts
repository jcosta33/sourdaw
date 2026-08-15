import { HostedToolCallingProtocolError } from '../../../errors/HostedToolCallingProtocolError';
import { ToolPlanningRejectedError } from '../../../errors/ToolPlanningRejectedError';
import { type ToolSchema } from '../../../models/ToolDefinitions';
import { type ToolCallResult } from '../../../transformers/toolCallParser';
import { type OpenAiCompatibleCloudRuntime } from '../cloudSession';

import { requestOpenAiCompatibleProvider } from './requestOpenAiCompatibleProvider';

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

type AssistantContentState = { valid: true; hasContent: boolean } | { valid: false };

function inspectAssistantContent(value: unknown): AssistantContentState {
    if (value === undefined || value === null) {
        return { valid: true, hasContent: false };
    }
    if (typeof value === 'string') {
        return { valid: true, hasContent: value.trim().length > 0 };
    }
    if (!Array.isArray(value)) {
        return { valid: false };
    }

    let hasContent = false;
    for (const part of value) {
        if (!isRecord(part) || part.type !== 'text' || typeof part.text !== 'string') {
            return { valid: false };
        }
        if (part.text.trim().length > 0) {
            hasContent = true;
        }
    }
    return { valid: true, hasContent };
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
    if (response.choices.length !== 1) {
        throw new HostedToolCallingProtocolError('Hosted AI returned an invalid response choice count');
    }
    const choices: unknown[] = response.choices;
    const firstChoice = choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.message)) {
        throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
    }
    const contentState = inspectAssistantContent(firstChoice.message.content);
    if (!contentState.valid) {
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
    if (!Array.isArray(firstChoice.message.tool_calls)) {
        if (contentState.hasContent) {
            throw new ToolPlanningRejectedError('Hosted AI returned a non-tool response instead of a tool-call batch');
        }
        if (finishReason === 'stop') {
            return [];
        }
        throw new ToolPlanningRejectedError('Hosted AI returned an incomplete tool-call batch');
    }
    if (finishReason === 'stop' && firstChoice.message.tool_calls.length > 0) {
        throw new ToolPlanningRejectedError('Hosted AI returned an inconsistent tool-call batch');
    }
    if (contentState.hasContent && firstChoice.message.tool_calls.length === 0) {
        throw new ToolPlanningRejectedError('Hosted AI returned a non-tool response instead of a tool-call batch');
    }

    const results: ToolCallResult[] = [];
    for (const rawCall of firstChoice.message.tool_calls) {
        if (!isRecord(rawCall) || !isRecord(rawCall.function)) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-call batch');
        }
        const name = rawCall.function.name;
        const arguments_ = parseArguments(rawCall.function.arguments);
        const id = rawCall.id;
        if (
            typeof name !== 'string' ||
            name.length === 0 ||
            !arguments_ ||
            (id !== undefined && (typeof id !== 'string' || id.length === 0))
        ) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-call batch');
        }
        results.push({ ...(typeof id === 'string' ? { id } : {}), name, arguments: arguments_ });
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
    const body = JSON.stringify({
        model: runtime.model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ],
        tools: toolSchemas,
        tool_choice: 'auto',
        n: 1,
        stream: false,
    });
    const chunks: Uint8Array[] = [];
    const response = await requestOpenAiCompatibleProvider({
        runtime,
        body,
        signal: signal ?? new AbortController().signal,
        onBodyChunk: (chunk) => chunks.push(chunk),
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Hosted AI tool request failed with status ${String(response.status)}`);
    }
    let payload: unknown;
    try {
        const totalLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
        const bytes = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
        }
        payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch (error) {
        if (hasErrorName(error, 'SyntaxError')) {
            throw new ToolPlanningRejectedError('Hosted AI returned an invalid tool-planning response');
        }
        throw error;
    }
    return parseToolCalls(payload);
}

function hasErrorName(value: unknown, name: string): boolean {
    return isRecord(value) && value.name === name;
}
