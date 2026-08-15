import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AiRuntimeConfigurationChangedError } from '../../../../errors/AiRuntimeConfigurationChangedError';
import { streamCloudChatCompletion } from '../streamCloudChatCompletion';

type CloudStreamInput = {
    system: string;
    max_tokens: number;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
};

type CloudStreamEvent =
    | {
          type: 'message_start';
          message: {
              usage: {
                  input_tokens: number;
                  output_tokens: number;
                  cache_creation_input_tokens?: number;
                  cache_read_input_tokens?: number;
              };
          };
      }
    | { type: 'content_block_delta'; delta: { type: 'text_delta'; text: string } }
    | {
          type: 'message_delta';
          delta: { stop_reason: string | null; stop_sequence: null };
          usage?: { output_tokens: number };
      }
    | { type: 'message_stop' }
    | { type: 'other_event' };

type CloudStreamOutput = {
    [Symbol.asyncIterator](): AsyncIterator<CloudStreamEvent>;
};

type CompatibleStreamInput = {
    runtime: {
        provider: 'openai' | 'openai-compatible';
        api_key: string;
        model: string;
        base_url: string;
    };
    messages: Array<{ role: string; content: string }>;
    onToken: (text: string) => void;
    onUnknownEvent?: (providerEventType: string) => void;
    signal: AbortSignal;
    maxTokens?: number;
};

type CloudCompletionOutcome = { status: 'complete' } | { status: 'incomplete'; reason: string };

const mocks = vi.hoisted(() => ({
    getCloudClient: vi.fn(),
    getCloudProviderRuntime: vi.fn(),
    stream: vi.fn<(input: CloudStreamInput, options: { signal: AbortSignal }) => CloudStreamOutput>(),
    streamOpenAiCompatibleChatCompletion: vi.fn<(input: CompatibleStreamInput) => Promise<'stop' | 'length'>>(),
    registerCloudStreamController: vi.fn((controller: AbortController) => controller),
    unregisterCloudStreamController: vi.fn(),
    warn: vi.fn(),
}));

vi.mock('../../getCloudClient', () => ({
    getCloudClient: mocks.getCloudClient,
}));

vi.mock('../../getCloudProviderRuntime', () => ({
    getCloudProviderRuntime: mocks.getCloudProviderRuntime,
}));

vi.mock('../../registerCloudStreamController', () => ({
    registerCloudStreamController: mocks.registerCloudStreamController,
}));

vi.mock('../../unregisterCloudStreamController', () => ({
    unregisterCloudStreamController: mocks.unregisterCloudStreamController,
}));

