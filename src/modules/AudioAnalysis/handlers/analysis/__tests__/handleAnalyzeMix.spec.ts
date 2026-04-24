import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleAnalyzeMix } from '../handleAnalyzeMix';

const mocks = vi.hoisted(() => ({
    storeValue: null as unknown,
    storeSet: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/stores', () => ({
    mixAnalysisStore: {
        get value() {
            return mocks.storeValue;
        },
        set: mocks.storeSet,
    },
}));

vi.mock('../../../useCases/analyzeMix', () => ({
    analyzeMix: vi.fn(),
}));

import { analyzeMix } from '../../../useCases/analyzeMix';

describe('handleAnalyzeMix', () => {
    beforeEach(() => {
        mocks.storeValue = null;
        mocks.storeSet.mockReset();
        vi.mocked(analyzeMix).mockReset();
    });

    it('updates store with result when state exists', async () => {
        mocks.storeValue = { isAnalyzing: false, panelOpen: false, result: null };
        vi.mocked(analyzeMix).mockResolvedValue({
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
        });

        await handleAnalyzeMix.execute({ type: 'analyzeMix', payload: undefined });

        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ isAnalyzing: true }));
        expect(analyzeMix).toHaveBeenCalled();
        expect(mocks.storeSet).toHaveBeenCalledWith(
            expect.objectContaining({ isAnalyzing: false, panelOpen: true })
        );
    });

    it('no-ops when mix analysis store is missing', async () => {
        mocks.storeValue = null;

        await handleAnalyzeMix.execute({ type: 'analyzeMix', payload: undefined });

        expect(analyzeMix).not.toHaveBeenCalled();
    });
});
