import { beforeEach, describe, expect, it, vi } from 'vitest';

import { compileProviderAdapterInstallation, OPENAI_RESPONSES_ADAPTER_ID } from '../../../providerAdapterRegistry';
import { type OpenAiCloudRuntime } from '../../cloudSession';
import { streamOpenAiResponses } from '../streamOpenAiResponses';

const mocks = vi.hoisted(() => ({ requestHostedOpenAiProvider: vi.fn() }));

vi.mock('../requestOpenAiProvider', () => ({
    requestHostedOpenAiProvider: mocks.requestHostedOpenAiProvider,
}));

const RESPONSE_ID = 'resp_9f27';

function createRuntime(model: string): OpenAiCloudRuntime {
    return {
        provider: 'openai',
        model,
        base_url: 'https://api.openai.com/v1',
        authentication: 'api-key',
        adapter: compileProviderAdapterInstallation({
            adapterId: OPENAI_RESPONSES_ADAPTER_ID,
            providerId: 'openai',
            modelId: model,
            protocolFamily: 'openai-responses',
            origin: 'https://api.openai.com',
        }),
        session_id: `provider-session-${'0'.repeat(32)}`,
    };
}

const runtime = createRuntime('gpt-4-turbo');

let sentBodies: string[] = [];

function respondWith(sse: string): void {
    sentBodies = [];
    mocks.requestHostedOpenAiProvider.mockImplementation(
        async (request: { body: string; onBodyChunk: (chunk: Uint8Array) => void }) => {
            sentBodies.push(request.body);
            request.onBodyChunk(new TextEncoder().encode(sse));
            return { status: 200, contentType: 'text/event-stream' };
        }
    );
}

