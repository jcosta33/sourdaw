import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type ModelProviderResult } from '../../models/ModelProviderProtocol';
import { mixHealthAnalysis } from '../mixHealthAnalysis';

const { streamHostedModelTextMock, summarizeFeaturesMock, mocks } = vi.hoisted(() => {
    const trackStore: { value: unknown } = { value: null };

    return {
        streamHostedModelTextMock:
            vi.fn<
                (input: {
                    messages: unknown;
                    onToken: (text: string) => void;
                    signal?: AbortSignal;
                }) => Promise<ModelProviderResult>
            >(),
        summarizeFeaturesMock: vi.fn(),
        mocks: {
            trackStore,
        },
    };
});

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: mocks.trackStore,
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    summarizeFeatures: summarizeFeaturesMock,
}));

vi.mock('../streamHostedModelText', () => ({
    streamHostedModelText: streamHostedModelTextMock,
}));

function createResult(overrides: Partial<ModelProviderResult> = {}): ModelProviderResult {
    return {
        schemaVersion: 1,
        provider: 'anthropic',
        model: 'model',
        correlationId: 'mix-health-test',
        status: 'complete',
        output: { text: '', reasoning: '', toolCalls: [], structuredOutput: null },
        usage: {
            inputTokens: null,
            outputTokens: null,
            cachedInputTokens: null,
            reasoningTokens: null,
            provenance: 'unavailable',
        },
        finishReason: 'stop',
        partialOutputDisposition: 'none',
        failure: null,
        ignoredProviderEvents: [],
        ...overrides,
    };
}

describe('mixHealthAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = null;
        streamHostedModelTextMock.mockResolvedValue(createResult());
    });

    it('short-circuits when no tracks', async () => {
        const onToken = vi.fn();
        await mixHealthAnalysis({ onToken });

        expect(onToken).toHaveBeenCalledWith('No tracks found in the session to analyze.');
        expect(streamHostedModelTextMock).not.toHaveBeenCalled();
    });

    it('rejects an incomplete hosted analysis after forwarding its partial output', async () => {
        mocks.trackStore.value = {
            tracks: [{ id: 'track-1', name: 'Lead', kind: 'audio', gain: 0.8, pan: 0, clips: [] }],
        };
        streamHostedModelTextMock.mockImplementation((input) => {
            input.onToken('Partial analysis');
            return Promise.resolve(
                createResult({
                    status: 'partial',
                    finishReason: 'length',
                    partialOutputDisposition: 'preserve',
                    failure: {
                        code: 'output-limit',
                        correlationId: 'mix-health-test',
                        retryable: true,
                        safeMessage: 'The model provider stopped at its output limit.',
                        partialOutputDisposition: 'preserve',
                    },
                })
            );
        });
        const onToken = vi.fn();

        await expect(mixHealthAnalysis({ onToken })).rejects.toThrow('stopped at its output limit');
        expect(onToken).toHaveBeenCalledWith('Partial analysis');
    });

    it('forwards cancellation to the hosted stream', async () => {
        mocks.trackStore.value = {
            tracks: [{ id: 'track-1', name: 'Lead', kind: 'audio', gain: 0.8, pan: 0, clips: [] }],
        };
        const controller = new AbortController();

        await mixHealthAnalysis({ onToken: vi.fn(), signal: controller.signal });

        expect(streamHostedModelTextMock.mock.calls[0]?.[0].signal).toBe(controller.signal);
    });
});
