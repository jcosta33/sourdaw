import { describe, it, expect, vi, beforeEach } from 'vitest';

import { mixHealthAnalysis } from '../mixHealthAnalysis';

const getTrackStoreStateMock = vi.fn().mockReturnValue(null);
const streamCloudChatCompletionMock = vi.fn();
const summarizeFeaturesMock = vi.fn();

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: (...args: any[]) => getTrackStoreStateMock(...args),
}));

vi.mock('#/modules/AiRuntime/useCases', () => ({
    streamCloudChatCompletion: (...args: any[]) => streamCloudChatCompletionMock(...args),
}));

vi.mock('../audioFeatures', () => ({
    summarizeFeatures: (...args: any[]) => summarizeFeaturesMock(...args),
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
