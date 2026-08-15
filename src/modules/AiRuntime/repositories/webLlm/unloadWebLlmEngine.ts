import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { engineState } from './engineLifecycleState';

export const unloadWebLlmEngine = inject({ logger })(
    ({ logger }) =>
        function unloadWebLlmEngine(): void {
            engineState.initController?.abort(new DOMException('WebLLM initialization unloaded', 'AbortError'));
            if (engineState.worker) {
                engineState.worker.terminate();
                engineState.worker = null;
            }
            engineState.engine = null;
            engineState.initPromise = null;
            engineState.initAttemptId = null;
            engineState.initModelId = null;
            engineState.initController = null;
            engineState.initSignal = null;
            engineState.initWaiterCount = 0;
            engineState.activeArtifactSetDigest = null;
            logger.info('[AI Engine] WebLLM unloaded from memory');
        }
);
