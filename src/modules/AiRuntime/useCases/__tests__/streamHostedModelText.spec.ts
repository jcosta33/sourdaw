import { describe, expect, it, vi } from 'vitest';

import { streamHostedModelText } from '../streamHostedModelText';

const mocks = vi.hoisted(() => ({
    streamCloudChatCompletion: vi.fn(),
    getCloudProviderInfo: vi.fn(() => ({ provider: 'anthropic' as const, model: 'hosted-model' })),
}));

vi.mock('../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: mocks.streamCloudChatCompletion,
}));

vi.mock('../../repositories/cloudLlm/getCloudProviderInfo', () => ({
    getCloudProviderInfo: mocks.getCloudProviderInfo,
}));

describe('streamHostedModelText', () => {
    it('returns one neutral result for hosted text, usage, and unknown events', async () => {
        const onToken = vi.fn();
        mocks.streamCloudChatCompletion.mockImplementation(async (_messages, emitToken, options) => {
            emitToken('Analysis');
            options?.onUsage?.({
                type: 'usage',
                mode: 'final',
                usage: { inputTokens: 5, outputTokens: 2, cachedInputTokens: null, reasoningTokens: null },
                provenance: 'provider-reported',
            });
            options?.onUnknownEvent?.('anthropic:future_event');
            return { status: 'complete' as const };
        });

        const result = await streamHostedModelText({
            correlationId: 'mix-health-1',
            messages: [{ role: 'user', content: 'Analyze the mix.' }],
            maxOutputTokens: 1_000,
            onToken,
        });

        expect(result.correlationId).toBe('mix-health-1');
        expect(result.output.text).toBe('Analysis');
        expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, provenance: 'provider-reported' });
        expect(result.ignoredProviderEvents).toEqual(['anthropic:future_event']);
    });
});
