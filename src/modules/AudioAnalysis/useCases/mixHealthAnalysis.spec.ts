import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { mixHealthAnalysis } from './mixHealthAnalysis';

describe('mixHealthAnalysis injectable', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('short-circuits when no tracks (smoke)', async () => {
        const getTrackStoreState = vi.fn().mockReturnValue(null);
        const streamCloudChatCompletion = vi.fn();
        const summarizeFeatures = vi.fn();
        injectDependencies(mixHealthAnalysis, { getTrackStoreState, streamCloudChatCompletion, summarizeFeatures });

        const onToken = vi.fn();
        await mixHealthAnalysis(onToken);

        expect(onToken).toHaveBeenCalledWith('No tracks found in the session to analyze.');
        expect(streamCloudChatCompletion).not.toHaveBeenCalled();
    });
});
