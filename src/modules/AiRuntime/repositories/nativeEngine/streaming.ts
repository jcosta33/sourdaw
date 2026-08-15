import { isTauri, createChannel, tauriInvoke } from '#/utils/tauriBridge';

import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';

import { invokeCancelableNativeLlm } from './invokeCancelableNativeLlm';
import { BASE_URL } from './lifecycleState';

type ModelProviderUsageEvent = Extract<ModelProviderEvent, { type: 'usage' }>;

/** Default watchdog: abort a native invoke that produces no resolution in time. */
const DEFAULT_NATIVE_TIMEOUT_MS = 120_000;

/**
 * Streaming completion.
 * In Tauri: in-process streaming via mistral.rs + Tauri Channel.
 * In browser dev mode: SSE from localhost llama-server.
 *
 * `options.signal` lets a caller abort: the browser SSE loop stops pulling
 * tokens and cancels the reader, and the native invoke is raced against the
 * signal. `options.timeoutMs` bounds the native invoke so a hung backend
 * cannot leave the await pending forever.
 */
export async function streamNativeCompletion(
    messages: Array<{ role: string; content: string }>,
    onToken: (text: string) => void,
    options?: {
        temperature?: number;
        maxTokens?: number;
        signal?: AbortSignal;
        timeoutMs?: number;
        onUsage?: (event: ModelProviderUsageEvent) => void;
        onUnknownEvent?: (providerEventType: string) => void;
        onFinish?: (finishReason: 'stop' | 'length') => void;
    }
): Promise<void> {
    if (isTauri()) {
        const channel = await createChannel<unknown>();
        const requestId = crypto.randomUUID();

        // Errors thrown inside onmessage (a synchronous callback) do not propagate
        // to the awaiting tauriInvoke call — capture and rethrow after the invoke.
        // This includes an abort thrown from inside `onToken` (e.g. the caller
        // checking signal.aborted): without this catch the throw escapes into the
        // Tauri channel dispatcher and is swallowed, so the stream keeps running.
        const streamState = {
            error: null as Error | null,
            nextSequence: 0,
            terminal: false,
            bytes: 0,
        };
        function rejectNativeStream(error: Error): void {
            if (streamState.error !== null) {
                return;
            }
            streamState.error = error;
            streamState.terminal = true;
            void tauriInvoke('cancel_native_llm_generation', { requestId }).catch(() => undefined);
        }
        channel.onmessage = (event: unknown) => {
            if (options?.signal?.aborted || streamState.error !== null) {
                return;
            }
            if (!isRecord(event) || typeof event.event !== 'string' || !isRecord(event.data)) {
                rejectNativeStream(new TypeError('Native provider returned an invalid stream envelope'));
                return;
            }
            if (
                event.data.requestId !== requestId ||
                event.data.sequence !== streamState.nextSequence ||
                !Number.isSafeInteger(event.data.sequence) ||
                streamState.terminal
            ) {
                rejectNativeStream(new TypeError('Native provider returned a cross-request or out-of-order event'));
                return;
            }
            try {
                if (event.event === 'token' && typeof event.data.text === 'string') {
                    const eventBytes = new TextEncoder().encode(event.data.text).byteLength;
                    if (eventBytes > 64 * 1_024 || streamState.bytes + eventBytes > 1_024 * 1_024) {
                        throw new TypeError('Native provider stream exceeded its payload limit');
                    }
                    onToken(event.data.text);
                    streamState.bytes += eventBytes;
                    streamState.nextSequence += 1;
                }
            } catch (tokenError) {
                rejectNativeStream(tokenError instanceof Error ? tokenError : new Error(String(tokenError)));
                return;
            }
            if (event.event === 'error' && typeof event.data.message === 'string') {
                streamState.error = new Error(event.data.message);
                streamState.terminal = true;
                streamState.nextSequence += 1;
            }
            if (
                event.event === 'done' &&
                typeof event.data.finishReason === 'string' &&
                (event.data.finishReason === 'stop' || event.data.finishReason === 'length')
            ) {
                const inputTokens = readNonNegativeInteger(event.data.promptTokens);
                const outputTokens = readNonNegativeInteger(event.data.completionTokens);
                if (inputTokens !== null && outputTokens !== null) {
                    options?.onUsage?.({
                        type: 'usage',
                        mode: 'final',
                        usage: {
                            inputTokens,
                            outputTokens,
                            cachedInputTokens: null,
                            reasoningTokens: null,
                        },
                        provenance: 'provider-reported',
                    });
                }
                options?.onFinish?.(event.data.finishReason);
                streamState.terminal = true;
                streamState.nextSequence += 1;
            }
            if (event.event !== 'token' && event.event !== 'error' && event.event !== 'done') {
                options?.onUnknownEvent?.(`native:${event.event}`);
                streamState.nextSequence += 1;
            }
        };

        const systemPrompt = messages.find((message) => message.role === 'system')?.content ?? '';
        const nonSystemMessages = messages.filter((message) => message.role !== 'system');

        const timeoutMs = options?.timeoutMs ?? DEFAULT_NATIVE_TIMEOUT_MS;
        try {
            await invokeCancelableNativeLlm({
                command: 'stream_native_completion',
                args: {
                    systemPrompt,
                    messages: nonSystemMessages,
                    temperature: options?.temperature ?? 0.7,
                    maxTokens: options?.maxTokens ?? 2048,
                    onEvent: channel,
                },
                timeoutMs,
                signal: options?.signal,
                requestId,
                abortMessage: 'Native completion aborted',
                timeoutMessage: `Native completion timed out after ${String(timeoutMs)}ms`,
            });
        } finally {
            channel.onmessage = () => undefined;
        }

        if (streamState.error) {
            throw streamState.error;
        }
        if (!streamState.terminal) {
            throw new Error('Native provider stream ended without one terminal event');
        }
        return;
    }

    // Browser dev mode: SSE from llama-server
    const signal = options?.signal;
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 2048,
            seed: 0,
            stream: true,
        }),
        // Let fetch tear down the connection itself when the caller aborts.
        signal,
    });

    if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`llama-server error ${String(response.status)}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let streamBytes = 0;
    let eventCount = 0;
    let finishReasonSeen = false;

    try {
        // Stop pulling tokens the moment the caller aborts — previously the loop
        // ran `while (true)` until the server closed the stream, so an aborted
        // request kept delivering tokens and burning the connection.
        while (!signal?.aborted) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            streamBytes += value.byteLength;
            if (!Number.isSafeInteger(streamBytes) || streamBytes > 1_024 * 1_024) {
                throw new TypeError('Native completion stream exceeded its payload limit');
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            if (new TextEncoder().encode(buffer).byteLength > 64 * 1_024) {
                throw new TypeError('Native completion stream exceeded its event limit');
            }

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) {
                    continue;
                }
                const jsonStr = trimmed.slice(6);
                eventCount += 1;
                if (eventCount > 4_096 || new TextEncoder().encode(jsonStr).byteLength > 64 * 1_024) {
                    throw new TypeError('Native completion stream exceeded its event limit');
                }
                if (jsonStr === '[DONE]') {
                    if (!finishReasonSeen) {
                        throw new TypeError('Native completion stream ended without a finish reason');
                    }
                    return;
                }
                let chunk: unknown;
                try {
                    chunk = JSON.parse(jsonStr) as unknown;
                } catch {
                    throw new TypeError('Native completion stream returned invalid JSON');
                }
                if (!isRecord(chunk)) {
                    throw new TypeError('Native completion stream returned an invalid event');
                }
                if (!Array.isArray(chunk.choices)) {
                    options?.onUnknownEvent?.(`native:${typeof chunk.type === 'string' ? chunk.type : 'unknown'}`);
                    continue;
                }
                const firstChoice: unknown = chunk.choices[0];
                const content =
                    isRecord(firstChoice) &&
                    isRecord(firstChoice.delta) &&
                    typeof firstChoice.delta.content === 'string'
                        ? firstChoice.delta.content
                        : undefined;
                if (content) {
                    onToken(content);
                }
                const finishReason = isRecord(firstChoice) ? firstChoice.finish_reason : undefined;
                if (finishReason === 'stop' || finishReason === 'length') {
                    if (finishReasonSeen) {
                        throw new TypeError('Native completion stream returned duplicate completion');
                    }
                    finishReasonSeen = true;
                    options?.onFinish?.(finishReason);
                } else if (typeof finishReason === 'string') {
                    throw new TypeError(
                        `Native completion stream ended with unsupported finish reason ${finishReason}`
                    );
                }
                const usage = readUsage(chunk.usage);
                if (usage) {
                    options?.onUsage?.({
                        type: 'usage',
                        mode: 'final',
                        usage,
                        provenance: 'provider-reported',
                    });
                }
            }
        }
        if (!signal?.aborted) {
            throw new TypeError('Native completion stream ended without one terminal event');
        }
    } finally {
        // Release the underlying stream so an aborted/early-broken loop does not
        // leave the reader (and socket) dangling.
        await reader.cancel().catch(() => undefined);
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
    return {
        inputTokens,
        outputTokens,
        cachedInputTokens: null,
        reasoningTokens: null,
    };
}

function readNonNegativeInteger(value: unknown): number | null {
    return Number.isSafeInteger(value) && typeof value === 'number' && value >= 0 ? value : null;
}
