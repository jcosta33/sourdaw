import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mixHealthAnalysis } from '../mixHealthAnalysis';
import type { getTrackStoreState } from '#/modules/Arrangement/useCases';
import type { streamCloudChatCompletion } from '#/modules/AiRuntime/useCases';
import type { summarizeFeatures } from '../audioFeatures';

const getTrackStoreStateMock = vi.fn<typeof getTrackStoreState>().mockReturnValue(null);
const streamCloudChatCompletionMock = vi.fn<typeof streamCloudChatCompletion>();
const summarizeFeaturesMock = vi.fn<typeof summarizeFeatures>();

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: (...args: Parameters<typeof getTrackStoreStateMock>) => getTrackStoreStateMock(...args),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    streamCloudChatCompletion: (...args: Parameters<typeof streamCloudChatCompletionMock>) => streamCloudChatCompletionMock(...args),
}));

vi.mock('../audioFeatures', () => ({
    summarizeFeatures: (...args: Parameters<typeof summarizeFeaturesMock>) => summarizeFeaturesMock(...args),
}));

describe('mixHealthAnalysis injectable', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getTrackStoreStateMock.mockReturnValue(null);
    });

    it('short-circuits when no tracks (smoke)', async () => {
        const onToken = vi.fn();
        await mixHealthAnalysis(onToken);

        expect(onToken).toHaveBeenCalledWith('No tracks found in the session to analyze.');
        expect(streamCloudChatCompletionMock).not.toHaveBeenCalled();
    });
});
