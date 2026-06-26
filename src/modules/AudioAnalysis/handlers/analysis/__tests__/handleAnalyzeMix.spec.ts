import { describe, it, expect, vi, beforeEach } from 'vitest';

import { analyzeMix } from '../../../useCases/analyzeMix';
import { handleAnalyzeMix } from '../handleAnalyzeMix';

const mocks = vi.hoisted(() => ({
    storeValue: null as unknown,
    storeSet: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('#/modules/AiRuntime/stores', () => ({
    mixAnalysisStore: {
        get value() {
            return mocks.storeValue;
        },
        set: mocks.storeSet,
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: mocks.loggerError },
}));

vi.mock('../../../useCases/analyzeMix', () => ({
    analyzeMix: vi.fn(),
}));

describe('handleAnalyzeMix', () => {
    beforeEach(() => {
        mocks.storeValue = null;
        mocks.storeSet.mockReset();
        mocks.loggerError.mockReset();
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
        expect(mocks.storeSet).toHaveBeenCalledWith(expect.objectContaining({ isAnalyzing: false, panelOpen: true }));
    });

    it('no-ops when mix analysis store is missing', async () => {
        mocks.storeValue = null;

        await handleAnalyzeMix.execute({ type: 'analyzeMix', payload: undefined });

        expect(analyzeMix).not.toHaveBeenCalled();
    });

    it('logs the error and resets isAnalyzing when analysis throws', async () => {
        mocks.storeValue = { isAnalyzing: false, panelOpen: false, result: null };
        const failure = new Error('master analyser unusable');
        vi.mocked(analyzeMix).mockRejectedValue(failure);

        await handleAnalyzeMix.execute({ type: 'analyzeMix', payload: undefined });

        expect(mocks.loggerError).toHaveBeenCalledWith(failure);
        expect(mocks.storeSet).toHaveBeenLastCalledWith(expect.objectContaining({ isAnalyzing: false }));
    });
});
