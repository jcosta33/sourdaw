import { isCurrentMixAnalysisRun } from '../stores/mixAnalysisRunRegistry';
import { mixAnalysisStore } from '../stores/mixAnalysisStore';

type FailMixAnalysisInput = {
    token: number;
};

export function failMixAnalysis(input: FailMixAnalysisInput): void {
    if (!isCurrentMixAnalysisRun(input.token)) {
        return;
    }

    mixAnalysisStore.update((state) => {
        if (!state) {
            return state;
        }

        return { ...state, isAnalyzing: false };
    });
}
