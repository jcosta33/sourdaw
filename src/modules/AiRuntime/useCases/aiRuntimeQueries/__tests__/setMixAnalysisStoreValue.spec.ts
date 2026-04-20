import { describe, it, expect, beforeEach } from 'vitest';

import { mixAnalysisStore } from '../../../stores/mixAnalysisStore';
import { setMixAnalysisStoreValue } from '../setMixAnalysisStoreValue';

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
