import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { accessRenderCache } from './renderCacheStorage';

type WriteRenderCacheInput = { cacheKey: string; audio: Float32Array };
type WriteRenderCacheOutput = Promise<void>;

export const writeRenderCache = inject({ logger })(
    ({ logger }) =>
        async function writeRenderCache({ cacheKey, audio }: WriteRenderCacheInput): WriteRenderCacheOutput {
            try {
                const cached = await accessRenderCache({ cacheKey, audio });
                if (cached === null) {
                    return;
                }
                logger.info(`[StorageManager] Cached render: ${cacheKey}`);
            } catch (error) {
                logger.warn(`[StorageManager] Failed to cache render ${cacheKey}: ${String(error)}`);
            }
        }
);
