import { createStore } from '#/infra/store/createStore';
import { type MixAnalysis } from '../models/MixAnalysis';

export type MixAnalysisStoreState = {
    result: MixAnalysis | null;
    isAnalyzing: boolean;
    panelOpen: boolean;
};

export const mixAnalysisStore = createStore<MixAnalysisStoreState>({
    initialData: {
        result: null,
        isAnalyzing: false,
        panelOpen: false,
    },
});

export function toggleMixAnalysisPanel(): void {
    const state = mixAnalysisStore.value;
    if (!state) {
        return;
    }
    mixAnalysisStore.set({ ...state, panelOpen: !state.panelOpen });
}
