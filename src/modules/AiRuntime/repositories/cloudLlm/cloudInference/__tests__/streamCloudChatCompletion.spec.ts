import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamCloudChatCompletion } from '../streamCloudChatCompletion';

const mocks = vi.hoisted(() => ({
    getCloudClient: vi.fn(),
    stream: vi.fn(),
}));

vi.mock('../../keyManagement', () => ({
    getCloudClient: mocks.getCloudClient,
}));

describe('streamCloudChatCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        
        const mockAsyncIterator = {
            async *[Symbol.asyncIterator]() {
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' World' } };
                yield { type: 'other_event' };
            }
        };

        mocks.stream.mockReturnValue(mockAsyncIterator);
        mocks.getCloudClient.mockReturnValue({
            messages: { stream: mocks.stream }
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
            { role: 'assistant', content: 'Hello' }
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
        const onToken = (text: string) => tokens.push(text);

        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], onToken);

        expect(tokens).toHaveLength(2);
        expect(tokens).toEqual(['Hello', ' World']);
    });
});
