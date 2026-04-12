import { describe, it, expect, beforeEach } from 'vitest';
import { setMixAnalysisStoreValue } from '../setMixAnalysisStoreValue';
import { mixAnalysisStore } from '#/modules/AiRuntime/stores/mixAnalysisStore';

describe('setMixAnalysisStoreValue', () => {
    beforeEach(() => {
        mixAnalysisStore.set({ result: null, isAnalyzing: false, panelOpen: false });
    });

    it('updates the mix analysis store', () => {
        expect(mixAnalysisStore.value?.isAnalyzing).toBe(false);

        setMixAnalysisStoreValue({
            result: null,
            isAnalyzing: true,
            panelOpen: true,
        });
        
        expect(mixAnalysisStore.value?.isAnalyzing).toBe(true);
        expect(mixAnalysisStore.value?.panelOpen).toBe(true);
    });
});
