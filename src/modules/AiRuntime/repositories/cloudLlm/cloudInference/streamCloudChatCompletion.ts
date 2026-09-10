import { logger } from '#/infra/logger/appLogger';

import { isAiRuntimeConfigurationChangedError } from '../../../errors/AiRuntimeConfigurationChangedError';
import { DEFAULT_HOSTED_ANTHROPIC_MODEL } from '../../../models/HostedAnthropicModels';
import { type ModelProviderEvent } from '../../../models/ModelProviderProtocol';
import { getCloudProviderRuntime } from '../getCloudProviderRuntime';
import { linkCloudRequestAbort } from '../linkCloudRequestAbort';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { unregisterCloudStreamController } from '../unregisterCloudStreamController';

import { readProviderRequestId } from './readProviderRequestId';
import { requestAnthropicStream } from './requestAnthropicStream';
import { streamOpenAiCompatibleChatCompletion } from './streamOpenAiCompatibleChatCompletion';

const MAX_ANTHROPIC_EVENT_BYTES = 64 * 1_024;
const MAX_ANTHROPIC_STREAM_BYTES = 1_024 * 1_024;
const MAX_ANTHROPIC_STREAM_EVENTS = 4_096;

/**
 * One provider-neutral finish vocabulary for both hosted protocols, matching
 * `ModelProviderFinish`. `reason` keeps the provider's own wording for logs;
 * callers branch on `finishReason` so an OpenAI `length` and an Anthropic
 * `max_tokens` cannot land on different outcomes.
 */
export type CloudChatCompletionFinishReason = 'stop' | 'length' | 'refusal' | 'error';

type CloudChatCompletionIncompleteReason = Exclude<CloudChatCompletionFinishReason, 'stop'>;

export type CloudChatCompletionOutcome =
    | { status: 'complete'; finishReason: 'stop'; providerRequestId: string | null }
    | {
          status: 'incomplete';
          reason: string;
          finishReason: CloudChatCompletionIncompleteReason;
          safeMessage: string;
          providerRequestId: string | null;
      };

// Provider bodies never reach a user-visible message: each finish reason has one
// fixed sentence of our own.
const INCOMPLETE_SAFE_MESSAGES: Record<CloudChatCompletionIncompleteReason, string> = {
    length: 'The hosted model stopped at its output token limit.',
    refusal: 'The hosted model declined this request.',
    error: 'The hosted model provider returned an incomplete response.',
};

function incompleteOutcome(
    finishReason: CloudChatCompletionIncompleteReason,
    reason: string,
    providerRequestId: string | null
): CloudChatCompletionOutcome {
    return {
        status: 'incomplete',
        reason,
        finishReason,
        safeMessage: INCOMPLETE_SAFE_MESSAGES[finishReason],
        providerRequestId,
    };
}

function readAnthropicFinishReason(stopReason: string): CloudChatCompletionFinishReason {
    if (stopReason === 'end_turn') {
        return 'stop';
    }
    if (stopReason === 'max_tokens') {
        return 'length';
    }
    return stopReason === 'refusal' ? 'refusal' : 'error';
}

type ModelProviderUsageEvent = Extract<ModelProviderEvent, { type: 'usage' }>;

