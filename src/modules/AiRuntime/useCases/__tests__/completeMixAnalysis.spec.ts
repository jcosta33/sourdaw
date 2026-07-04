import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type MixAnalysis } from '../../models/MixAnalysis';
import { mixAnalysisStore } from '../../stores/mixAnalysisStore';
import { beginMixAnalysis } from '../beginMixAnalysis';
import { completeMixAnalysis } from '../completeMixAnalysis';

const previous_result: MixAnalysis = {
    timestamp: 1,
    overallLevel: { peakDb: -6, rmsDb: -12 },
    frequencyBalance: {
        sub: 0,
        bass: 0,
        lowMid: 0,
        mid: 0,
        highMid: 0,
        high: 0,
    },
    trackLevels: [],
    issues: [],
    suggestions: [],
};

const completed_result: MixAnalysis = {
    timestamp: 2,
    overallLevel: { peakDb: -3, rmsDb: -9 },
    frequencyBalance: {
        sub: 1,
        bass: 2,
        lowMid: 3,
        mid: 4,
        highMid: 5,
        high: 6,
    },
    trackLevels: [
        {
            trackId: 'track-1',
            trackName: 'Lead',
            peakDb: -3,
            rmsDb: -9,
            isMuted: false,
            isSoloed: false,
            isClipping: false,
        },
    ],
    issues: [],
    suggestions: ['Leave more headroom on the mix bus.'],
};

describe('completeMixAnalysis', () => {
    beforeEach(() => {
        mixAnalysisStore.set({
            result: previous_result,
            isAnalyzing: false,
            panelOpen: false,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should store the completed result, stop analyzing, and open the panel', () => {
        const update_spy = vi.spyOn(mixAnalysisStore, 'update');
        const token = beginMixAnalysis();
        if (token === null) {
            throw new Error('Expected mix analysis run token');
        }

        completeMixAnalysis({ token, result: completed_result });

        expect(update_spy).toHaveBeenCalledTimes(2);
        expect(mixAnalysisStore.value).toEqual({
            result: completed_result,
            isAnalyzing: false,
            panelOpen: true,
        });
    });

    it('should ignore stale run completions', () => {
        const first_token = beginMixAnalysis();
        if (first_token === null) {
            throw new Error('Expected first mix analysis run token');
        }

        completeMixAnalysis({ token: first_token, result: completed_result });
        const second_token = beginMixAnalysis();
        if (second_token === null) {
            throw new Error('Expected second mix analysis run token');
        }

        completeMixAnalysis({ token: first_token, result: previous_result });

        expect(mixAnalysisStore.value).toEqual({
            result: completed_result,
            isAnalyzing: true,
            panelOpen: true,
        });
    });
});
