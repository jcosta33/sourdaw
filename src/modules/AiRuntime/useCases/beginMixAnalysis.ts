import { mixAnalysisStore } from '../stores/mixAnalysisStore';

export function beginMixAnalysis(): boolean {
    let did_begin = false;

    mixAnalysisStore.update((state) => {
        if (!state) {
            return state;
        }

        did_begin = true;
        return { ...state, isAnalyzing: true };
    });

    return did_begin;
}
