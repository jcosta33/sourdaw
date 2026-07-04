import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { type MixAnalysis } from '../../models/MixAnalysis';
import { mixAnalysisStore } from '../../stores/mixAnalysisStore';
import { beginMixAnalysis } from '../beginMixAnalysis';

const analysis_result: MixAnalysis = {
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

describe('beginMixAnalysis', () => {
    beforeEach(() => {
        mixAnalysisStore.set({
            result: analysis_result,
            isAnalyzing: false,
            panelOpen: true,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should mark analysis as running without replacing result or panel state', () => {
        const update_spy = vi.spyOn(mixAnalysisStore, 'update');

        beginMixAnalysis();

        expect(update_spy).toHaveBeenCalledTimes(1);
        expect(mixAnalysisStore.value).toEqual({
            result: analysis_result,
            isAnalyzing: true,
            panelOpen: true,
        });
    });
});