function sseEvent(type: string, payload: Record<string, unknown> = {}): string {
    return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function created(id: string = RESPONSE_ID): string {
    return sseEvent('response.created', { response: { id, status: 'in_progress' } });
}

function textDelta(text: string): string {
    return sseEvent('response.output_text.delta', { delta: text });
}

function completed(id: string = RESPONSE_ID): string {
    return sseEvent('response.completed', { response: { id, status: 'completed' } });
}

function stream(
    sse: string,
    onToken: (text: string) => void = vi.fn(),
    onUnknownEvent?: (providerEventType: string) => void
) {
    respondWith(sse);
    return streamOpenAiResponses({
        runtime,
        messages: [
            { role: 'system', content: 'system-a' },
            { role: 'system', content: 'system-b' },
            { role: 'user', content: 'lower the vocals' },
        ],
        onToken,
        signal: new AbortController().signal,
        maxTokens: 128,
        ...(onUnknownEvent ? { onUnknownEvent } : {}),
    });
}

function readSentBody(): Record<string, unknown> {
    const sent = sentBodies[0];
    if (sent === undefined) {
        throw new Error('Expected a JSON request body');
    }
    return JSON.parse(sent) as Record<string, unknown>;
}

describe('streamOpenAiResponses', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('sends the responses request shape with joined instructions and no provider-side retention', async () => {
        await stream([created(), textDelta('ok'), completed()].join(''));

        expect(readSentBody()).toEqual({
            model: 'gpt-4-turbo',
            instructions: 'system-a\n\nsystem-b',
            input: [{ role: 'user', content: 'lower the vocals' }],
            max_output_tokens: 128,
            stream: true,
            store: false,
        });
    });

    it('defaults max_output_tokens to 2048 when the caller sets no bound', async () => {
        respondWith([created(), completed()].join(''));

        await streamOpenAiResponses({
            runtime,
            messages: [{ role: 'user', content: 'hi' }],
            onToken: vi.fn(),
            signal: new AbortController().signal,
        });

        expect(readSentBody()).toMatchObject({ max_output_tokens: 2048 });
        expect(readSentBody()).not.toHaveProperty('instructions');
    });

    it.each(['gpt-5.6-luna', 'gpt-4-turbo'])('gates reasoning effort on the gpt-5.6 family (%s)', async (model) => {
        respondWith([created(), completed()].join(''));

        await streamOpenAiResponses({
            runtime: createRuntime(model),
            messages: [{ role: 'user', content: 'hi' }],
            onToken: vi.fn(),
            signal: new AbortController().signal,
        });

        const body = readSentBody();
        if (model === 'gpt-5.6-luna') {
            expect(body).toMatchObject({ reasoning: { effort: 'none' } });
        } else {
            expect(body).not.toHaveProperty('reasoning');
        }
    });

    it('captures the provider request id from response.created before any delta arrives', async () => {
        const seenIdsAtToken: unknown[] = [];
        const result = await stream(
            [created(), textDelta('Lower '), textDelta('the vocals'), completed('resp_late')].join(''),
            vi.fn(() => seenIdsAtToken.push(RESPONSE_ID))
        );

        expect(result).toEqual({ finishReason: 'stop', providerRequestId: RESPONSE_ID });
        expect(seenIdsAtToken).toHaveLength(2);
    });

    it('rejects a response.failed event without exposing its payload', async () => {
        await expect(
            stream([created(), sseEvent('response.failed', { response: { error: { message: 'boom' } } })].join(''))
        ).rejects.toThrow('Hosted AI returned an invalid streaming event');
    });

    it('rejects a top-level error event without exposing its payload', async () => {
        await expect(
            stream([created(), sseEvent('error', { message: 'rate limited', code: 'rate_limit' })].join(''))
        ).rejects.toThrow('Hosted AI returned an invalid streaming event');
    });

    it('consumes structural item and content-part events without reporting them as unknown', async () => {
        const onUnknownEvent = vi.fn();
        const onToken = vi.fn();

        const result = await stream(
            [
                created(),
                sseEvent('response.output_item.added', { output_index: 0, item: { type: 'message' } }),
                sseEvent('response.content_part.added', { output_index: 0, part: { type: 'output_text' } }),
                textDelta('Lower'),
                sseEvent('response.output_text.done', { text: 'Lower' }),
                sseEvent('response.content_part.done', { output_index: 0 }),
                sseEvent('response.output_item.done', { output_index: 0 }),
                sseEvent('response.function_call_arguments.delta', { delta: '{"a":' }),
                sseEvent('response.function_call_arguments.done', { arguments: '{"a":1}' }),
                completed(),
            ].join(''),
            onToken,
            onUnknownEvent
        );

        expect(onUnknownEvent).not.toHaveBeenCalled();
        expect(onToken.mock.calls).toEqual([['Lower']]);
        expect(result.finishReason).toBe('stop');
    });

    it('reports an unrecognized event under the responses namespace and keeps streaming', async () => {
        const onUnknownEvent = vi.fn();

        const result = await stream(
            [created(), sseEvent('response.future_event', { detail: 'x' }), textDelta('ok'), completed()].join(''),
            vi.fn(),
            onUnknownEvent
        );

        expect(onUnknownEvent.mock.calls).toEqual([['openai-responses:response.future_event']]);
        expect(result.finishReason).toBe('stop');
    });

    it('rejects a single event larger than its 64 KiB bound', async () => {
        await expect(stream([created(), textDelta('x'.repeat(64 * 1_024)), completed()].join(''))).rejects.toThrow(
            'Hosted AI chat stream exceeded its event limit'
        );
    });

    it('rejects a stream that exceeds its 4096 event bound', async () => {
        const events = [created()];
        for (let index = 0; index < 4_096; index += 1) {
            events.push(textDelta('.'));
        }
        events.push(completed());

        await expect(stream(events.join(''))).rejects.toThrow('Hosted AI chat stream exceeded its event limit');
    });

    it('rejects a second terminal event after the stream already finished', async () => {
        await expect(stream([created(), textDelta('ok'), completed(), completed()].join(''))).rejects.toThrow(
            'Hosted AI returned an invalid streaming event'
        );
    });

    it('maps an incomplete content filter to a refusal without forwarding the refusal text', async () => {
        const onToken = vi.fn();

        const result = await stream(
            [
                created(),
                sseEvent('response.refusal.delta', { delta: 'refusal-body-text' }),
                sseEvent('response.incomplete', {
                    response: { id: RESPONSE_ID, incomplete_details: { reason: 'content_filter' } },
                }),
            ].join(''),
            onToken
        );

        expect(result.finishReason).toBe('refusal');
        expect(onToken).not.toHaveBeenCalled();
    });

    it('maps a content filter to a refusal even when the provider streamed no refusal part', async () => {
        const result = await stream(
            [
                created(),
                sseEvent('response.incomplete', {
                    response: { id: RESPONSE_ID, incomplete_details: { reason: 'content_filter' } },
                }),
            ].join('')
        );

        expect(result.finishReason).toBe('refusal');
    });

    it('maps an incomplete token limit to a length finish', async () => {
        const result = await stream(
            [
                created(),
                textDelta('Lower '),
                sseEvent('response.incomplete', {
                    response: { id: RESPONSE_ID, incomplete_details: { reason: 'max_output_tokens' } },
                }),
            ].join('')
        );

        expect(result.finishReason).toBe('length');
    });

    it.each([
        ['max_output_tokens', 'length'],
        ['content_filter', 'refusal'],
    ] as const)('reports the provider usage totals of an incomplete %s response', async (reason, finishReason) => {
        const onUsage = vi.fn();
        respondWith(
            [
                created(),
                textDelta('Lower '),
                sseEvent('response.incomplete', {
                    response: {
                        id: RESPONSE_ID,
                        incomplete_details: { reason },
                        usage: { input_tokens: 11, output_tokens: 4 },
                    },
                }),
            ].join('')
        );

        const result = await streamOpenAiResponses({
            runtime,
            messages: [{ role: 'user', content: 'lower the vocals' }],
            onToken: vi.fn(),
            signal: new AbortController().signal,
            onUsage,
        });

        expect(result.finishReason).toBe(finishReason);
        expect(onUsage.mock.calls).toEqual([
            [
                {
                    type: 'usage',
                    mode: 'final',
                    usage: { inputTokens: 11, outputTokens: 4, cachedInputTokens: null, reasoningTokens: null },
                    provenance: 'provider-reported',
                },
            ],
        ]);
    });

    it('rejects an incomplete response whose reason it cannot map', async () => {
        await expect(
            stream(
                [
                    created(),
                    sseEvent('response.incomplete', {
                        response: { id: RESPONSE_ID, incomplete_details: { reason: 'unknown_reason' } },
                    }),
                ].join('')
            )
        ).rejects.toThrow('Hosted AI returned an invalid streaming event');
    });

    it('rejects an incomplete response with an unmappable reason before reporting its usage', async () => {
        const onUsage = vi.fn();
        respondWith(
            [
                created(),
                textDelta('Lower '),
                sseEvent('response.incomplete', {
                    response: {
                        id: RESPONSE_ID,
                        incomplete_details: { reason: 'unexpected_reason' },
                        usage: { input_tokens: 11, output_tokens: 4 },
                    },
                }),
            ].join('')
        );

        await expect(
            streamOpenAiResponses({
                runtime,
                messages: [{ role: 'user', content: 'lower the vocals' }],
                onToken: vi.fn(),
                signal: new AbortController().signal,
                onUsage,
            })
        ).rejects.toThrow('Hosted AI returned an invalid streaming event');

        expect(onUsage).not.toHaveBeenCalled();
    });

    it('rejects a stream cut before any terminal event', async () => {
        await expect(stream([created(), textDelta('Lower ')].join(''))).rejects.toThrow(
            'Hosted AI chat stream ended unexpectedly'
        );
    });
});
