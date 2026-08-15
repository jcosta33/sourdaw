import { describe, it, expect, vi, beforeEach } from 'vitest';

import { streamNativeCompletion } from '../streaming';

type TestChannel = {
    onmessage: ((event: { event: string; data: Record<string, unknown> }) => void) | null;
};

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
    createChannel: vi.fn(),
    fetch: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
    tauriInvoke: mocks.tauriInvoke,
    createChannel: mocks.createChannel,
}));

vi.stubGlobal('fetch', mocks.fetch);

function getInvocationArgs(callIndex: number): Record<string, unknown> {
    const call: unknown = mocks.tauriInvoke.mock.calls[callIndex];
    if (!Array.isArray(call)) {
        throw new TypeError(`Expected invocation arguments for call ${String(callIndex)}`);
    }
    const args: unknown = call[1];
    if (!isRecord(args)) {
        throw new TypeError(`Expected invocation arguments for call ${String(callIndex)}`);
    }
    return args;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function emitNativeEvent(
    channel: TestChannel,
    invocationArgs: Record<string, unknown>,
    sequence: number,
    event: string,
    data: Record<string, unknown>
): void {
    channel.onmessage?.({
        event,
        data: { ...data, requestId: invocationArgs.requestId, sequence },
    });
}

describe('streamNativeCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('when running in Tauri', () => {
        beforeEach(() => {
            mocks.isTauri.mockReturnValue(true);
        });

        it('creates a channel and invokes streaming command', async () => {
            const mockChannel: TestChannel = { onmessage: null };
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockImplementation((command: string, args: Record<string, unknown>) => {
                if (command === 'stream_native_completion') {
                    emitNativeEvent(mockChannel, args, 0, 'token', { text: 'Hi' });
                    emitNativeEvent(mockChannel, args, 1, 'done', {
                        promptTokens: 0,
                        completionTokens: 1,
                        finishReason: 'stop',
                    });
                }
                return Promise.resolve(undefined);
            });

            const onToken = vi.fn();
            const messages = [
                { role: 'system', content: 'You are a bot.' },
                { role: 'user', content: 'Hello' },
            ];

            await streamNativeCompletion(messages, onToken);

            expect(mocks.createChannel).toHaveBeenCalled();
            expect(mocks.tauriInvoke.mock.calls[0]?.[0]).toBe('stream_native_completion');
            const invocationArgs = getInvocationArgs(0);
            expect(invocationArgs).toEqual({
                systemPrompt: 'You are a bot.',
                messages: [{ role: 'user', content: 'Hello' }],
                temperature: 0.7,
                maxTokens: 2048,
                onEvent: mockChannel,
                requestId: invocationArgs.requestId,
            });
            expect(typeof invocationArgs.requestId).toBe('string');
            expect(onToken).toHaveBeenCalledWith('Hi');
        });

        it('emits exact provider-reported final usage from the native done event', async () => {
            const mockChannel: TestChannel = { onmessage: null };
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockImplementation((_command: string, args: Record<string, unknown>) => {
                emitNativeEvent(mockChannel, args, 0, 'done', {
                    promptTokens: 11,
                    completionTokens: 17,
                    finishReason: 'stop',
                });
                return Promise.resolve(undefined);
            });
            const onUsage = vi.fn();
            const onFinish = vi.fn();

            await streamNativeCompletion([{ role: 'user', content: 'hi' }], vi.fn(), { onUsage, onFinish });

            expect(onUsage).toHaveBeenCalledWith({
                type: 'usage',
                mode: 'final',
                usage: {
                    inputTokens: 11,
                    outputTokens: 17,
                    cachedInputTokens: null,
                    reasoningTokens: null,
                },
                provenance: 'provider-reported',
            });
            expect(onFinish).toHaveBeenCalledWith('stop');
        });

        it('surfaces unknown native events without exposing their payload', async () => {
            const mockChannel: TestChannel = { onmessage: null };
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockImplementation((_command: string, args: Record<string, unknown>) => {
                emitNativeEvent(mockChannel, args, 0, 'future_native_event', { private: 'not-forwarded' });
                emitNativeEvent(mockChannel, args, 1, 'done', {
                    promptTokens: 0,
                    completionTokens: 0,
                    finishReason: 'stop',
                });
                return Promise.resolve(undefined);
            });
            const onUnknownEvent = vi.fn();

            await streamNativeCompletion([{ role: 'user', content: 'hi' }], vi.fn(), { onUnknownEvent });

            expect(onUnknownEvent).toHaveBeenCalledWith('native:future_native_event');
        });

        it('propagates an abort thrown from inside onToken instead of swallowing it', async () => {
            // Regression: when onToken throws (e.g. the caller checks an abort
            // signal and throws), the throw escapes the Tauri channel dispatcher
            // and is lost. It must be captured and rethrown after the invoke.
            const mockChannel: TestChannel = { onmessage: null };
            mocks.createChannel.mockResolvedValue(mockChannel);

            // Faithfully model the Tauri channel dispatcher: it invokes
            // onmessage and SWALLOWS any throw, then the command resolves
            // normally. So a throw from onToken is lost unless streamNativeCompletion
            // captures it into streamState.error itself.
            mocks.tauriInvoke.mockImplementation((_command: string, args: Record<string, unknown>) => {
                try {
                    emitNativeEvent(mockChannel, args, 0, 'token', { text: 'partial' });
                } catch {
                    // dispatcher swallows — exactly the production behavior we guard against
                }
                return Promise.resolve(undefined);
            });

            const onToken = vi.fn(() => {
                throw new Error('AbortedByUser');
            });

            await expect(streamNativeCompletion([{ role: 'user', content: 'hi' }], onToken)).rejects.toThrow(
                'AbortedByUser'
            );
        });

        it('rejects when the native invoke exceeds the watchdog timeout', async () => {
            vi.useFakeTimers();
            try {
                const mockChannel: TestChannel = { onmessage: null };
                mocks.createChannel.mockResolvedValue(mockChannel);
                // Invoke never resolves — simulate a hung backend.
                mocks.tauriInvoke.mockReturnValue(new Promise<void>(() => undefined));

                const promise = streamNativeCompletion([{ role: 'user', content: 'hi' }], vi.fn(), {
                    timeoutMs: 5000,
                });
                const assertion = expect(promise).rejects.toThrow('timed out after 5000ms');

                await vi.advanceTimersByTimeAsync(5000);
                await assertion;
            } finally {
                vi.useRealTimers();
            }
        });

        it('rejects when the abort signal fires before the native invoke resolves', async () => {
            const mockChannel: TestChannel = { onmessage: null };
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockReturnValue(new Promise<void>(() => undefined));

            const aborter = new AbortController();
            const onToken = vi.fn();
            const promise = streamNativeCompletion([{ role: 'user', content: 'hi' }], onToken, {
                signal: aborter.signal,
            });
            await vi.waitFor(() => expect(mocks.tauriInvoke).toHaveBeenCalledTimes(1));
            aborter.abort();

            await expect(promise).rejects.toThrow('aborted');
            expect(mocks.tauriInvoke.mock.calls[1]?.[0]).toBe('cancel_native_llm_generation');
            expect(getInvocationArgs(1).requestId).toBe(getInvocationArgs(0).requestId);
            mockChannel.onmessage?.({ event: 'token', data: { text: 'late' } });
            expect(onToken).not.toHaveBeenCalled();
        });

        it('rejects a cross-request event before exposing its token', async () => {
            const mockChannel: TestChannel = { onmessage: null };
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockImplementation(() => {
                mockChannel.onmessage?.({
                    event: 'token',
                    data: { requestId: 'another-request', sequence: 0, text: 'private' },
                });
                return Promise.resolve(undefined);
            });
            const onToken = vi.fn();

            await expect(streamNativeCompletion([{ role: 'user', content: 'hi' }], onToken)).rejects.toThrow(
                'cross-request or out-of-order'
            );
            expect(onToken).not.toHaveBeenCalled();
        });

        it('closes and cancels the native stream after the first rejected envelope', async () => {
            const mockChannel: TestChannel = { onmessage: null };
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockImplementation((command: string, args: Record<string, unknown>) => {
                if (command === 'stream_native_completion') {
                    emitNativeEvent(mockChannel, args, 1, 'token', { text: 'invalid' });
                    emitNativeEvent(mockChannel, args, 0, 'token', { text: 'must-not-be-exposed' });
                }
                return Promise.resolve(undefined);
            });
            const onToken = vi.fn();

            await expect(streamNativeCompletion([{ role: 'user', content: 'hi' }], onToken)).rejects.toThrow(
                'cross-request or out-of-order'
            );

            expect(onToken).not.toHaveBeenCalled();
            expect(mocks.tauriInvoke.mock.calls[1]?.[0]).toBe('cancel_native_llm_generation');
            expect(getInvocationArgs(1).requestId).toBe(getInvocationArgs(0).requestId);
        });

        it('rejects and cancels a malformed known event before a valid same-sequence token', async () => {
            const mockChannel: TestChannel = { onmessage: null };
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockImplementation((command: string, args: Record<string, unknown>) => {
                if (command === 'stream_native_completion') {
                    emitNativeEvent(mockChannel, args, 0, 'token', { text: 12 });
                    emitNativeEvent(mockChannel, args, 0, 'token', { text: 'must-not-be-exposed' });
                }
                return Promise.resolve(undefined);
            });
            const onToken = vi.fn();

            await expect(streamNativeCompletion([{ role: 'user', content: 'hi' }], onToken)).rejects.toThrow(
                'invalid token event'
            );
            expect(onToken).not.toHaveBeenCalled();
            expect(mocks.tauriInvoke.mock.calls[1]?.[0]).toBe('cancel_native_llm_generation');
        });
    });

    describe('when running in browser (dev mode)', () => {
        beforeEach(() => {
            mocks.isTauri.mockReturnValue(false);
        });

        it('fetches SSE stream and parses tokens', async () => {
            const encoder = new TextEncoder();

            // Create a mock stream chunk reader
            const mockReadChunks = [
                encoder.encode('data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'),
                encoder.encode('data: {"choices": [{"delta": {"content": " World"}}]}\n\n'),
                encoder.encode('data: {"choices": [{"delta": {}, "finish_reason": "stop"}]}\n\n'),
                encoder.encode('data: [DONE]\n\n'),
            ];

            let readIndex = 0;
            const mockReader = {
                read: vi.fn().mockImplementation(() => {
                    if (readIndex < mockReadChunks.length) {
                        return Promise.resolve({ done: false, value: mockReadChunks[readIndex++] });
                    }
                    return Promise.resolve({ done: true, value: undefined });
                }),
                cancel: vi.fn().mockResolvedValue(undefined),
            };

            mocks.fetch.mockResolvedValue({
                ok: true,
                body: { getReader: () => mockReader },
            });

            const tokens: string[] = [];
            function onToken(time: string) {
                tokens.push(time);
            }

            await streamNativeCompletion([{ role: 'user', content: 'hi' }], onToken);

            expect(mocks.fetch).toHaveBeenCalled();
            expect(tokens).toEqual(['Hello', ' World']);
        });

        it('throws an error if fetch fails', async () => {
            const cancel = vi.fn();
            mocks.fetch.mockResolvedValue(
                new Response(new ReadableStream<Uint8Array>({ cancel }), {
                    status: 404,
                })
            );

            await expect(streamNativeCompletion([], vi.fn<(...args: unknown[]) => void>())).rejects.toThrow(
                'llama-server error 404'
            );
            expect(cancel).toHaveBeenCalledTimes(1);
        });

        it('rejects malformed SSE instead of skipping it', async () => {
            const encoder = new TextEncoder();
            const mockReader = {
                read: vi
                    .fn()
                    .mockResolvedValueOnce({ done: false, value: encoder.encode('data: {invalid}\n\n') })
                    .mockResolvedValue({ done: true, value: undefined }),
                cancel: vi.fn().mockResolvedValue(undefined),
            };
            mocks.fetch.mockResolvedValue({ ok: true, body: { getReader: () => mockReader } });

            await expect(streamNativeCompletion([], vi.fn())).rejects.toThrow('invalid JSON');
        });

        it.each(['{"choices":[{}]}', '{"choices":[]}', '{"choices":[{"delta":12,"finish_reason":"stop"}]}'])(
            'rejects malformed known choices event %s before later valid output',
            async (malformedEvent) => {
                const encoder = new TextEncoder();
                const payload = [
                    `data: ${malformedEvent}\n\n`,
                    'data: {"choices":[{"delta":{"content":"must-not-be-exposed"}}]}\n\n',
                    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
                    'data: [DONE]\n\n',
                ].join('');
                const reader = {
                    read: vi
                        .fn()
                        .mockResolvedValueOnce({ done: false, value: encoder.encode(payload) })
                        .mockResolvedValue({ done: true, value: undefined }),
                    cancel: vi.fn().mockResolvedValue(undefined),
                };
                mocks.fetch.mockResolvedValue({ ok: true, body: { getReader: () => reader } });
                const onToken = vi.fn();

                await expect(streamNativeCompletion([], onToken)).rejects.toThrow('invalid choices event');
                expect(onToken).not.toHaveBeenCalled();
                expect(reader.cancel).toHaveBeenCalledTimes(1);
            }
        );

        it('rejects browser-native text after the first finish reason before exposing it', async () => {
            const encoder = new TextEncoder();
            const chunks = [
                encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n'),
                encoder.encode('data: {"choices":[{"delta":{"content":"late"}}]}\n\n'),
                encoder.encode('data: [DONE]\n\n'),
            ];
            const reader = {
                read: vi
                    .fn()
                    .mockResolvedValueOnce({ done: false, value: chunks[0] })
                    .mockResolvedValueOnce({ done: false, value: chunks[1] })
                    .mockResolvedValueOnce({ done: false, value: chunks[2] })
                    .mockResolvedValue({ done: true, value: undefined }),
                cancel: vi.fn().mockResolvedValue(undefined),
            };
            mocks.fetch.mockResolvedValue({ ok: true, body: { getReader: () => reader } });
            const onToken = vi.fn();

            await expect(streamNativeCompletion([], onToken)).rejects.toThrow('after completion');
            expect(onToken).not.toHaveBeenCalled();
        });

        it('rejects browser-native unknown and repeated usage events after completion', async () => {
            const encoder = new TextEncoder();
            const eventPayloads = [
                ['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: {"type":"late-event"}\n\n'],
                [
                    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
                    'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
                    'data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n',
                ],
            ];

            for (const payloads of eventPayloads) {
                const reader = {
                    read: vi
                        .fn()
                        .mockResolvedValueOnce({ done: false, value: encoder.encode(payloads.join('')) })
                        .mockResolvedValue({ done: true, value: undefined }),
                    cancel: vi.fn().mockResolvedValue(undefined),
                };
                mocks.fetch.mockResolvedValueOnce({ ok: true, body: { getReader: () => reader } });
                const onUsage = vi.fn();
                const onUnknownEvent = vi.fn();

                await expect(streamNativeCompletion([], vi.fn(), { onUsage, onUnknownEvent })).rejects.toThrow(
                    'after completion'
                );
                expect(onUnknownEvent).not.toHaveBeenCalled();
                expect(onUsage.mock.calls.length).toBeLessThanOrEqual(1);
            }
        });

        it('throws if no body is returned', async () => {
            mocks.fetch.mockResolvedValue({
                ok: true,
                body: null,
            });

            await expect(streamNativeCompletion([], vi.fn<(...args: unknown[]) => void>())).rejects.toThrow(
                'No response body'
            );
        });

        it('stops pulling tokens and cancels the reader once the signal is aborted', async () => {
            // Regression: the SSE while(true) loop had no abort plumbing, so an
            // aborted request kept reading and delivering tokens. The loop must
            // break on abort and release the reader.
            const encoder = new TextEncoder();
            const aborter = new AbortController();

            const cancel = vi.fn().mockResolvedValue(undefined);
            let readCount = 0;
            const mockReader = {
                read: vi.fn().mockImplementation(() => {
                    readCount += 1;
                    // First read yields a token, then the caller aborts.
                    if (readCount === 1) {
                        return Promise.resolve({
                            done: false,
                            value: encoder.encode('data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'),
                        });
                    }
                    // The loop should break before issuing further reads.
                    return Promise.resolve({
                        done: false,
                        value: encoder.encode('data: {"choices": [{"delta": {"content": " World"}}]}\n\n'),
                    });
                }),
                cancel,
            };

            mocks.fetch.mockResolvedValue({
                ok: true,
                body: { getReader: () => mockReader },
            });

            const tokens: string[] = [];
            await streamNativeCompletion(
                [{ role: 'user', content: 'hi' }],
                (token) => {
                    tokens.push(token);
                    aborter.abort(); // abort after the first token
                },
                { signal: aborter.signal }
            );

            expect(tokens).toEqual(['Hello']);
            expect(cancel).toHaveBeenCalledTimes(1);
            // The abort check sits at the top of the loop, so at most one further
            // read is issued before the break — never the full stream.
            expect(mockReader.read.mock.calls.length).toBeLessThanOrEqual(2);
        });
    });
});
