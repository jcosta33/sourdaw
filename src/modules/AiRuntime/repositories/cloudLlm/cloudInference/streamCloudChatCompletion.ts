import { logger } from '#/infra/logger/appLogger';

import { getCloudClient } from '../getCloudClient';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { unregisterCloudStreamController } from '../unregisterCloudStreamController';

import { CLOUD_MODEL } from './helpers';

export async function streamCloudChatCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: { temperature?: number; maxTokens?: number }
): Promise<void> {
    const client = getCloudClient();
    if (!client) {
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

    try {
        const stream = client.messages.stream(
            {
                model: CLOUD_MODEL,
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
                if (stopReason !== null && stopReason !== 'end_turn') {
                    logger.warn(`[Cloud AI] stream stopped with reason="${stopReason}" (output may be incomplete)`);
                }
            }
        }
    } finally {
        unregisterCloudStreamController(controller);
    }
}
