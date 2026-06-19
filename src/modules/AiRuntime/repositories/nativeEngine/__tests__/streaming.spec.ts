import { describe, it, expect, vi, beforeEach } from 'vitest';

import { streamNativeCompletion } from '../streaming';

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

describe('streamNativeCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('when running in Tauri', () => {
        beforeEach(() => {
            mocks.isTauri.mockReturnValue(true);
        });

        it('creates a channel and invokes streaming command', async () => {
            const mockChannel = { onmessage: null } as any;
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockResolvedValue(undefined);

            const onToken = vi.fn();
            const messages = [
                { role: 'system', content: 'You are a bot.' },
                { role: 'user', content: 'Hello' },
            ];

            await streamNativeCompletion(messages, onToken);

            expect(mocks.createChannel).toHaveBeenCalled();
            expect(mocks.tauriInvoke).toHaveBeenCalledWith('stream_native_completion', {
                systemPrompt: 'You are a bot.',
                messages: [{ role: 'user', content: 'Hello' }],
                temperature: 0.7,
                maxTokens: 2048,
                onEvent: mockChannel,
            });

            // Simulate events
            mockChannel.onmessage({ event: 'token', data: { text: 'Hi' } });
            expect(onToken).toHaveBeenCalledWith('Hi');

            // Error events are captured synchronously but rethrown after
            // tauriInvoke resolves, so calling onmessage doesn't throw inline.
            expect(() => {
                mockChannel.onmessage({ event: 'error', data: { message: 'Boom' } });
            }).not.toThrow();
        });

        it('propagates an abort thrown from inside onToken instead of swallowing it', async () => {
            // Regression: when onToken throws (e.g. the caller checks an abort
            // signal and throws), the throw escapes the Tauri channel dispatcher
            // and is lost. It must be captured and rethrown after the invoke.
            const mockChannel = { onmessage: null } as any;
            mocks.createChannel.mockResolvedValue(mockChannel);

            // Faithfully model the Tauri channel dispatcher: it invokes
            // onmessage and SWALLOWS any throw, then the command resolves
            // normally. So a throw from onToken is lost unless streamNativeCompletion
            // captures it into streamState.error itself.
            mocks.tauriInvoke.mockImplementation(() => {
                try {
                    mockChannel.onmessage({ event: 'token', data: { text: 'partial' } });
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
                const mockChannel = { onmessage: null } as any;
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
            const mockChannel = { onmessage: null } as any;
            mocks.createChannel.mockResolvedValue(mockChannel);
            mocks.tauriInvoke.mockReturnValue(new Promise<void>(() => undefined));

            const aborter = new AbortController();
            const promise = streamNativeCompletion([{ role: 'user', content: 'hi' }], vi.fn(), {
                signal: aborter.signal,
            });
            aborter.abort();

            await expect(promise).rejects.toThrow('aborted');
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
