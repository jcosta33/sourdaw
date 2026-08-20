import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';

type DeleteModelInput = { family: string; modelId: string };
type DeleteModelOutput = Promise<void>;

export const deleteModel = inject({ logger, modelStorageWorkerBridge })(
    ({ logger, modelStorageWorkerBridge }) =>
        async function deleteModel({ family, modelId }: DeleteModelInput): DeleteModelOutput {
            try {
                await modelStorageWorkerBridge.deleteModel({ family, modelId });
                logger.info(`[StorageManager] Deleted model ${family}/${modelId}`);
            } catch (error) {
                logger.warn(`[StorageManager] Failed to delete model ${family}/${modelId}: ${String(error)}`);
                throw error;
            }
        }
);
