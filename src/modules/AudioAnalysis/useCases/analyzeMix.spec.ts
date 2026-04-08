import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { analyzeMix } from './analyzeMix';

describe('analyzeMix', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns empty trackLevels when no tracks', async () => {
        const getMasterAnalyser = vi.fn(() => ({}) as AnalyserNode);
        const readLevels = vi.fn(() => ({ peakDb: -6, rmsDb: -12 }));
        const readFrequencyBalance = vi.fn(() => ({
            sub: 0,
            bass: 0,
            lowMid: 0,
            mid: 0,
            highMid: 0,
            high: 0,
        }));
        const detectIssues = vi.fn(() => []);
        const generateSuggestions = vi.fn(() => []);
        const getTrackStrip = vi.fn();
        const getTrackStoreState = vi.fn(() => ({ tracks: [], selectedTrackId: null }));

        injectDependencies(analyzeMix, {
            getMasterAnalyser,
            readLevels,
            readFrequencyBalance,
            detectIssues,
            generateSuggestions,
            getTrackStrip,
            getTrackStoreState,
        });

        const out = await analyzeMix();

        expect(out.trackLevels).toEqual([]);
        expect(detectIssues).toHaveBeenCalled();
    });
});
