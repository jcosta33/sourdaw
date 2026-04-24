import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getMixAnalysisStoreValue, setMixAnalysisStoreValue } from '#/modules/AiRuntime/useCases';

import { analyzeMix } from '../../../useCases/analyzeMix';
import { handleAnalyzeMix } from '../handleAnalyzeMix';

vi.mock('#/modules/AiRuntime/useCases', () => ({
    getMixAnalysisStoreValue: vi.fn(),
    setMixAnalysisStoreValue: vi.fn(),
}));

vi.mock('../../../useCases/analyzeMix', () => ({
    analyzeMix: vi.fn(),
}));

describe('handleAnalyzeMix', () => {
    beforeEach(() => {
        vi.mocked(getMixAnalysisStoreValue).mockReset();
        vi.mocked(setMixAnalysisStoreValue).mockReset();
        vi.mocked(analyzeMix).mockReset();
    });

    it('updates store with result when state exists', async () => {
        const baseState = { isAnalyzing: false, panelOpen: false, result: null };
        vi.mocked(getMixAnalysisStoreValue).mockReturnValue(baseState);
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

        expect(setMixAnalysisStoreValue).toHaveBeenCalledWith(expect.objectContaining({ isAnalyzing: true }));
        expect(analyzeMix).toHaveBeenCalled();
        expect(setMixAnalysisStoreValue).toHaveBeenCalledWith(
            expect.objectContaining({ isAnalyzing: false, panelOpen: true })
        );
    });

    it('no-ops when mix analysis store is missing', async () => {
        vi.mocked(getMixAnalysisStoreValue).mockReturnValue(null);

        await handleAnalyzeMix.execute({ type: 'analyzeMix', payload: undefined });

        expect(analyzeMix).not.toHaveBeenCalled();
    });
});
