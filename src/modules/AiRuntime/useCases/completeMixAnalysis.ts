import { type MixAnalysis } from '../models/MixAnalysis';
import { mixAnalysisStore } from '../stores/mixAnalysisStore';

type CompleteMixAnalysisInput = {
    result: MixAnalysis;
};

export function completeMixAnalysis(input: CompleteMixAnalysisInput): void {
    mixAnalysisStore.update((state) => {
        if (!state) {
            return {
                result: input.result,
                isAnalyzing: false,
                panelOpen: true,
            };
        }

        return {
            ...state,
            result: input.result,
            isAnalyzing: false,
            panelOpen: true,
        };
    });
}
