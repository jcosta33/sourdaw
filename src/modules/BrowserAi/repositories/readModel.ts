import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { isNotFoundError } from './isNotFoundError';
import { resolveFileHandle } from './resolveFileHandle';
import { MODELS_DIRECTORY } from './storageConstants';
import { toOpfsPath } from './toOpfsPath';

type ReadModelInput = { family: string; modelId: string };
type ReadModelOutput = Promise<ArrayBuffer | null>;

export const readModel = inject({ logger })(
    ({ logger }) =>
        async function readModel({ family, modelId }: ReadModelInput): ReadModelOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const modelsDir = await root.getDirectoryHandle(MODELS_DIRECTORY, { create: false });
                const fileHandle = await resolveFileHandle({
                    opfsRoot: modelsDir,
                    relativePath: toOpfsPath({ family, modelId }),
                    create: false,
                });
                const file = await fileHandle.getFile();
                return file.arrayBuffer();
            } catch (error) {
                if (isNotFoundError(error)) {
                    return null;
                }
                logger.warn(`[StorageManager] Failed to read model ${family}/${modelId}: ${String(error)}`);
                throw error;
            }
        }
);
