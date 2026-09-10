import { type ModelProviderEvent } from '../../../models/ModelProviderProtocol';
import { type OpenAiCloudRuntime } from '../cloudSession';

import { isGpt56FamilyModel } from './openAiModelFamilies';
import { type HostedOpenAiFinishReason, type HostedOpenAiStreamResult } from './openAiStreamResult';
import { readProviderRequestId } from './readProviderRequestId';
import { requestHostedOpenAiProvider } from './requestOpenAiProvider';

type ModelProviderUsageEvent = Extract<ModelProviderEvent, { type: 'usage' }>;

type StreamOpenAiResponsesInput = {
    runtime: OpenAiCloudRuntime;
    messages: Array<{ role: string; content: string }>;
    onToken: (text: string) => void;
    signal: AbortSignal;
    maxTokens?: number;
    onUsage?: (event: ModelProviderUsageEvent) => void;
    onUnknownEvent?: (providerEventType: string) => void;
};

type StreamState = {
    finishReason: HostedOpenAiFinishReason | null;
    eventCount: number;
    refused: boolean;
    providerRequestId: string | null;
};

const MAX_STREAM_EVENT_BYTES = 64 * 1_024;
const MAX_STREAM_EVENTS = 4_096;
const INVALID_EVENT_MESSAGE = 'Hosted AI returned an invalid streaming event';
const EVENT_LIMIT_MESSAGE = 'Hosted AI chat stream exceeded its event limit';
const CUT_STREAM_MESSAGE = 'Hosted AI chat stream ended unexpectedly';

/**
 * Structural events whose payload only repeats output this adapter already read
 * from the text deltas. Reporting them as unknown would drown the real ones.
 */
const CONSUMED_EVENT_TYPES: ReadonlySet<string> = new Set([
    'response.output_item.added',
    'response.output_item.done',
    'response.content_part.added',
    'response.content_part.done',
    'response.output_text.done',
]);
const CONSUMED_EVENT_PREFIX = 'response.function_call_arguments.';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isConsumedEventType(type: string): boolean {
    return CONSUMED_EVENT_TYPES.has(type) || type.startsWith(CONSUMED_EVENT_PREFIX);
}

function readNonNegativeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}

function readUsage(value: unknown): ModelProviderUsageEvent['usage'] | null {
    if (!isRecord(value)) {
        return null;
    }
    const inputTokens = readNonNegativeInteger(value.input_tokens);
    const outputTokens = readNonNegativeInteger(value.output_tokens);
    if (inputTokens === null && outputTokens === null) {
        return null;
    }
    const inputDetails = isRecord(value.input_tokens_details) ? value.input_tokens_details : null;
    const outputDetails = isRecord(value.output_tokens_details) ? value.output_tokens_details : null;
    return {
        inputTokens,
        outputTokens,
        cachedInputTokens: readNonNegativeInteger(inputDetails?.cached_tokens),
        reasoningTokens: readNonNegativeInteger(outputDetails?.reasoning_tokens),
    };
}

