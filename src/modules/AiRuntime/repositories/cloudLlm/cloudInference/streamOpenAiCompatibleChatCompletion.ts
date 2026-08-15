import { type ModelProviderEvent } from '../../../models/ModelProviderProtocol';
import { type OpenAiCompatibleCloudRuntime } from '../cloudSession';

import { requestOpenAiCompatibleProvider } from './requestOpenAiCompatibleProvider';

type ModelProviderUsageEvent = Extract<ModelProviderEvent, { type: 'usage' }>;

type StreamOpenAiCompatibleChatCompletionInput = {
    runtime: OpenAiCompatibleCloudRuntime;
    messages: Array<{ role: string; content: string }>;
    onToken: (text: string) => void;
    signal: AbortSignal;
    maxTokens?: number;
    onUsage?: (event: ModelProviderUsageEvent) => void;
    onUnknownEvent?: (providerEventType: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type ParsedStreamEvent = {
    text: string | null;
    finishReason: string | null;
    usage: ModelProviderUsageEvent['usage'] | null;
    unknownEventType: string | null;
};

export type OpenAiCompatibleFinishReason = 'stop' | 'length';

type StreamState = {
    finishReason: OpenAiCompatibleFinishReason | null;
};

function parseStreamEvent(event: unknown): ParsedStreamEvent {
    if (!isRecord(event) || 'error' in event) {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    if (!Array.isArray(event.choices)) {
        if (typeof event.type === 'string') {
            return { text: null, finishReason: null, usage: null, unknownEventType: event.type };
        }
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    const usage = readUsage(event.usage);
    if (event.choices.length === 0) {
        if (usage) {
            return { text: null, finishReason: null, usage, unknownEventType: null };
        }
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    const choices: unknown[] = event.choices;
    const firstChoice = choices[0];
    if (!isRecord(firstChoice) || !isRecord(firstChoice.delta)) {
        throw new Error('Hosted AI returned an invalid streaming event');
    }

    const content = firstChoice.delta.content;
    if (content !== undefined && content !== null && typeof content !== 'string') {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    const finishReason = firstChoice.finish_reason;
    if (finishReason !== undefined && finishReason !== null && typeof finishReason !== 'string') {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    if (firstChoice.delta.refusal !== undefined && firstChoice.delta.refusal !== null) {
        throw new Error('Hosted AI refused the chat request');
    }

    return {
        text: typeof content === 'string' ? content : null,
        finishReason: typeof finishReason === 'string' ? finishReason : null,
        usage,
        unknownEventType: null,
    };
}

function emitEventData(
    data: string,
    onToken: (text: string) => void,
    onUsage: ((event: ModelProviderUsageEvent) => void) | undefined,
    onUnknownEvent: ((providerEventType: string) => void) | undefined,
    state: StreamState
): OpenAiCompatibleFinishReason | null {
    if (data === '[DONE]') {
        if (state.finishReason === null) {
            throw new Error('Hosted AI chat stream ended before normal completion');
        }
        return state.finishReason;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(data) as unknown;
    } catch {
        throw new Error('Hosted AI returned an invalid streaming event');
    }
    const event = parseStreamEvent(parsed);
    if (event.unknownEventType !== null) {
        onUnknownEvent?.(`openai-compatible:${event.unknownEventType}`);
        return null;
    }
    if (event.usage) {
        onUsage?.({ type: 'usage', mode: 'final', usage: event.usage, provenance: 'provider-reported' });
    }
    if (event.finishReason !== null) {
        if (event.finishReason !== 'stop' && event.finishReason !== 'length') {
            throw new Error('Hosted AI chat stream ended before normal completion');
        }
        state.finishReason = event.finishReason;
    }
    if (event.text !== null) {
        onToken(event.text);
    }
    return null;
}

export async function streamOpenAiCompatibleChatCompletion({
    runtime,
    messages,
    onToken,
    signal,
    maxTokens,
    onUsage,
    onUnknownEvent,
}: StreamOpenAiCompatibleChatCompletionInput): Promise<OpenAiCompatibleFinishReason> {
    const body = JSON.stringify({
        model: runtime.model,
        messages: messages.filter(
            (message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant'
        ),
        max_tokens: maxTokens ?? 2048,
        stream: true,
        ...(runtime.provider === 'openai' ? { stream_options: { include_usage: true } } : {}),
    });
    const decoder = new TextDecoder();
    let buffer = '';
    let completed: OpenAiCompatibleFinishReason | null = null;
    const streamState: StreamState = { finishReason: null };
    const consumeLines = (): void => {
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data:') || completed !== null) {
                continue;
            }
            completed = emitEventData(line.slice(5).trim(), onToken, onUsage, onUnknownEvent, streamState);
        }
    };
    const response = await requestOpenAiCompatibleProvider({
        runtime,
        body,
        signal,
        onBodyChunk: (chunk) => {
            buffer += decoder.decode(chunk, { stream: true });
            consumeLines();
        },
    });
    if (response.status < 200 || response.status >= 300) {
        throw new Error(`Hosted AI chat request failed with status ${String(response.status)}`);
    }
    buffer += decoder.decode();
    consumeLines();
    const finalLine = buffer.trim();
    if (completed === null && finalLine.startsWith('data:')) {
        completed = emitEventData(finalLine.slice(5).trim(), onToken, onUsage, onUnknownEvent, streamState);
    }
    if (completed === null) {
        throw new Error('Hosted AI chat stream ended unexpectedly');
    }
    return completed;
}

function readUsage(value: unknown): ModelProviderUsageEvent['usage'] | null {
    if (!isRecord(value)) {
        return null;
    }
    const inputTokens = readNonNegativeInteger(value.prompt_tokens);
    const outputTokens = readNonNegativeInteger(value.completion_tokens);
    if (inputTokens === null && outputTokens === null) {
        return null;
    }
    const promptDetails = isRecord(value.prompt_tokens_details) ? value.prompt_tokens_details : null;
    const completionDetails = isRecord(value.completion_tokens_details) ? value.completion_tokens_details : null;
    return {
        inputTokens,
        outputTokens,
        cachedInputTokens: readNonNegativeInteger(promptDetails?.cached_tokens),
        reasoningTokens: readNonNegativeInteger(completionDetails?.reasoning_tokens),
    };
}

function readNonNegativeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}
