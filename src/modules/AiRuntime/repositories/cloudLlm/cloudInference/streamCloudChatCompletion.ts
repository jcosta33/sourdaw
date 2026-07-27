import { logger } from '#/infra/logger/appLogger';

import { isAiRuntimeConfigurationChangedError } from '../../../errors/AiRuntimeConfigurationChangedError';
import { getCloudClient } from '../getCloudClient';
import { getCloudProviderRuntime } from '../getCloudProviderRuntime';
import { linkCloudRequestAbort } from '../linkCloudRequestAbort';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { unregisterCloudStreamController } from '../unregisterCloudStreamController';

import { CLOUD_MODEL } from './helpers';
import { streamOpenAiCompatibleChatCompletion } from './streamOpenAiCompatibleChatCompletion';

export type CloudChatCompletionOutcome = { status: 'complete' } | { status: 'incomplete'; reason: string };

export async function streamCloudChatCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<CloudChatCompletionOutcome> {
    const runtime = getCloudProviderRuntime();
    if (!runtime) {
        throw new Error('Cloud AI not configured. Set API key first.');
    }

    const systemMessage = messages.find((message) => message.role === 'system');
    const chatMessages = messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => ({
            role: message.role as 'user' | 'assistant',
            content: message.content,
        }));

    // Register an abort controller so clearing the API key (key revocation)
    // tears this stream down immediately, rather than letting it keep using the
    // revoked key until the SSE stream closes on its own.
    const controller = registerCloudStreamController(new AbortController());
    const unlinkCallerAbort = linkCloudRequestAbort(options?.signal, controller);

    try {
        if (runtime.provider !== 'anthropic') {
            const finishReason = await streamOpenAiCompatibleChatCompletion({
                runtime,
                messages,
                onToken,
                signal: controller.signal,
                maxTokens: options?.maxTokens,
            });
            controller.signal.throwIfAborted();
            if (finishReason === 'length') {
                logger.warn('[Cloud AI] stream reached its token limit (output may be incomplete)');
                return { status: 'incomplete', reason: 'token limit' };
            }
            return { status: 'complete' };
        }

        const client = getCloudClient();
        if (!client) {
            throw new Error('Anthropic client unavailable');
        }
        const stream = client.messages.stream(
            {
                model: runtime.model || CLOUD_MODEL,
                max_tokens: options?.maxTokens ?? 2048,
                system: systemMessage?.content ?? 'You are a helpful music production assistant embedded in a DAW.',
                messages: chatMessages,
            },
            { signal: controller.signal }
        );

        // Stream-error handling: the Anthropic SDK's MessageStream event union
        // (RawMessageStreamEvent) has NO 'error' member — it is only
        // message_start | message_delta | message_stop | content_block_{start,delta,stop}.
        // An SDK stream error (network drop, API error, abort) is surfaced by the
        // async iterator *rejecting*, so it propagates out of this `for await` as a
        // thrown exception and is caught by the caller's try/catch (sendChatMessage).
        // There is therefore no explicit 'error' branch to add here — guarding for
        // `event.type === 'error'` would be a dead branch that can never run. The
        // `finally` below still runs on the throw, unregistering the controller.
        let incompleteReason: string | null = null;
        let sawTerminalDelta = false;
        let sawMessageStop = false;
        for await (const event of stream) {
            // Text tokens are the visible output.
            if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
                onToken(event.delta.text);
                continue;
            }

            // A non-end_turn stop is the model truncating (e.g. hit max_tokens) or
            // refusing — previously invisible to the caller. Surface it as a
            // diagnostic so a cut-off completion is not silently treated as whole.
            if (event.type === 'message_delta') {
                const stopReason = event.delta.stop_reason;
                if (stopReason !== null) {
                    sawTerminalDelta = true;
                }
                if (stopReason !== null && stopReason !== 'end_turn') {
                    logger.warn(`[Cloud AI] stream stopped with reason="${stopReason}" (output may be incomplete)`);
                    incompleteReason = stopReason;
                }
                continue;
            }
            if (event.type === 'message_stop') {
                sawMessageStop = true;
            }
        }
        controller.signal.throwIfAborted();
        if (!sawTerminalDelta || !sawMessageStop) {
            throw new Error('Hosted AI chat stream ended unexpectedly');
        }
        if (incompleteReason !== null) {
            return { status: 'incomplete', reason: incompleteReason };
        }
        return { status: 'complete' };
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
