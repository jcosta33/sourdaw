import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isAppActionCommittedError } from '#/modules/Command/useCases';

import { analyzeMix, type AnalyzeMixOutput } from '../../../useCases/analyzeMix';
import { handleAnalyzeMix } from '../handleAnalyzeMix';

const mocks = vi.hoisted(() => ({
    beginLifecycle: vi.fn<() => number | null>(),
    completeLifecycle: vi.fn<(input: { token: number; result: AnalyzeMixOutput }) => void>(),
    failLifecycle: vi.fn<(input: { token: number }) => void>(),
    loggerError: vi.fn(),
}));

vi.mock('../../../useCases/mixAnalysisDisplayLifecycle', () => ({
    mixAnalysisDisplayLifecycle: {
        begin: mocks.beginLifecycle,
        complete: mocks.completeLifecycle,
        fail: mocks.failLifecycle,
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
        mocks.beginLifecycle.mockReset();
        mocks.beginLifecycle.mockReturnValue(7);
        mocks.completeLifecycle.mockReset();
        mocks.failLifecycle.mockReset();
        mocks.loggerError.mockReset();
        vi.mocked(analyzeMix).mockReset();
    });

    it('updates store with result when state exists', async () => {
        const result: AnalyzeMixOutput = {
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
        vi.mocked(analyzeMix).mockResolvedValue(result);

        await handleAnalyzeMix.execute({ type: 'analyzeMix', payload: undefined });

        expect(mocks.beginLifecycle).toHaveBeenCalled();
        expect(analyzeMix).toHaveBeenCalled();
        expect(mocks.completeLifecycle).toHaveBeenCalledWith({ token: 7, result });
    });

    it('passes the command cancellation signal into analysis work', async () => {
        const action = { type: 'analyzeMix', payload: undefined } as const;
        const controller = new AbortController();
        vi.mocked(analyzeMix).mockResolvedValue({
            timestamp: 1,
            overallLevel: { peakDb: -6, rmsDb: -12 },
            frequencyBalance: { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0 },
            trackLevels: [],
            issues: [],
            suggestions: [],
        });

        await handleAnalyzeMix.execute(action, {
            actions: [action],
            actionIndex: 0,
            signal: controller.signal,
        });

        expect(analyzeMix).toHaveBeenCalledExactlyOnceWith(controller.signal);
    });

    it('no-ops when mix analysis store is missing', async () => {
        mocks.beginLifecycle.mockReturnValue(null);

        await handleAnalyzeMix.execute({ type: 'analyzeMix', payload: undefined });

        expect(analyzeMix).not.toHaveBeenCalled();
        expect(mocks.completeLifecycle).not.toHaveBeenCalled();
    });

    it('logs the error and resets isAnalyzing when analysis throws', async () => {
        const failure = new Error('master analyser unusable');
        vi.mocked(analyzeMix).mockRejectedValue(failure);

        await expect(handleAnalyzeMix.execute({ type: 'analyzeMix', payload: undefined })).rejects.toBe(failure);

        expect(mocks.loggerError).toHaveBeenCalledWith(failure);
        expect(mocks.failLifecycle).toHaveBeenCalledWith({ token: 7 });
        expect(isAppActionCommittedError(failure)).toBe(false);
    });
});
