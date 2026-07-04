import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type MixAnalysis } from '../../models/MixAnalysis';
import { mixAnalysisStore } from '../../stores/mixAnalysisStore';
import { beginMixAnalysis } from '../beginMixAnalysis';
import { completeMixAnalysis } from '../completeMixAnalysis';
import { failMixAnalysis } from '../failMixAnalysis';

const stale_result: MixAnalysis = {
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

const interleaved_result: MixAnalysis = {
    timestamp: 2,
    overallLevel: { peakDb: -4, rmsDb: -10 },
    frequencyBalance: {
        sub: 1,
        bass: 1,
        lowMid: 1,
        mid: 1,
        highMid: 1,
        high: 1,
    },
    trackLevels: [],
    issues: [],
    suggestions: ['Interleaved panel state should survive failures.'],
};

describe('failMixAnalysis', () => {
    beforeEach(() => {
        mixAnalysisStore.set({
            result: stale_result,
            isAnalyzing: false,
            panelOpen: false,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should stop analyzing without replacing interleaved result or panel state', () => {
        const update_spy = vi.spyOn(mixAnalysisStore, 'update');
        const token = beginMixAnalysis();
        if (token === null) {
            throw new Error('Expected mix analysis run token');
        }

        mixAnalysisStore.set({
            result: interleaved_result,
            isAnalyzing: true,
            panelOpen: true,
        });

        failMixAnalysis({ token });

        expect(update_spy).toHaveBeenCalledTimes(2);
        expect(mixAnalysisStore.value).toEqual({
            result: interleaved_result,
            isAnalyzing: false,
            panelOpen: true,
        });
    });

    it('should ignore stale run failures', () => {
        const first_token = beginMixAnalysis();
        if (first_token === null) {
            throw new Error('Expected first mix analysis run token');
        }

        completeMixAnalysis({ token: first_token, result: interleaved_result });
        const second_token = beginMixAnalysis();
        if (second_token === null) {
            throw new Error('Expected second mix analysis run token');
        }

        failMixAnalysis({ token: first_token });

        expect(mixAnalysisStore.value).toEqual({
            result: interleaved_result,
            isAnalyzing: true,
            panelOpen: true,
        });
    });
});
