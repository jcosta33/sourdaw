import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { engineState } from './engineLifecycleState';

export const unloadWebLlmEngine = inject({ logger })(
    ({ logger }) =>
        function unloadWebLlmEngine(): void {
            if (engineState.worker) {
                engineState.worker.terminate();
                engineState.worker = null;
            }
            engineState.engine = null;
            engineState.initPromise = null;
            logger.info('[AI Engine] WebLLM unloaded from memory');
        }
);
