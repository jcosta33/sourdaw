import { afterEach, describe, expect, it, vi } from 'vitest';

import { type OpenAiCompatibleCloudRuntime } from '../../cloudSession';
import { streamOpenAiCompatibleChatCompletion } from '../streamOpenAiCompatibleChatCompletion';

const runtime: OpenAiCompatibleCloudRuntime = {
    provider: 'openai-compatible',
    api_key: 'local-key',
    model: 'local-model',
    base_url: 'http://localhost:1234/v1',
};

describe('streamOpenAiCompatibleChatCompletion', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('emits text deltas from an OpenAI-compatible event stream', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"content":"Lower"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" the vocals"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
        ].join('');
        const fetchMock = vi
            .fn<typeof fetch>()
            .mockResolvedValue(new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));
        vi.stubGlobal('fetch', fetchMock);
        const onToken = vi.fn();

        const finishReason = await streamOpenAiCompatibleChatCompletion({
            runtime,
            messages: [
                { role: 'system', content: 'system' },
                { role: 'user', content: 'help' },
            ],
            onToken,
            signal: new AbortController().signal,
            maxTokens: 100,
        });

        expect(onToken.mock.calls).toEqual([['Lower'], [' the vocals']]);
        expect(finishReason).toBe('stop');
        const request = fetchMock.mock.calls[0]?.[1];
        if (!request || typeof request.body !== 'string') {
            throw new Error('Expected a JSON request body');
        }
        const body = JSON.parse(request.body) as Record<string, unknown>;
        expect(body).toMatchObject({ model: 'local-model', stream: true, max_tokens: 100 });
    });

    it('normalizes the usage-only terminal event without double-emitting text', async () => {
        const sse = [
            'data: {"choices":[{"delta":{"content":"Done"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":3},"completion_tokens_details":{"reasoning_tokens":2}}}\n\n',
            'data: [DONE]\n\n',
        ].join('');
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(sse, { status: 200 })));
        const onToken = vi.fn();
        const onUsage = vi.fn();

        await streamOpenAiCompatibleChatCompletion({
            runtime,
            messages: [{ role: 'user', content: 'help' }],
            onToken,
            onUsage,
            signal: new AbortController().signal,
        });

        expect(onToken).toHaveBeenCalledOnce();
        expect(onUsage).toHaveBeenCalledWith({
            type: 'usage',
            mode: 'final',
            usage: { inputTokens: 11, outputTokens: 4, cachedInputTokens: 3, reasoningTokens: 2 },
            provenance: 'provider-reported',
        });
    });

    it('rejects malformed streaming events', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn<typeof fetch>().mockResolvedValue(new Response('data: not-json\n\n', { status: 200 }))
        );

        await expect(
            streamOpenAiCompatibleChatCompletion({
                runtime,
                messages: [{ role: 'user', content: 'help' }],
                onToken: vi.fn(),
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Hosted AI returned an invalid streaming event');
    });

    it('rejects provider error envelopes without exposing their contents', async () => {
        vi.stubGlobal(
            'fetch',
            vi
                .fn<typeof fetch>()
                .mockResolvedValue(
                    new Response('data: {"error":{"message":"secret provider detail"}}\n\n', { status: 200 })
                )
        );

        await expect(
            streamOpenAiCompatibleChatCompletion({
                runtime,
                messages: [{ role: 'user', content: 'help' }],
                onToken: vi.fn(),
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Hosted AI returned an invalid streaming event');
    });

    it('rejects EOF without the terminal DONE event', async () => {
        const truncated = [
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        ].join('');
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(truncated, { status: 200 })));

        await expect(
            streamOpenAiCompatibleChatCompletion({
                runtime,
                messages: [{ role: 'user', content: 'help' }],
                onToken: vi.fn(),
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Hosted AI chat stream ended unexpectedly');
    });

    it('returns a length finish reason while preserving partial output', async () => {
        const truncated = [
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
            'data: [DONE]\n\n',
        ].join('');
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(truncated, { status: 200 })));

        const onToken = vi.fn();
        const finishReason = await streamOpenAiCompatibleChatCompletion({
            runtime,
            messages: [{ role: 'user', content: 'help' }],
            onToken,
            signal: new AbortController().signal,
        });

        expect(finishReason).toBe('length');
        expect(onToken).toHaveBeenCalledWith('partial');
    });

    it('rejects unsupported finish reasons', async () => {
        const refused = [
            'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\n',
            'data: [DONE]\n\n',
        ].join('');
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(refused, { status: 200 })));

        await expect(
            streamOpenAiCompatibleChatCompletion({
                runtime,
                messages: [{ role: 'user', content: 'help' }],
                onToken: vi.fn(),
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Hosted AI chat stream ended before normal completion');
    });

    it('rejects streamed provider refusals without exposing refusal content', async () => {
        const refusal = [
            'data: {"choices":[{"delta":{"refusal":"secret refusal detail"}}]}\n\n',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            'data: [DONE]\n\n',
        ].join('');
        vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(refusal, { status: 200 })));

        await expect(
            streamOpenAiCompatibleChatCompletion({
                runtime,
                messages: [{ role: 'user', content: 'help' }],
                onToken: vi.fn(),
                signal: new AbortController().signal,
            })
        ).rejects.toThrow('Hosted AI refused the chat request');
    });

    it('omits authorization for an auth-free compatible endpoint', async () => {
        const authFreeRuntime = { ...runtime, api_key: '' };
        const sse = ['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'].join('');
        const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(sse, { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await streamOpenAiCompatibleChatCompletion({
            runtime: authFreeRuntime,
            messages: [{ role: 'user', content: 'help' }],
            onToken: vi.fn(),
            signal: new AbortController().signal,
        });

        expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
            'Content-Type': 'application/json',
        });
    });
});
