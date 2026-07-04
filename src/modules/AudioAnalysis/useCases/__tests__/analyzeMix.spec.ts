import { describe, it, expect, vi, beforeEach } from 'vitest';

import { analyzeMix } from '../analyzeMix';

const { mocks } = vi.hoisted(() => ({
    mocks: {
        getMasterAnalyser: vi.fn(() => ({}) as AnalyserNode),
        readLevels: vi.fn(() => ({ peakDb: -6, rmsDb: -12 })),
        readFrequencyBalance: vi.fn(() => ({
            sub: 0,
            bass: 0,
            lowMid: 0,
            mid: 0,
            highMid: 0,
            high: 0,
        })),
        detectIssues: vi.fn(() => []),
        generateSuggestions: vi.fn(() => []),
        getTrackStrip: vi.fn(),
        getTrackStoreState: vi.fn(() => ({ tracks: [], selectedTrackId: null })),
    },
}));

vi.mock('../../services/mixAnalysisHelpers', () => ({
    detectIssues: mocks.detectIssues,
    generateSuggestions: mocks.generateSuggestions,
    readFrequencyBalance: mocks.readFrequencyBalance,
    readLevels: mocks.readLevels,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: mocks.getMasterAnalyser,
    getTrackStrip: mocks.getTrackStrip,
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));

describe('analyzeMix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getTrackStoreState.mockReturnValue({ tracks: [], selectedTrackId: null });
    });

    it('returns empty trackLevels when no tracks', async () => {
        const out = await analyzeMix();

        expect(out.trackLevels).toEqual([]);
        expect(mocks.getTrackStoreState).toHaveBeenCalled();
        expect(mocks.detectIssues).toHaveBeenCalled();
    });
});
