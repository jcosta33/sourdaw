import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AiRuntimeConfigurationChangedError } from '../../../../errors/AiRuntimeConfigurationChangedError';
import { streamCloudChatCompletion } from '../streamCloudChatCompletion';

type CloudStreamInput = {
    sessionId: string;
    model: string;
    system: string;
    maxTokens: number;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
    signal: AbortSignal;
    onEvent: (event: unknown) => void;
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

type CompatibleStreamInput = {
    runtime: {
        provider: 'openai' | 'openai-compatible';
        session_id: string | null;
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
    getCloudProviderRuntime: vi.fn(),
    stream: vi.fn<(input: CloudStreamInput) => Promise<void>>(),
    streamOpenAiCompatibleChatCompletion: vi.fn<(input: CompatibleStreamInput) => Promise<'stop' | 'length'>>(),
    registerCloudStreamController: vi.fn((controller: AbortController) => controller),
    unregisterCloudStreamController: vi.fn(),
    warn: vi.fn(),
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

vi.mock('../requestAnthropicStream', () => ({
    requestAnthropicStream: mocks.stream,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { info: vi.fn(), warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

function installAnthropicEvents(events: readonly CloudStreamEvent[]): void {
    mocks.stream.mockImplementation(async ({ onEvent }) => {
        for (const event of events) {
            onEvent(event);
        }
    });
}

describe('streamCloudChatCompletion', () => {
    beforeEach(() => {
        vi.clearAllMocks();

        installAnthropicEvents([
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
            { type: 'content_block_delta', delta: { type: 'text_delta', text: ' World' } },
            { type: 'other_event' },
            { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
            { type: 'message_stop' },
        ]);
        mocks.getCloudProviderRuntime.mockReturnValue({
            provider: 'anthropic',
            session_id: 'provider-session-00000000000000000000000000000000',
            model: 'test-model',
        });
        mocks.streamOpenAiCompatibleChatCompletion.mockResolvedValue('stop');
    });

    it('throws if cloud client is not configured', async () => {
        mocks.getCloudProviderRuntime.mockReturnValue(null);
        await expect(streamCloudChatCompletion([], vi.fn())).rejects.toThrow('Hosted AI is not configured');
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
        expect(args.sessionId).toBe('provider-session-00000000000000000000000000000000');
        expect(args.model).toBe('test-model');
        expect(args.maxTokens).toBe(1000);
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

    it('rejects an oversized Anthropic event before exposing its token', async () => {
        installAnthropicEvents([
            {
                type: 'content_block_delta',
                delta: { type: 'text_delta', text: 'x'.repeat(70 * 1_024) },
            },
            { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
            { type: 'message_stop' },
        ]);
        const onToken = vi.fn();

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], onToken)).rejects.toThrow(
            /event|payload|size|limit/i
        );
        expect(onToken).not.toHaveBeenCalled();
    });

    it('normalizes Anthropic usage snapshots and final totals', async () => {
        installAnthropicEvents([
            {
                type: 'message_start',
                message: {
                    usage: {
                        input_tokens: 12,
                        output_tokens: 0,
                        cache_creation_input_tokens: 3,
                        cache_read_input_tokens: 2,
                    },
                },
            },
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } },
            {
                type: 'message_delta',
                delta: { stop_reason: 'end_turn', stop_sequence: null },
                usage: { output_tokens: 4 },
            },
            { type: 'message_stop' },
        ]);
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

    it('passes an abort signal so a revoked session can tear the stream down', async () => {
        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.registerCloudStreamController).toHaveBeenCalledTimes(1);
        expect(mocks.unregisterCloudStreamController).toHaveBeenCalledTimes(1);

        const streamCall = mocks.stream.mock.calls[0];
        if (!streamCall) {
            throw new Error('Expected the cloud stream call to have been recorded');
        }
        expect(streamCall[0].signal).toBeInstanceOf(AbortSignal);
    });

    it('dispatches OpenAI-compatible providers through the fetch stream adapter', async () => {
        const runtime = {
            provider: 'openai-compatible' as const,
            session_id: null,
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
            session_id: 'provider-session-00000000000000000000000000000000',
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
            session_id: null,
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
            session_id: 'provider-session-00000000000000000000000000000000',
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
        mocks.stream.mockImplementation(async ({ onEvent }) => {
            onEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } });
            throw new Error('network blip');
        });

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn())).rejects.toThrow(
            'network blip'
        );
        expect(mocks.unregisterCloudStreamController).toHaveBeenCalledTimes(1);
    });

    it('warns when the stream stops with a non-end_turn reason (truncation)', async () => {
        // Regression: a message_delta carrying stop_reason="max_tokens" (or a
        // refusal) was silently dropped, so a truncated completion looked whole.
        installAnthropicEvents([
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
            { type: 'message_delta', delta: { stop_reason: 'max_tokens', stop_sequence: null } },
            { type: 'message_stop' },
        ]);

        const outcome = await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('max_tokens'));
        expect(outcome).toEqual({ status: 'incomplete', reason: 'max_tokens' });
    });

    it('does not warn when the stream stops normally with end_turn', async () => {
        installAnthropicEvents([
            { type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } },
            { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
            { type: 'message_stop' },
        ]);

        await streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn());

        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('rejects an Anthropic stream without terminal events', async () => {
        installAnthropicEvents([{ type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }]);

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn())).rejects.toThrow(
            'Hosted AI chat stream ended unexpectedly'
        );
    });

    it('rejects an Anthropic event after its terminal outcome', async () => {
        installAnthropicEvents([
            { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } },
            { type: 'message_stop' },
            { type: 'other_event' },
        ]);

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn())).rejects.toThrow(
            'event after completion'
        );
    });

    it('rejects when configuration changes as an Anthropic stream completes', async () => {
        mocks.stream.mockImplementation(async ({ onEvent }) => {
            onEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'done' } });
            onEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null } });
            onEvent({ type: 'message_stop' });
            const controller = mocks.registerCloudStreamController.mock.calls[0]?.[0];
            controller?.abort(new AiRuntimeConfigurationChangedError());
        });

        await expect(streamCloudChatCompletion([{ role: 'user', content: 'test' }], vi.fn())).rejects.toBeInstanceOf(
            AiRuntimeConfigurationChangedError
        );
    });
});
