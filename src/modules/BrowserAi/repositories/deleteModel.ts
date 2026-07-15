import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { MODELS_DIRECTORY } from './storageConstants';

type DeleteModelInput = { family: string; modelId: string };
type DeleteModelOutput = Promise<void>;

export const deleteModel = inject({ logger })(
    ({ logger }) =>
        async function deleteModel({ family, modelId }: DeleteModelInput): DeleteModelOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const modelsDir = await root.getDirectoryHandle(MODELS_DIRECTORY, { create: false });
                const familyDir = await modelsDir.getDirectoryHandle(family, { create: false });
                await familyDir.removeEntry(modelId);
                logger.info(`[StorageManager] Deleted model ${family}/${modelId}`);
            } catch (error) {
                logger.warn(`[StorageManager] Failed to delete model ${family}/${modelId}: ${String(error)}`);
            }
        }
);
