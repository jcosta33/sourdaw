import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mixHealthAnalysis } from '../mixHealthAnalysis';

const streamCloudChatCompletionMock = vi.fn();
const summarizeFeaturesMock = vi.fn();
const { mocks } = vi.hoisted(() => ({
    mocks: {
        trackStore: { value: null as unknown },
    },
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: mocks.trackStore,
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    summarizeFeatures: (...args: unknown[]) => summarizeFeaturesMock(...args),
}));

vi.mock('../../repositories/cloudLlm/cloudInference/streamCloudChatCompletion', () => ({
    streamCloudChatCompletion: (...args: unknown[]) => streamCloudChatCompletionMock(...args),
}));

describe('mixHealthAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.trackStore.value = null;
    });

    it('short-circuits when no tracks', async () => {
        const onToken = vi.fn();
        await mixHealthAnalysis(onToken);

        expect(onToken).toHaveBeenCalledWith('No tracks found in the session to analyze.');
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });
});
