import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';

type CheckVerifiedModelInput = {
    family: string;
    modelId: string;
    sha256: string;
    sizeBytes: number;
};

export const checkVerifiedModel = inject({ logger, modelStorageWorkerBridge })(
    ({ logger, modelStorageWorkerBridge }) =>
        async function checkVerifiedModel({
            family,
            modelId,
            sha256,
            sizeBytes,
        }: CheckVerifiedModelInput): Promise<boolean> {
            try {
                return await modelStorageWorkerBridge.verifyModel({
                    family,
                    modelId,
                    expectedSha256: sha256,
                    expectedSizeBytes: sizeBytes,
                });
            } catch (error) {
                logger.warn(`[StorageManager] Failed to verify model ${family}/${modelId}: ${String(error)}`);
                throw error;
            }
        }
);
