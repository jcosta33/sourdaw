import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { executeAnalyzeMixAction } from './analysisHandlers';

describe('analysisHandlers', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('executeAnalyzeMixAction updates store with result when state exists', async () => {
        const baseState = { isAnalyzing: false, panelOpen: false, result: null };
        const getMixAnalysisStoreValue = vi.fn(() => baseState);
        const setMixAnalysisStoreValue = vi.fn();
        const analyzeMix = vi.fn().mockResolvedValue({
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

        injectDependencies(executeAnalyzeMixAction, {
            getMixAnalysisStoreValue,
            setMixAnalysisStoreValue,
            analyzeMix,
        });

        await executeAnalyzeMixAction();

        expect(setMixAnalysisStoreValue).toHaveBeenCalledWith(
            expect.objectContaining({ isAnalyzing: true })
        );
        expect(analyzeMix).toHaveBeenCalled();
        expect(setMixAnalysisStoreValue).toHaveBeenCalledWith(
            expect.objectContaining({ isAnalyzing: false, panelOpen: true })
        );
    });

    it('executeAnalyzeMixAction no-ops when mix analysis store is missing', async () => {
        const getMixAnalysisStoreValue = vi.fn(() => null);
        const setMixAnalysisStoreValue = vi.fn();
        const analyzeMix = vi.fn();

        injectDependencies(executeAnalyzeMixAction, {
            getMixAnalysisStoreValue,
            setMixAnalysisStoreValue,
            analyzeMix,
        });

        await executeAnalyzeMixAction();

        expect(analyzeMix).not.toHaveBeenCalled();
    });
});