function readDeltaText(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function readResponseId(value: unknown): string | null {
    return isRecord(value) ? readProviderRequestId(value.id) : null;
}

function readIncompleteFinishReason(value: unknown): HostedOpenAiFinishReason {
    const details = isRecord(value) && isRecord(value.incomplete_details) ? value.incomplete_details : null;
    if (details?.reason === 'max_output_tokens') {
        return 'length';
    }
    if (details?.reason === 'content_filter') {
        return 'refusal';
    }
    throw new Error(INVALID_EVENT_MESSAGE);
}

/**
 * Admits one event for handling: bounds it, parses it, and refuses anything the
 * stream may no longer carry. A terminal outcome closes the stream, so any event
 * after it — including a second terminal one — is a protocol violation.
 */
function admitStreamEvent(data: string, state: StreamState): { type: string; payload: Record<string, unknown> } {
    state.eventCount += 1;
    if (state.eventCount > MAX_STREAM_EVENTS || new TextEncoder().encode(data).byteLength > MAX_STREAM_EVENT_BYTES) {
        throw new Error(EVENT_LIMIT_MESSAGE);
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(data) as unknown;
    } catch {
        throw new Error(INVALID_EVENT_MESSAGE);
    }
    if (!isRecord(parsed) || 'error' in parsed || typeof parsed.type !== 'string' || state.finishReason !== null) {
        throw new Error(INVALID_EVENT_MESSAGE);
    }
    return { type: parsed.type, payload: parsed };
}

function consumeEventData(
    data: string,
    onToken: (text: string) => void,
    onUsage: ((event: ModelProviderUsageEvent) => void) | undefined,
    onUnknownEvent: ((providerEventType: string) => void) | undefined,
    state: StreamState
): void {
    const { type, payload } = admitStreamEvent(data, state);
    if (type === 'error' || type === 'response.failed') {
        throw new Error(INVALID_EVENT_MESSAGE);
    }
    if (type === 'response.created' || type === 'response.in_progress') {
        state.providerRequestId ??= readResponseId(payload.response);
        return;
    }
    if (type === 'response.output_text.delta') {
        const delta = readDeltaText(payload.delta);
        if (delta === null) {
            throw new Error(INVALID_EVENT_MESSAGE);
        }
        onToken(delta);
        return;
    }
    if (type === 'response.refusal.delta' || type === 'response.refusal.done') {
        // The refusal text is provider body content: only the fact that the
        // provider declined leaves this parser.
        state.refused = true;
        return;
    }
    if (type === 'response.completed') {
        state.providerRequestId ??= readResponseId(payload.response);
        const usage = readUsage(isRecord(payload.response) ? payload.response.usage : null);
        if (usage) {
            onUsage?.({ type: 'usage', mode: 'final', usage, provenance: 'provider-reported' });
        }
        state.finishReason = 'stop';
        return;
    }
    if (type === 'response.incomplete') {
        state.finishReason = readIncompleteFinishReason(payload.response);
        return;
    }
    if (isConsumedEventType(type)) {
        return;
    }
    onUnknownEvent?.(`openai-responses:${type}`);
}

export async function streamOpenAiResponses({
    runtime,
    messages,
    onToken,
    signal,
    maxTokens,
    onUsage,
    onUnknownEvent,
}: StreamOpenAiResponsesInput): Promise<HostedOpenAiStreamResult> {
    const instructions = messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n');
    const body = JSON.stringify({
        model: runtime.model,
        ...(instructions.length > 0 ? { instructions } : {}),
        input: messages
            .filter((message) => message.role === 'user' || message.role === 'assistant')
            .map((message) => ({ role: message.role, content: message.content })),
        max_output_tokens: maxTokens ?? 2048,
        stream: true,
        // The data policy disclosed to users is request-scoped processing, so no
        // request may be retained on the provider side.
        store: false,
        ...(isGpt56FamilyModel(runtime.model) ? { reasoning: { effort: 'none' } } : {}),
    });
    const decoder = new TextDecoder();
    let buffer = '';
    const state: StreamState = {
        finishReason: null,
        eventCount: 0,
        refused: false,
        providerRequestId: null,
    };
    const consumeLines = (): void => {
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
            if (!line.startsWith('data:')) {
                continue;
            }
            consumeEventData(line.slice(5).trim(), onToken, onUsage, onUnknownEvent, state);
        }
        if (new TextEncoder().encode(buffer).byteLength > MAX_STREAM_EVENT_BYTES) {
            throw new Error(EVENT_LIMIT_MESSAGE);
        }
    };
    const response = await requestHostedOpenAiProvider({
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
    if (finalLine.startsWith('data:')) {
        consumeEventData(finalLine.slice(5).trim(), onToken, onUsage, onUnknownEvent, state);
    } else if (finalLine.length > 0) {
        throw new Error('Hosted AI chat stream ended with an invalid event');
    }
    if (state.finishReason === null) {
        throw new Error(CUT_STREAM_MESSAGE);
    }
    return {
        finishReason: state.refused ? 'refusal' : state.finishReason,
        providerRequestId: state.providerRequestId,
    };
}