export async function streamCloudChatCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: {
        temperature?: number;
        maxTokens?: number;
        signal?: AbortSignal;
        onUsage?: (event: ModelProviderUsageEvent) => void;
        onUnknownEvent?: (providerEventType: string) => void;
    }
): Promise<CloudChatCompletionOutcome> {
    const runtime = getCloudProviderRuntime();
    if (!runtime) {
        throw new Error('Hosted AI is not configured');
    }

    const systemMessage = messages.find((message) => message.role === 'system');
    const chatMessages = messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content,
        }));

    const controller = registerCloudStreamController(new AbortController());
    const unlinkCallerAbort = linkCloudRequestAbort(options?.signal, controller);

    try {
        if (runtime.provider !== 'anthropic') {
            const result = await streamOpenAiCompatibleChatCompletion({
                runtime,
                messages,
                onToken,
                signal: controller.signal,
                maxTokens: options?.maxTokens,
                onUsage: options?.onUsage,
                onUnknownEvent: options?.onUnknownEvent,
            });
            controller.signal.throwIfAborted();
            if (result.finishReason === 'length') {
                logger.warn('[Cloud AI] stream reached its token limit (output may be incomplete)');
                return incompleteOutcome('length', 'token limit', result.providerRequestId);
            }
            if (result.finishReason === 'refusal') {
                logger.warn('[Cloud AI] stream stopped with reason="refusal" (output may be incomplete)');
                return incompleteOutcome('refusal', 'refusal', result.providerRequestId);
            }
            return { status: 'complete', finishReason: 'stop', providerRequestId: result.providerRequestId };
        }

        let incompleteReason: string | null = null;
        let finishReason: CloudChatCompletionFinishReason = 'stop';
        let providerRequestId: string | null = null;
        let sawTerminalDelta = false;
        let sawMessageStop = false;
        let eventCount = 0;
        let streamedBytes = 0;
        await requestAnthropicStream({
            sessionId: runtime.session_id,
            model: runtime.model || DEFAULT_HOSTED_ANTHROPIC_MODEL,
            maxTokens: options?.maxTokens ?? 2048,
            system: systemMessage?.content ?? 'You are a helpful music production assistant embedded in a DAW.',
            messages: chatMessages,
            signal: controller.signal,
            onEvent: (event) => {
                if (!isRecord(event) || typeof event.type !== 'string') {
                    throw new Error('Hosted AI chat stream returned an invalid event');
                }
                const eventBytes = encodedJsonBytes(event);
                eventCount += 1;
                if (
                    eventBytes > MAX_ANTHROPIC_EVENT_BYTES ||
                    streamedBytes + eventBytes > MAX_ANTHROPIC_STREAM_BYTES ||
                    eventCount > MAX_ANTHROPIC_STREAM_EVENTS
                ) {
                    throw new Error('Hosted AI chat stream exceeded its bounded event or payload limit');
                }
                streamedBytes += eventBytes;
                if (sawMessageStop || (sawTerminalDelta && event.type !== 'message_stop')) {
                    throw new Error('Hosted AI chat stream returned an event after completion');
                }
                if (event.type === 'message_start' && isRecord(event.message)) {
                    providerRequestId ??= readProviderRequestId(event.message.id);
                }
                const usageEvent = readAnthropicUsageEvent(event);
                if (usageEvent) {
                    options?.onUsage?.(usageEvent);
                }
                if (event.type === 'content_block_delta') {
                    if (!isRecord(event.delta) || typeof event.delta.type !== 'string') {
                        throw new Error('Hosted AI chat stream returned an invalid content event');
                    }
                    if (event.delta.type === 'text_delta') {
                        if (typeof event.delta.text !== 'string') {
                            throw new TypeError('Hosted AI chat stream returned invalid text');
                        }
                        onToken(event.delta.text);
                    }
                    return;
                }
                if (event.type === 'message_delta') {
                    if (
                        !isRecord(event.delta) ||
                        (event.delta.stop_reason !== null && typeof event.delta.stop_reason !== 'string')
                    ) {
                        throw new Error('Hosted AI chat stream returned an invalid completion event');
                    }
                    const stopReason = event.delta.stop_reason;
                    if (stopReason !== null) {
                        sawTerminalDelta = true;
                    }
                    if (stopReason !== null && stopReason !== 'end_turn') {
                        logger.warn(`[Cloud AI] stream stopped with reason="${stopReason}" (output may be incomplete)`);
                        incompleteReason = stopReason;
                        finishReason = readAnthropicFinishReason(stopReason);
                    }
                    return;
                }
                if (event.type === 'message_stop') {
                    sawMessageStop = true;
                    return;
                }
                if (
                    event.type !== 'message_start' &&
                    event.type !== 'content_block_start' &&
                    event.type !== 'content_block_stop'
                ) {
                    options?.onUnknownEvent?.(`anthropic:${event.type}`);
                }
            },
        });
        controller.signal.throwIfAborted();
        if (!sawTerminalDelta || !sawMessageStop) {
            throw new Error('Hosted AI chat stream ended unexpectedly');
        }
        if (incompleteReason !== null && finishReason !== 'stop') {
            return incompleteOutcome(finishReason, incompleteReason, providerRequestId);
        }
        return { status: 'complete', finishReason: 'stop', providerRequestId };
    } catch (error) {
        if (isAiRuntimeConfigurationChangedError(controller.signal.reason)) {
            throw controller.signal.reason;
        }
        throw error;
    } finally {
        unlinkCallerAbort();
        unregisterCloudStreamController(controller);
    }
}

function encodedJsonBytes(value: unknown): number {
    let serialized: string | undefined;
    try {
        serialized = JSON.stringify(value);
    } catch {
        throw new TypeError('Hosted AI chat stream returned a non-JSON event');
    }
    if (serialized === undefined) {
        throw new TypeError('Hosted AI chat stream returned a non-JSON event');
    }
    return new TextEncoder().encode(serialized).byteLength;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readNonNegativeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}

function readAnthropicUsageEvent(event: unknown): ModelProviderUsageEvent | null {
    if (!isRecord(event) || typeof event.type !== 'string') {
        return null;
    }
    let usageContainer: Record<string, unknown> | null = null;
    if (event.type === 'message_start' && isRecord(event.message) && isRecord(event.message.usage)) {
        usageContainer = event.message.usage;
    } else if (isRecord(event.usage)) {
        usageContainer = event.usage;
    }
    if (!usageContainer) {
        return null;
    }
    const inputTokens = readNonNegativeInteger(usageContainer.input_tokens);
    const outputTokens = readNonNegativeInteger(usageContainer.output_tokens);
    const cacheCreationInputTokens = readNonNegativeInteger(usageContainer.cache_creation_input_tokens);
    const cacheReadInputTokens = readNonNegativeInteger(usageContainer.cache_read_input_tokens);
    const cachedInputTokens =
        cacheCreationInputTokens === null && cacheReadInputTokens === null
            ? null
            : (cacheCreationInputTokens ?? 0) + (cacheReadInputTokens ?? 0);
    if (inputTokens === null && outputTokens === null && cachedInputTokens === null) {
        return null;
    }
    const totalInputTokens =
        inputTokens === null && cachedInputTokens === null ? null : (inputTokens ?? 0) + (cachedInputTokens ?? 0);
    return {
        type: 'usage',
        mode: event.type === 'message_delta' ? 'final' : 'cumulative-snapshot',
        usage: {
            inputTokens: totalInputTokens,
            outputTokens,
            cachedInputTokens,
            reasoningTokens: null,
        },
        provenance: 'provider-reported',
    };
}
