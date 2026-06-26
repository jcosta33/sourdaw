import { logger } from '#/infra/logger/appLogger';
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
        } catch (error) {
            // A thrown analysis failure (e.g. an unusable master analyser node) must not be
            // swallowed silently — otherwise the panel just stops spinning and is
            // indistinguishable from "analysis ran and found nothing". Log it, then reset.
            logger.error(error instanceof Error ? error : new Error(`Mix analysis failed: ${String(error)}`));
            mixAnalysisStore.set({ ...state, isAnalyzing: false });
        }
    },
    describe: () => ({ label: 'Analyze mix' }),
    undoable: false,
});
