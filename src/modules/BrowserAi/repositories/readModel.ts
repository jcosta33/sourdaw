import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';

type ReadModelInput = {
    family: string;
    modelId: string;
    expectedSizeBytes?: number;
    expectedSha256?: string;
};
type ReadModelOutput = Promise<MessagePort | null>;

export const readModel = inject({ logger, modelStorageWorkerBridge })(
    ({ logger, modelStorageWorkerBridge }) =>
        async function readModel(input: ReadModelInput): ReadModelOutput {
            const { family, modelId } = input;
            try {
                return await modelStorageWorkerBridge.readModel(input);
            } catch (error) {
                logger.warn(`[StorageManager] Failed to read model ${family}/${modelId}: ${String(error)}`);
                throw error;
            }
        }
);
