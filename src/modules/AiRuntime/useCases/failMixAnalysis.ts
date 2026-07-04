import { mixAnalysisStore } from '../stores/mixAnalysisStore';

export function failMixAnalysis(): void {
    mixAnalysisStore.update((state) => {
        if (!state) {
            return state;
        }

        return { ...state, isAnalyzing: false };
    });
}