vi.mock('../streamOpenAiCompatibleChatCompletion', () => ({
    streamOpenAiCompatibleChatCompletion: mocks.streamOpenAiCompatibleChatCompletion,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

describe('streamCloudChatCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        const mockAsyncIterator = {
            // eslint-disable-next-line @typescript-eslint/require-await -- async generator uses yield, not await; lint rule doesn't recognise yield as an async operation
            async *[Symbol.asyncIterator](): AsyncGenerator<CloudStreamEvent> {
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' World' } };
                yield { type: 'other_event' };
                yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } };
                yield { type: 'message_stop' };
            },
        };

        mocks.stream.mockReturnValue(mockAsyncIterator);
        mocks.getCloudClient.mockReturnValue({
            messages: { stream: mocks.stream },
        });
        mocks.getCloudProviderRuntime.mockReturnValue({
            provider: 'anthropic',
            api_key: 'test-key',
            model: 'test-model',
            client: {},
        });
        mocks.streamOpenAiCompatibleChatCompletion.mockResolvedValue('stop');
    });

    it('throws if cloud client is not configured', async () => {
        mocks.getCloudClient.mockReturnValue(null);
        mocks.getCloudProviderRuntime.mockReturnValue(null);
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
        const firstCall = mocks.stream.mock.calls[0];
        if (!firstCall) {
            throw new Error('Expected the cloud stream call to have been recorded');
        }
        const args = firstCall[0];

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

        const outcome: CloudCompletionOutcome = await streamCloudChatCompletion(
            [{ role: 'user', content: 'test' }],
            onToken
        );

        expect(tokens).toHaveLength(2);
        expect(tokens).toEqual(['Hello', ' World']);
        expect(outcome).toEqual({ status: 'complete' });
    });

    it('normalizes Anthropic usage snapshots and final totals', async () => {
        mocks.stream.mockReturnValue({
            async *[Symbol.asyncIterator](): AsyncGenerator<CloudStreamEvent> {
                yield {
                    type: 'message_start',
                    message: {
                        usage: {
                            input_tokens: 12,
                            output_tokens: 0,
                            cache_creation_input_tokens: 3,
                            cache_read_input_tokens: 2,
                        },
                    },
                };
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } };
                yield {
                    type: 'message_delta',
                    delta: { stop_reason: 'end_turn', stop_sequence: null },
                    usage: { output_tokens: 4 },
                };
                yield { type: 'message_stop' };
            },
        });
        const onUsage = vi.fn();

        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn(), { onUsage });

        expect(onUsage).toHaveBeenNthCalledWith(1, {
            type: 'usage',
            mode: 'cumulative-snapshot',
            usage: { inputTokens: 17, outputTokens: 0, cachedInputTokens: 5, reasoningTokens: null },
            provenance: 'provider-reported',
        });
        expect(onUsage).toHaveBeenNthCalledWith(2, {
            type: 'usage',
            mode: 'final',
            usage: { inputTokens: null, outputTokens: 4, cachedInputTokens: null, reasoningTokens: null },
            provenance: 'provider-reported',
        });
    });

    it('surfaces unknown Anthropic events without exposing their payload', async () => {
        const onUnknownEvent = vi.fn();

        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn(), { onUnknownEvent });

        expect(onUnknownEvent).toHaveBeenCalledWith('anthropic:other_event');
    });

    it('passes an abort signal so a revoked key can tear the stream down', async () => {
        // Regression: the stream was started with no abort signal, so clearing
        // the key could not interrupt an in-flight request. It must register a
        // controller and forward its signal to the SDK.
        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.registerCloudStreamController).toHaveBeenCalledTimes(1);
        expect(mocks.unregisterCloudStreamController).toHaveBeenCalledTimes(1);

        const streamCall = mocks.stream.mock.calls[0];
        if (!streamCall) {
            throw new Error('Expected the cloud stream call to have been recorded');
        }
        const requestOptions = streamCall[1];
        expect(requestOptions.signal).toBeInstanceOf(AbortSignal);
    });

    it('dispatches OpenAI-compatible providers through the fetch stream adapter', async () => {
        const runtime = {
            provider: 'openai-compatible' as const,
            api_key: 'test-key',
            model: 'local-model',
            base_url: 'http://localhost:1234/v1',
        };
        const messages = [{ role: 'user', content: 'test' }];
        const onToken = vi.fn();
        mocks.getCloudProviderRuntime.mockReturnValue(runtime);

        const outcome = await streamCloudChatCompletion(messages, onToken, { maxTokens: 1000 });

        const adapterCall = mocks.streamOpenAiCompatibleChatCompletion.mock.calls[0]?.[0];
        expect(adapterCall?.runtime).toBe(runtime);
        expect(adapterCall?.messages).toBe(messages);
        expect(adapterCall?.onToken).toBe(onToken);
        expect(adapterCall?.signal).toBeInstanceOf(AbortSignal);
        expect(adapterCall?.maxTokens).toBe(1000);
        expect(mocks.stream).not.toHaveBeenCalled();
        expect(mocks.unregisterCloudStreamController).toHaveBeenCalledTimes(1);
        expect(outcome).toEqual({ status: 'complete' });
    });

    it('aborts a hosted request before its first token when the caller stops', async () => {
        const runtime = {
            provider: 'openai' as const,
            api_key: 'test-key',
            model: 'gpt-5.2',
            base_url: 'https://api.openai.com/v1',
        };
        const caller = new AbortController();
        let requestSignal: AbortSignal | undefined;
        mocks.getCloudProviderRuntime.mockReturnValue(runtime);
        mocks.streamOpenAiCompatibleChatCompletion.mockImplementation(
            ({ signal }) =>
                new Promise((_resolve, reject) => {
                    requestSignal = signal;
                    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
                        once: true,
                    });
                })
        );

        const pending = streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn(), {
            signal: caller.signal,
        });
        await vi.waitFor(() => expect(requestSignal).toBeInstanceOf(AbortSignal));
        caller.abort(new DOMException('AbortedByUser', 'AbortError'));

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(requestSignal?.aborted).toBe(true);
        expect(mocks.unregisterCloudStreamController).toHaveBeenCalledTimes(1);
    });

    it('warns when an OpenAI-compatible stream reaches its token limit', async () => {
        mocks.getCloudProviderRuntime.mockReturnValue({
            provider: 'openai-compatible',
            api_key: '',
            model: 'local-model',
            base_url: 'http://localhost:1234/v1',
        });
        mocks.streamOpenAiCompatibleChatCompletion.mockResolvedValue('length');

        const outcome = await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('token limit'));
        expect(outcome).toEqual({ status: 'incomplete', reason: 'token limit' });
    });

    it('rejects when configuration changes as an OpenAI-compatible stream completes', async () => {
        mocks.getCloudProviderRuntime.mockReturnValue({
            provider: 'openai' as const,
            api_key: 'test-key',
            model: 'gpt-5.2',
            base_url: 'https://api.openai.com/v1',
        });
        mocks.streamOpenAiCompatibleChatCompletion.mockImplementation(() => {
            const controller = mocks.registerCloudStreamController.mock.calls[0]?.[0];
            controller?.abort(new AiRuntimeConfigurationChangedError());
            return Promise.resolve('stop');
        });

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn())).rejects.toBeInstanceOf(
            AiRuntimeConfigurationChangedError
        );
    });

    it('unregisters its controller even when the stream throws', async () => {
        mocks.stream.mockImplementation(() => ({
            async *[Symbol.asyncIterator](): AsyncGenerator<CloudStreamEvent> {
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
            async *[Symbol.asyncIterator](): AsyncGenerator<CloudStreamEvent> {
                await Promise.resolve();
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } };
                yield { type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null } };
                yield { type: 'message_stop' };
            },
        });

        const outcome = await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('max_tokens'));
        expect(outcome).toEqual({ status: 'incomplete', reason: 'max_tokens' });
    });

    it('does not warn when the stream stops normally with end_turn', async () => {
        mocks.stream.mockReturnValue({
            async *[Symbol.asyncIterator](): AsyncGenerator<CloudStreamEvent> {
                await Promise.resolve();
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } };
                yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } };
                yield { type: 'message_stop' };
            },
        });

        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('rejects an Anthropic stream without terminal events', async () => {
        mocks.stream.mockReturnValue({
            async *[Symbol.asyncIterator](): AsyncGenerator<CloudStreamEvent> {
                await Promise.resolve();
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } };
            },
        });

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn())).rejects.toThrow(
            'Hosted AI chat stream ended unexpectedly'
        );
    });

    it('rejects when configuration changes as an Anthropic stream completes', async () => {
        mocks.stream.mockReturnValue({
            async *[Symbol.asyncIterator](): AsyncGenerator<CloudStreamEvent> {
                await Promise.resolve();
                yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } };
                yield { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } };
                yield { type: 'message_stop' };
                const controller = mocks.registerCloudStreamController.mock.calls[0]?.[0];
                controller?.abort(new AiRuntimeConfigurationChangedError());
            },
        });

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn())).rejects.toBeInstanceOf(
            AiRuntimeConfigurationChangedError
        );
    });
});
