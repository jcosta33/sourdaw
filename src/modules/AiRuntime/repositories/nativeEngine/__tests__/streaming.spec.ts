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
            mocks.tauriInvoke.mockImplementation((command: string) => {
                if (command === 'stream_native_completion') {
                    mockChannel.onmessage?.({ event: 'token', data: { text: 'Hi' } });
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
            mocks.tauriInvoke.mockImplementation(() => {
                mockChannel.onmessage?.({
                    event: 'done',
                    data: { promptTokens: 11, completionTokens: 17, finishReason: 'stop' },
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
            mocks.tauriInvoke.mockImplementation(() => {
                mockChannel.onmessage?.({ event: 'future_native_event', data: { private: 'not-forwarded' } });
                mockChannel.onmessage?.({ event: 'done', data: { totalTokens: 0 } });
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
            mocks.tauriInvoke.mockImplementation(() => {
                try {
                    mockChannel.onmessage?.({ event: 'token', data: { text: 'partial' } });
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
            mocks.fetch.mockResolvedValue({
                ok: false,
                status: 404,
                text: () => Promise.resolve('Not Found'),
            });

            await expect(streamNativeCompletion([], vi.fn<(...args: unknown[]) => void>())).rejects.toThrow(
                'llama-server error 404: Not Found'
            );
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
