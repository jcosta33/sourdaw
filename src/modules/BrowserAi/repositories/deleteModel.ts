import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { isNotFoundError } from './isNotFoundError';
import { MODELS_DIRECTORY } from './storageConstants';

type DeleteModelInput = { family: string; modelId: string };
type DeleteModelOutput = Promise<void>;

export const deleteModel = inject({ logger })(
    ({ logger }) =>
        async function deleteModel({ family, modelId }: DeleteModelInput): DeleteModelOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const modelsDir = await root.getDirectoryHandle(MODELS_DIRECTORY, { create: false });
                let familyDir = modelsDir;
                for (const segment of family.split('/').filter(Boolean)) {
                    familyDir = await familyDir.getDirectoryHandle(segment, { create: false });
                }
                await familyDir.removeEntry(modelId);
                logger.info(`[StorageManager] Deleted model ${family}/${modelId}`);
            } catch (error) {
                if (isNotFoundError(error)) {
                    return;
                }
                logger.warn(`[StorageManager] Failed to delete model ${family}/${modelId}: ${String(error)}`);
                throw error;
            }
        }
);
