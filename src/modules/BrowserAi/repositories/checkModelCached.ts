import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';

type CheckModelCachedInput = { family: string; modelId: string };
type CheckModelCachedOutput = Promise<boolean>;

/**
 * The storage worker reports missing directories/files as a normal false result.
 * Permission, corrupt-OPFS, and transient IO failures still reject so a fault
 * cannot masquerade as an absent model.
 */
export const checkModelCached = inject({ logger, modelStorageWorkerBridge })(
    ({ logger, modelStorageWorkerBridge }) =>
        async function checkModelCached({ family, modelId }: CheckModelCachedInput): CheckModelCachedOutput {
            try {
                const cached = await modelStorageWorkerBridge.checkModel({ family, modelId });
                logger.debug(`[StorageManager] Model ${cached ? 'cached' : 'not cached'}: ${family}/${modelId}`);
                return cached;
            } catch (error) {
                // Permission failure / corrupt OPFS / transient IO -- surface it rather
                // than collapsing it into a false "not cached" result.
                logger.warn(`[StorageManager] checkModelCached failed for ${family}/${modelId}: ${String(error)}`);
                throw error;
            }
        }
);
