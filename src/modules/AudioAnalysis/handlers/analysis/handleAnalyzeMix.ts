import { mixAnalysisStore } from '#/modules/AiRuntime/stores';
import { createHandler } from '#/utils/createHandler';

import { analyzeMix } from '../../useCases/analyzeMix';

export const handleAnalyzeMix = createHandler<'analyzeMix'>({
    execute: async () => {
        const state = mixAnalysisStore.value;
        if (!state) {
            return;
        }

        mixAnalysisStore.set({ ...state, isAnalyzing: true });

        try {
            const result = await analyzeMix();
            mixAnalysisStore.set({ result, isAnalyzing: false, panelOpen: true });
        } catch {
            mixAnalysisStore.set({ ...state, isAnalyzing: false });
        }
    },
    describe: () => ({ label: 'Analyze mix' }),
    undoable: false,
});
