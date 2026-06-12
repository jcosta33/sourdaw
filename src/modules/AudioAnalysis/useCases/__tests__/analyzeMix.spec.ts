import { describe, it, expect, vi, beforeEach } from 'vitest';

import { analyzeMix } from '../analyzeMix';

const getMasterAnalyserMock = vi.fn(() => ({}) as AnalyserNode);
const readLevelsMock = vi.fn(() => ({ peakDb: -6, rmsDb: -12 }));
const readFrequencyBalanceMock = vi.fn(() => ({
    sub: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    highMid: 0,
    high: 0,
}));
const detectIssuesMock = vi.fn(() => []);
const generateSuggestionsMock = vi.fn(() => []);
const getTrackStripMock = vi.fn();
const { mocks } = vi.hoisted(() => ({
    mocks: {
        trackStore: { value: { tracks: [], selectedTrackId: null } },
    },
}));

vi.mock('../../services/mixAnalysisHelpers', () => ({
    detectIssues: (...args: any[]) => detectIssuesMock(...args),
    generateSuggestions: (...args: any[]) => generateSuggestionsMock(...args),
    readFrequencyBalance: (...args: any[]) => readFrequencyBalanceMock(...args),
    readLevels: (...args: any[]) => readLevelsMock(...args),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    getMasterAnalyser: (...args: any[]) => getMasterAnalyserMock(...args),
    getTrackStrip: (...args: any[]) => getTrackStripMock(...args),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    trackStore: mocks.trackStore,
}));

describe('analyzeMix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns empty trackLevels when no tracks', async () => {
        const out = await analyzeMix();

        expect(out.trackLevels).toEqual([]);
        expect(detectIssuesMock).toHaveBeenCalled();
    });
});
