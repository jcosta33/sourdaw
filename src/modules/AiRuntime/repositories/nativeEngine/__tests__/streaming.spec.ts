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
                read: vi.fn().mockImplementation(async () => {
                    if (readIndex < mockReadChunks.length) {
                        return { done: false, value: mockReadChunks[readIndex++] };
                    }
                    return { done: true, value: undefined };
                }),
            };

            mocks.fetch.mockResolvedValue({
                ok: true,
                body: { getReader: () => mockReader },
            });

            const tokens: string[] = [];
            const onToken = (t: string) => tokens.push(t);

            await streamNativeCompletion([{ role: 'user', content: 'hi' }], onToken);

            expect(mocks.fetch).toHaveBeenCalled();
            expect(tokens).toEqual(['Hello', ' World']);
        });

        it('throws an error if fetch fails', async () => {
            mocks.fetch.mockResolvedValue({
                ok: false,
                status: 404,
                text: async () => 'Not Found',
            });

            await expect(streamNativeCompletion([], vi.fn())).rejects.toThrow('llama-server error 404: Not Found');
        });

        it('throws if no body is returned', async () => {
            mocks.fetch.mockResolvedValue({
                ok: true,
                body: null,
            });

            await expect(streamNativeCompletion([], vi.fn())).rejects.toThrow('No response body');
        });
    });
});
