import { isTauri, createChannel } from '#/utils/tauriBridge';

import { invokeCancelableNativeLlm } from './invokeCancelableNativeLlm';

type SchemaConstrainedStreamEvent =
    { event: 'token'; data: { text: string } } | { event: 'done' } | { event: 'error'; data: { message: string } };

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
    const streamState = { errorMessage: null as string | null };

    const channel = await createChannel<unknown>();
    channel.onmessage = (event: unknown) => {
        if (input.signal?.aborted) {
            return;
        }
        const parsedEvent = narrowSchemaConstrainedStreamEvent(event);
        if (parsedEvent === null) {
            streamState.errorMessage = 'Invalid schema_constrained_generation event';
            return;
        }

        if (parsedEvent.event === 'token') {
            result += parsedEvent.data.text;
            input.onToken?.(parsedEvent.data.text);
            return;
        }

        if (parsedEvent.event === 'error') {
            streamState.errorMessage = parsedEvent.data.message;
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
            abortMessage: 'Native schema-constrained generation aborted',
            timeoutMessage: `Native schema-constrained generation timed out after ${String(
                input.timeoutMs ?? DEFAULT_NATIVE_SCHEMA_TIMEOUT_MS
            )}ms`,
        });
    } finally {
        channel.onmessage = () => undefined;
    }

    if (streamState.errorMessage !== null) {
        throw new Error(streamState.errorMessage);
    }

    return result;
}

function narrowSchemaConstrainedStreamEvent(event: unknown): SchemaConstrainedStreamEvent | null {
    if (!isRecord(event)) {
        return null;
    }

    const eventName = event.event;
    const data = event.data;
    if (!isRecord(data)) {
        return null;
    }

    if (eventName === 'token' && typeof data.text === 'string') {
        return { event: 'token', data: { text: data.text } };
    }
    if (eventName === 'done') {
        return { event: 'done' };
    }
    if (eventName === 'error' && typeof data.message === 'string') {
        return { event: 'error', data: { message: data.message } };
    }

    return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
