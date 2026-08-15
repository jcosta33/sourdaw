import { logger } from '#/infra/logger/appLogger';
import { createHandler } from '#/utils/createHandler';

import { analyzeMix } from '../../useCases/analyzeMix';
import { mixAnalysisDisplayLifecycle } from '../../useCases/mixAnalysisDisplayLifecycle';

export const handleAnalyzeMix = createHandler<'analyzeMix'>({
    execute: async (_action, context) => {
        const token = mixAnalysisDisplayLifecycle.begin();
        if (token === null) {
            return;
        }

        try {
            const result = await analyzeMix(context?.signal);
            mixAnalysisDisplayLifecycle.complete({ token, result });
        } catch (error) {
            // A thrown analysis failure (e.g. an unusable master analyser node) must not be
            // swallowed silently — otherwise the panel just stops spinning and is
            // indistinguishable from "analysis ran and found nothing". Log it, then reset.
            logger.error(error instanceof Error ? error : new Error(`Mix analysis failed: ${String(error)}`));
            mixAnalysisDisplayLifecycle.fail({ token });
            throw error;
        }
    },
    describe: () => ({ label: 'Analyze mix' }),
    undoable: false,
});
