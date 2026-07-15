import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { isNotFoundError } from './isNotFoundError';
import { MODELS_DIRECTORY } from './storageConstants';
import { toOpfsPath } from './toOpfsPath';

type CheckModelCachedInput = { family: string; modelId: string };
type CheckModelCachedOutput = Promise<boolean>;

/**
 * A genuine cache miss surfaces as a DOMException with name 'NotFoundError'
 * (the directory or file does not exist). Any other error -- a permission
 * failure, a corrupt OPFS, or transient IO -- must NOT be silently reported as
 * "not cached", or a recoverable fault would masquerade as an absent model.
 */
export const checkModelCached = inject({ logger })(
    ({ logger }) =>
        async function checkModelCached({ family, modelId }: CheckModelCachedInput): CheckModelCachedOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const modelsDir = await root
                    .getDirectoryHandle(MODELS_DIRECTORY, { create: false })
                    .catch((error: unknown) => {
                        if (isNotFoundError(error)) {
                            return null;
                        }
                        throw error;
                    });
                if (!modelsDir) {
                    return false;
                }
                const path = toOpfsPath({ family, modelId });
                const parts = path.split('/');
                const fileName = parts.pop()!;
                let dir: FileSystemDirectoryHandle = modelsDir;
                for (const part of parts) {
                    const next = await dir.getDirectoryHandle(part, { create: false }).catch((error: unknown) => {
                        if (isNotFoundError(error)) {
                            return null;
                        }
                        throw error;
                    });
                    if (!next) {
                        return false;
                    }
                    dir = next;
                }
                await dir.getFileHandle(fileName, { create: false });
                logger.debug(`[StorageManager] Model cached: ${family}/${modelId}`);
                return true;
            } catch (error) {
                if (isNotFoundError(error)) {
                    // True miss: the file does not exist.
                    logger.debug(`[StorageManager] Model not cached: ${family}/${modelId}`);
                    return false;
                }
                // Permission failure / corrupt OPFS / transient IO -- surface it rather
                // than collapsing it into a false "not cached" result.
                logger.warn(`[StorageManager] checkModelCached failed for ${family}/${modelId}: ${String(error)}`);
                throw error;
            }
        }
);
