import { isTauri, createChannel } from '#/utils/tauriBridge';

import { type ModelProviderEvent } from '../../models/ModelProviderProtocol';

import { invokeCancelableNativeLlm } from './invokeCancelableNativeLlm';
import { BASE_URL } from './lifecycleState';

type LlmStreamEvent =
    | { event: 'token'; data: { text: string } }
    | { event: 'done'; data: { totalTokens: number } }
    | { event: 'error'; data: { message: string } };

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
    }
): Promise<void> {
    if (isTauri()) {
        const channel = await createChannel<LlmStreamEvent>();

        // Errors thrown inside onmessage (a synchronous callback) do not propagate
        // to the awaiting tauriInvoke call — capture and rethrow after the invoke.
        // This includes an abort thrown from inside `onToken` (e.g. the caller
        // checking signal.aborted): without this catch the throw escapes into the
        // Tauri channel dispatcher and is swallowed, so the stream keeps running.
        const streamState = { error: null as Error | null };
        channel.onmessage = (event: LlmStreamEvent) => {
            if (options?.signal?.aborted) {
                return;
            }
            try {
                if (event.event === 'token') {
                    onToken(event.data.text);
                }
            } catch (tokenError) {
                streamState.error = tokenError instanceof Error ? tokenError : new Error(String(tokenError));
            }
            if (event.event === 'error') {
                streamState.error = new Error(event.data.message);
            }
            if (event.event === 'done' && Number.isSafeInteger(event.data.totalTokens) && event.data.totalTokens >= 0) {
                options?.onUsage?.({
                    type: 'usage',
                    mode: 'final',
                    usage: {
                        inputTokens: null,
                        outputTokens: event.data.totalTokens,
                        cachedInputTokens: null,
                        reasoningTokens: null,
                    },
                    provenance: 'provider-reported',
                });
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
                abortMessage: 'Native completion aborted',
                timeoutMessage: `Native completion timed out after ${String(timeoutMs)}ms`,
            });
        } finally {
            channel.onmessage = () => undefined;
        }

        if (streamState.error) {
            throw streamState.error;
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
        const text = await response.text();
        throw new Error(`llama-server error ${String(response.status)}: ${text}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('No response body');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
        // Stop pulling tokens the moment the caller aborts — previously the loop
        // ran `while (true)` until the server closed the stream, so an aborted
        // request kept delivering tokens and burning the connection.
        while (!signal?.aborted) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) {
                    continue;
                }
                const jsonStr = trimmed.slice(6);
                if (jsonStr === '[DONE]') {
                    return;
                }
                try {
                    const chunk = JSON.parse(jsonStr) as unknown;
                    if (!isRecord(chunk) || !Array.isArray(chunk.choices)) {
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
                    const usage = readUsage(chunk.usage);
                    if (usage) {
                        options?.onUsage?.({
                            type: 'usage',
                            mode: 'final',
                            usage,
                            provenance: 'provider-reported',
                        });
                    }
                } catch {
                    // Skip malformed SSE chunks
                }
            }
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
