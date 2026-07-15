import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { RENDER_CACHE_EXTENSION, RENDERS_DIRECTORY } from './storageConstants';

type ReadRenderCacheInput = { cacheKey: string };
type ReadRenderCacheOutput = Promise<Float32Array | null>;

export const readRenderCache = inject({ logger })(
    ({ logger: _logger }) =>
        async function readRenderCache({ cacheKey }: ReadRenderCacheInput): ReadRenderCacheOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const cacheDir = await root.getDirectoryHandle(RENDERS_DIRECTORY, { create: false });
                const fileHandle = await cacheDir.getFileHandle(`${cacheKey}${RENDER_CACHE_EXTENSION}`, {
                    create: false,
                });
                const file = await fileHandle.getFile();
                const buffer = await file.arrayBuffer();
                return new Float32Array(buffer);
            } catch {
                return null;
            }
        }
);
