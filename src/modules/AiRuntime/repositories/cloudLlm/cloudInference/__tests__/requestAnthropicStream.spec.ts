import { describe, expect, it, vi } from 'vitest';

import { requestAnthropicStream } from '../requestAnthropicStream';

function responseFromChunks(chunks: Uint8Array[]): Response {
    return new Response(
        new ReadableStream<Uint8Array>({
            start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(chunk);
                }
                controller.close();
            },
        }),
        { status: 200 }
    );
}

function requestInput() {
    return {
        apiKey: 'test-key',
        model: 'claude-test',
        system: 'Be helpful.',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        maxTokens: 128,
        signal: new AbortController().signal,
    };
}

describe('requestAnthropicStream', () => {
    it('rejects an oversized raw SSE chunk before parsing or exposing an event', async () => {
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(responseFromChunks([new TextEncoder().encode(`data: ${'x'.repeat(70 * 1_024)}\n\n`)]));
        vi.stubGlobal('fetch', fetchMock);
        const events: unknown[] = [];

        await expect(async () => {
            for await (const event of requestAnthropicStream(requestInput())) {
                events.push(event);
            }
        }).rejects.toThrow(/response|chunk|event|payload|limit/i);

        expect(events).toEqual([]);
    });

    it('parses bounded Anthropic SSE data with the owned authenticated request', async () => {
        const event = { type: 'message_stop' };
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                responseFromChunks([
                    new TextEncoder().encode(`event: message_stop\ndata: ${JSON.stringify(event)}\n\n`),
                ])
            );
        vi.stubGlobal('fetch', fetchMock);
        const events: unknown[] = [];

        for await (const received of requestAnthropicStream(requestInput())) {
            events.push(received);
        }

        expect(events).toEqual([event]);
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.anthropic.com/v1/messages',
            expect.objectContaining({
                method: 'POST',
                headers: expect.objectContaining({
                    'anthropic-dangerous-direct-browser-access': 'true',
                    'anthropic-version': '2023-06-01',
                    'x-api-key': 'test-key',
                }),
            })
        );
    });
});
