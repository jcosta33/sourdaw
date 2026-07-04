import { beginMixAnalysisRun } from '../stores/mixAnalysisRunRegistry';
import { mixAnalysisStore } from '../stores/mixAnalysisStore';

export function beginMixAnalysis(): number | null {
    let run_token: number | null = null;

    mixAnalysisStore.update((state) => {
        if (!state || state.isAnalyzing) {
            return state;
        }

        run_token = beginMixAnalysisRun();
        return { ...state, isAnalyzing: true };
    });

    return run_token;
}
