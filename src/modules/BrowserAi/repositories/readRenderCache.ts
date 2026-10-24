import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { accessRenderCache } from './renderCacheStorage';

type ReadRenderCacheInput = { cacheKey: string };
type ReadRenderCacheOutput = Promise<Float32Array | null>;

export const readRenderCache = inject({ logger, accessRenderCache })(
    ({ accessRenderCache, logger: _logger }) =>
        async function readRenderCache({ cacheKey }: ReadRenderCacheInput): ReadRenderCacheOutput {
            try {
                return await accessRenderCache({ cacheKey });
            } catch {
                return null;
            }
        }
);
