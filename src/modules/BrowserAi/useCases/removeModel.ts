/**
 * Use case: Remove a cached model from OPFS.
 *
 * Updates the model registry store after deletion.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { deleteModel, getStorageStatus } from '../repositories/storageManager';
import { updateModelStatus, setStorageUsed } from '../stores/modelRegistryStore';

type RemoveModelInput = {
    modelId: string;
    family: string;
};

export const removeModel = inject({ logger, deleteModel, getStorageStatus })(
    ({ logger, deleteModel, getStorageStatus }) =>
        async function removeModel({ modelId, family }: RemoveModelInput): Promise<void> {
            logger.info(`[BrowserAi] Removing model: ${modelId}`);
            await deleteModel({ family, modelId });
            updateModelStatus(modelId, { status: 'not-downloaded', downloadProgress: 0 });

            const status = await getStorageStatus();
            setStorageUsed(status.usedBytes);
        }
);
