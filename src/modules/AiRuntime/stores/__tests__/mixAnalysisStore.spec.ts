import { describe, it, expect, beforeEach } from 'vitest';

import { mixAnalysisStore, toggleMixAnalysisPanel } from '../mixAnalysisStore';

describe('mixAnalysisStore', () => {
    beforeEach(() => {
        mixAnalysisStore.set({ result: null, isAnalyzing: false, panelOpen: false });
    });

    it('initializes with default values', () => {
        expect(mixAnalysisStore.value).toEqual({
            result: null,
            isAnalyzing: false,
            panelOpen: false,
        });
    });

    describe('toggleMixAnalysisPanel', () => {
        it('toggles the panelOpen state', () => {
            expect(mixAnalysisStore.value!.panelOpen).toBe(false);

            toggleMixAnalysisPanel();
            expect(mixAnalysisStore.value!.panelOpen).toBe(true);

            toggleMixAnalysisPanel();
            expect(mixAnalysisStore.value!.panelOpen).toBe(false);
        });
    });
});
