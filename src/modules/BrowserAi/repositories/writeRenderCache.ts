import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { abortWritable } from './abortWritable';
import { RENDER_CACHE_EXTENSION, RENDERS_DIRECTORY } from './storageConstants';

type WriteRenderCacheInput = { cacheKey: string; audio: Float32Array };
type WriteRenderCacheOutput = Promise<void>;

export const writeRenderCache = inject({ logger })(
    ({ logger }) =>
        async function writeRenderCache({ cacheKey, audio }: WriteRenderCacheInput): WriteRenderCacheOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const cacheDir = await root.getDirectoryHandle(RENDERS_DIRECTORY, { create: true });
                const fileHandle = await cacheDir.getFileHandle(`${cacheKey}${RENDER_CACHE_EXTENSION}`, {
                    create: true,
                });
                const writable = await fileHandle.createWritable();
                // Use ArrayBuffer explicitly for FileSystemWritableFileStream compatibility
                const buffer = audio.buffer.slice(0) as ArrayBuffer;
                try {
                    await writable.write(buffer);
                    await writable.close();
                } catch (error) {
                    await abortWritable(writable);
                    throw error;
                }
                logger.info(`[StorageManager] Cached render: ${cacheKey}`);
            } catch (error) {
                logger.warn(`[StorageManager] Failed to cache render ${cacheKey}: ${String(error)}`);
            }
        }
);
