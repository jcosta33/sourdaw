import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requestAnthropicStream } from '../requestAnthropicStream';

const requestProvider = vi.hoisted(() => vi.fn());

vi.mock('../requestAnthropicProvider', () => ({ requestAnthropicProvider: requestProvider }));

function input(onEvent = vi.fn()) {
    return {
        sessionId: 'provider-session-00000000000000000000000000000000',
        model: 'claude-test',
        system: 'Be helpful.',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        maxTokens: 128,
        signal: new AbortController().signal,
        onEvent,
    };
}

describe('requestAnthropicStream', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('parses bounded SSE from the native session transport', async () => {
        const event = { type: 'message_stop' };
        requestProvider.mockImplementation(async ({ onBodyChunk }) => {
            onBodyChunk(new TextEncoder().encode(`event: message_stop\ndata: ${JSON.stringify(event)}\n\n`));
            return { status: 200, contentType: 'text/event-stream' };
        });
        const onEvent = vi.fn();

        await requestAnthropicStream(input(onEvent));

        expect(onEvent).toHaveBeenCalledWith(event);
        expect(requestProvider).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 'provider-session-00000000000000000000000000000000',
                body: expect.stringContaining('"stream":true'),
            })
        );
        const call = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
        if (!call) {
            throw new Error('Expected a recorded provider request');
        }
        const body = JSON.parse(call.body) as {
            system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
        };
        expect(body.system).toEqual([{ type: 'text', text: 'Be helpful.', cache_control: { type: 'ephemeral' } }]);
    });

    it('omits cache_control when the caller opts out of caching a per-turn-varying system prompt', async () => {
        requestProvider.mockImplementation(async ({ onBodyChunk }) => {
            onBodyChunk(new TextEncoder().encode('data: {"type":"message_stop"}\n\n'));
            return { status: 200, contentType: 'text/event-stream' };
        });

        await requestAnthropicStream({ ...input(), cacheSystem: false });

        const call = requestProvider.mock.calls[0]?.[0] as { body: string } | undefined;
        if (!call) {
            throw new Error('Expected a recorded provider request');
        }
        const body = JSON.parse(call.body) as { system: Array<{ type: string; text: string }> };
        expect(body.system).toEqual([{ type: 'text', text: 'Be helpful.' }]);
    });

    it('rejects an oversized event before exposing it', async () => {
        requestProvider.mockImplementation(async ({ onBodyChunk }) => {
            onBodyChunk(new TextEncoder().encode(`data: ${'x'.repeat(70 * 1024)}\n\n`));
            return { status: 200, contentType: 'text/event-stream' };
        });
        const onEvent = vi.fn();

        await expect(requestAnthropicStream(input(onEvent))).rejects.toThrow(/event|payload|limit/i);
        expect(onEvent).not.toHaveBeenCalled();
    });

    it('rejects invalid event JSON', async () => {
        requestProvider.mockImplementation(async ({ onBodyChunk }) => {
            onBodyChunk(new TextEncoder().encode('data: {invalid}\n\n'));
            return { status: 200, contentType: 'text/event-stream' };
        });

        await expect(requestAnthropicStream(input())).rejects.toThrow('invalid event JSON');
    });

    it('rejects provider failures without exposing their body', async () => {
        requestProvider.mockImplementation(async ({ onBodyChunk }) => {
            onBodyChunk(new TextEncoder().encode('private provider detail'));
            return { status: 401, contentType: 'application/json' };
        });

        await expect(requestAnthropicStream(input())).rejects.toThrow('status 401');
    });

    it('rejects a successful response with the wrong content type', async () => {
        requestProvider.mockResolvedValue({ status: 200, contentType: 'application/json' });

        await expect(requestAnthropicStream(input())).rejects.toThrow('invalid content type');
    });
});
