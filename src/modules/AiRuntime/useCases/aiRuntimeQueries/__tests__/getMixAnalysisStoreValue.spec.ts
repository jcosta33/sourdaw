import { describe, it, expect, beforeEach } from 'vitest';

import { mixAnalysisStore } from '../../../stores/mixAnalysisStore';
import { getMixAnalysisStoreValue } from '../getMixAnalysisStoreValue';

describe('getMixAnalysisStoreValue', () => {
    beforeEach(() => {
        mixAnalysisStore.set({ result: null, isAnalyzing: false, panelOpen: false });
    });

    it('returns the current value of the mix analysis store', () => {
        const val1 = getMixAnalysisStoreValue();
        expect(val1?.isAnalyzing).toBe(false);

        mixAnalysisStore.set({ result: null, isAnalyzing: true, panelOpen: true });

        const val2 = getMixAnalysisStoreValue();
        expect(val2?.isAnalyzing).toBe(true);
        expect(val2?.panelOpen).toBe(true);
    });
});
