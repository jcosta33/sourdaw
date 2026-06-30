import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { nativeEngineState } from './lifecycleState';

export const stopNativeEngine = inject({ logger })(
    ({ logger }) =>
        async function stopNativeEngine(): Promise<void> {
            if (isTauri()) {
                await tauriInvoke('unload_native_llm');
            }
            nativeEngineState.ready = false;
            logger.info('[Native AI] Engine stopped');
        }
);
