import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mixHealthAnalysis } from '../mixHealthAnalysis';

type CloudChatOutcome = { status: 'complete' } | { status: 'incomplete'; reason: string };

const { streamCloudChatCompletionMock, summarizeFeaturesMock, mocks } = vi.hoisted(() => {
    const trackStore: { value: unknown } = { value: null };

    return {
        streamCloudChatCompletionMock:
            vi.fn<
                (
                    messages: unknown,
                    onToken: (text: string) => void,
                    options?: { maxTokens?: number; signal?: AbortSignal }
                ) => Promise<CloudChatOutcome>
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

vi.mock('../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: streamCloudChatCompletionMock,
}));

describe('mixHealthAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = null;
        streamCloudChatCompletionMock.mockResolvedValue({ status: 'complete' });
    });

    it('short-circuits when no tracks', async () => {
        const onToken = vi.fn();
        await mixHealthAnalysis({ onToken });

        expect(onToken).toHaveBeenCalledWith('No tracks found in the session to analyze.');
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });

    it('rejects an incomplete hosted analysis after forwarding its partial output', async () => {
        mocks.trackStore.value = {
            tracks: [{ id: 'track-1', name: 'Lead', kind: 'audio', gain: 0.8, pan: 0, clips: [] }],
        };
        streamCloudChatCompletionMock.mockImplementation((_messages, onToken) => {
            onToken('Partial analysis');
            return Promise.resolve({ status: 'incomplete', reason: 'max_tokens' });
        });
        const onToken = vi.fn();

        await expect(mixHealthAnalysis({ onToken })).rejects.toThrow(
            'Hosted AI mix analysis was incomplete (max_tokens).'
        );
        expect(onToken).toHaveBeenCalledWith('Partial analysis');
    });

    it('forwards cancellation to the hosted stream', async () => {
        mocks.trackStore.value = {
            tracks: [{ id: 'track-1', name: 'Lead', kind: 'audio', gain: 0.8, pan: 0, clips: [] }],
        };
        const controller = new AbortController();

        await mixHealthAnalysis({ onToken: vi.fn(), signal: controller.signal });

        expect(streamCloudChatCompletionMock.mock.calls[0]?.[2]?.signal).toBe(controller.signal);
    });
});
