import { isTauri, tauriInvoke, createChannel } from '#/utils/tauriBridge';

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
    let streamErrorMessage: string | null = null;

    const channel = await createChannel<unknown>();
    channel.onmessage = (event: unknown) => {
        const parsedEvent = narrowSchemaConstrainedStreamEvent(event);
        if (parsedEvent === null) {
            streamErrorMessage = 'Invalid schema_constrained_generation event';
            return;
        }

        if (parsedEvent.event === 'token') {
            result += parsedEvent.data.text;
            input.onToken?.(parsedEvent.data.text);
            return;
        }

        if (parsedEvent.event === 'error') {
            streamErrorMessage = parsedEvent.data.message;
        }
    };

    const invocation = tauriInvoke('schema_constrained_generation', {
        systemPrompt: input.systemPrompt,
        userMessage: input.userMessage,
        jsonSchema: input.jsonSchema,
        temperature: input.temperature ?? 0.1,
        maxTokens: input.maxTokens ?? 2048,
        onEvent: channel,
    });

    await raceWithWatchdog({
        work: invocation,
        timeoutMs: input.timeoutMs ?? DEFAULT_NATIVE_SCHEMA_TIMEOUT_MS,
        signal: input.signal,
    });

    if (streamErrorMessage !== null) {
        throw new Error(streamErrorMessage);
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

type RaceWithWatchdogInput<TWork> = {
    work: Promise<TWork>;
    timeoutMs: number;
    signal?: AbortSignal;
};

type RaceWithWatchdogOutput<TWork> = Promise<TWork>;

async function raceWithWatchdog<TWork>(input: RaceWithWatchdogInput<TWork>): RaceWithWatchdogOutput<TWork> {
    if (input.signal?.aborted) {
        throw new Error('Native schema-constrained generation aborted');
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;

    const guard = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`Native schema-constrained generation timed out after ${String(input.timeoutMs)}ms`));
        }, input.timeoutMs);

        if (input.signal) {
            onAbort = () => {
                reject(new Error('Native schema-constrained generation aborted'));
            };
            input.signal.addEventListener('abort', onAbort, { once: true });
        }
    });

    try {
        return await Promise.race([input.work, guard]);
    } finally {
        if (timer !== undefined) {
            clearTimeout(timer);
        }
        if (input.signal && onAbort) {
            input.signal.removeEventListener('abort', onAbort);
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
