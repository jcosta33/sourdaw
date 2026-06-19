import { describe, it, expect, vi, beforeEach } from 'vitest';

import { streamCloudChatCompletion } from '../streamCloudChatCompletion';

const mocks = vi.hoisted(() => ({
    getCloudClient: vi.fn(),
    stream: vi.fn(),
    registerCloudStreamController: vi.fn((controller: AbortController) => controller),
    unregisterCloudStreamController: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('../../keyManagement', () => ({
    getCloudClient: mocks.getCloudClient,
    registerCloudStreamController: mocks.registerCloudStreamController,
    unregisterCloudStreamController: mocks.unregisterCloudStreamController,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

describe('streamCloudChatCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const mockAsyncIterator = {
            // eslint-disable-next-line @typescript-eslint/require-await -- async generator uses yield, not await; lint rule doesn't recognise yield as an async operation
            async *[Symbol.asyncIterator]() {
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' World' } };
                yield { type: 'other_event' };
            },
        };

        mocks.stream.mockReturnValue(mockAsyncIterator);
        mocks.getCloudClient.mockReturnValue({
            messages: { stream: mocks.stream },
        });
    });

    it('throws if cloud client is not configured', async () => {
        mocks.getCloudClient.mockReturnValue(null);
        await expect(streamCloudChatCompletion([], vi.fn())).rejects.toThrow('Cloud AI not configured');
    });

    it('calls stream with correct messages and options', async () => {
        const messages = [
            { role: 'system', content: 'You are a bot.' },
            { role: 'user', content: 'Hi there' },
            { role: 'assistant', content: 'Hello' },
        ];

        await streamCloudChatCompletion(messages, vi.fn(), { maxTokens: 1000 });

        expect(mocks.stream).toHaveBeenCalledTimes(1);
        const args = mocks.stream.mock.calls[0][0];

        expect(args.system).toBe('You are a bot.');
        expect(args.max_tokens).toBe(1000);
        expect(args.messages).toHaveLength(2);
        expect(args.messages[0]).toEqual({ role: 'user', content: 'Hi there' });
        expect(args.messages[1]).toEqual({ role: 'assistant', content: 'Hello' });
    });

    it('yields tokens to the onToken callback', async () => {
        const tokens: string[] = [];
        function onToken(text: string) {
            tokens.push(text);
        }

        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], onToken);

        expect(tokens).toHaveLength(2);
        expect(tokens).toEqual(['Hello', ' World']);
    });

    it('passes an abort signal so a revoked key can tear the stream down', async () => {
        // Regression: the stream was started with no abort signal, so clearing
        // the key could not interrupt an in-flight request. It must register a
        // controller and forward its signal to the SDK.
        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.registerCloudStreamController).toHaveBeenCalledTimes(1);
        expect(mocks.unregisterCloudStreamController).toHaveBeenCalledTimes(1);

        const requestOptions = mocks.stream.mock.calls[0][1];
        expect(requestOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('unregisters its controller even when the stream throws', async () => {
        mocks.stream.mockImplementation(() => ({
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } };
                throw new Error('network blip');
            },
        }));

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn())).rejects.toThrow(
            'network blip'
        );
        expect(mocks.unregisterCloudStreamController).toHaveBeenCalledTimes(1);
    });

    it('warns when the stream stops with a non-end_turn reason (truncation)', async () => {
        // Regression: a message_delta carrying stop_reason="max_tokens" (or a
        // refusal) was silently dropped, so a truncated completion looked whole.
        mocks.stream.mockReturnValue({
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } };
                yield { type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null } };
            },
        });

        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('max_tokens'));
    });

    it('does not warn when the stream stops normally with end_turn', async () => {
        mocks.stream.mockReturnValue({
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } };
                yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } };
            },
        });

        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.warn).not.toHaveBeenCalled();
    });
});
