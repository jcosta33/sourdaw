import { isTauri, createChannel, tauriInvoke } from '#/utils/tauriBridge';

import { invokeCancelableNativeLlm } from './invokeCancelableNativeLlm';

type SchemaConstrainedStreamEvent =
    | { event: 'token'; data: { requestId: string; sequence: number; text: string } }
    | { event: 'done'; data: { requestId: string; sequence: number } }
    | { event: 'error'; data: { requestId: string; sequence: number; message: string } }
    | { event: 'unknown'; data: { requestId: string; sequence: number } };

const DEFAULT_NATIVE_SCHEMA_TIMEOUT_MS = 120_000;

type GenerateSchemaConstrainedNativeCompletionInput = {
    systemPrompt: string;
    userMessage: string;
    jsonSchema: string;
    temperature?: number;
    maxTokens?: number;
    onToken?: (text: string) => void;
    signal?: AbortSignal;
    timeoutMs?: number;
};

type GenerateSchemaConstrainedNativeCompletionOutput = Promise<string | null>;

export async function generateSchemaConstrainedNativeCompletion(
    input: GenerateSchemaConstrainedNativeCompletionInput
): GenerateSchemaConstrainedNativeCompletionOutput {
    if (!isTauri()) {
        return null;
    }

    let result = '';
    const requestId = crypto.randomUUID();
    const streamState = { error: null as Error | null, nextSequence: 0, terminal: false, bytes: 0 };

    function rejectStream(error: Error): void {
        if (streamState.error !== null) {
            return;
        }
        streamState.error = error;
        streamState.terminal = true;
        void tauriInvoke('cancel_native_llm_generation', { requestId }).catch(() => undefined);
    }

    const channel = await createChannel<unknown>();
    channel.onmessage = (event: unknown) => {
        if (input.signal?.aborted || streamState.error !== null) {
            return;
        }
        const parsedEvent = narrowSchemaConstrainedStreamEvent(event, requestId, streamState.nextSequence);
        if (parsedEvent === null) {
            rejectStream(new Error('Invalid schema_constrained_generation event'));
            return;
        }
        if (streamState.terminal || streamState.nextSequence >= 4_096) {
            rejectStream(new Error('Invalid schema_constrained_generation event sequence'));
            return;
        }
        streamState.nextSequence += 1;

        if (parsedEvent.event === 'token') {
            const eventBytes = new TextEncoder().encode(parsedEvent.data.text).byteLength;
            streamState.bytes += eventBytes;
            if (eventBytes > 64 * 1_024 || streamState.bytes > 1_024 * 1_024) {
                rejectStream(new Error('Schema-constrained generation exceeded its payload limit'));
                return;
            }
            try {
                result += parsedEvent.data.text;
                input.onToken?.(parsedEvent.data.text);
            } catch (error) {
                rejectStream(error instanceof Error ? error : new Error(String(error)));
            }
            return;
        }

        if (parsedEvent.event === 'error') {
            streamState.error = new Error(parsedEvent.data.message);
            streamState.terminal = true;
            return;
        }
        if (parsedEvent.event === 'done') {
            streamState.terminal = true;
        }
    };

    try {
        await invokeCancelableNativeLlm({
            command: 'schema_constrained_generation',
            args: {
                systemPrompt: input.systemPrompt,
                userMessage: input.userMessage,
                jsonSchema: input.jsonSchema,
                temperature: input.temperature ?? 0.1,
                maxTokens: input.maxTokens ?? 2048,
                onEvent: channel,
            },
            timeoutMs: input.timeoutMs ?? DEFAULT_NATIVE_SCHEMA_TIMEOUT_MS,
            signal: input.signal,
            requestId,
            abortMessage: 'Native schema-constrained generation aborted',
            timeoutMessage: `Native schema-constrained generation timed out after ${String(
                input.timeoutMs ?? DEFAULT_NATIVE_SCHEMA_TIMEOUT_MS
            )}ms`,
        });
    } finally {
        channel.onmessage = () => undefined;
    }

    if (streamState.error !== null) {
        throw streamState.error;
    }
    if (!streamState.terminal) {
        throw new Error('Schema-constrained generation ended without one terminal event');
    }

    return result;
}

function narrowSchemaConstrainedStreamEvent(
    event: unknown,
    requestId: string,
    sequence: number
): SchemaConstrainedStreamEvent | null {
    if (!isRecord(event)) {
        return null;
    }

    const eventName = event.event;
    const data = event.data;
    if (!isRecord(data)) {
        return null;
    }
    if (data.requestId !== requestId || data.sequence !== sequence || !Number.isSafeInteger(data.sequence)) {
        return null;
    }

    if (eventName === 'token' && typeof data.text === 'string') {
        return { event: 'token', data: { requestId, sequence, text: data.text } };
    }
    if (eventName === 'done') {
        return { event: 'done', data: { requestId, sequence } };
    }
    if (eventName === 'error' && typeof data.message === 'string') {
        return { event: 'error', data: { requestId, sequence, message: data.message } };
    }
    if (typeof eventName === 'string' && eventName !== 'token' && eventName !== 'done' && eventName !== 'error') {
        return { event: 'unknown', data: { requestId, sequence } };
    }

    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
