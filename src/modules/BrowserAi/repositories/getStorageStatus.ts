import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type StorageStatus, DEFAULT_CACHE_LIMIT_BYTES } from '../models/StorageStatus';

import { MODELS_DIRECTORY, RENDERS_DIRECTORY } from './storageConstants';

type GetStorageStatusOutput = Promise<StorageStatus>;

/**
 * Compute total OPFS usage and return storage status.
 */
export const getStorageStatus = inject({ logger })(
    ({ logger }) =>
        async function getStorageStatus(): GetStorageStatusOutput {
            let usedBytes = 0;

            try {
                const root = await navigator.storage.getDirectory();

                async function measureDir(dir: FileSystemDirectoryHandle): Promise<number> {
                    let size = 0;
                    // FileSystemDirectoryHandle is async iterable in Chrome (OPFS) but not typed in lib.dom.d.ts
                    for await (const [, handle] of dir as AsyncIterable<
                        [string, FileSystemFileHandle | FileSystemDirectoryHandle]
                    >) {
                        if (handle.kind === 'file') {
                            const file = await handle.getFile();
                            size += file.size;
                        } else if (handle.kind === 'directory') {
                            size += await measureDir(handle);
                        }
                    }
                    return size;
                }

                // Measure only the directories this module owns. Walking the entire OPFS
                // root would count every other module's bytes (project files, render
                // caches outside ours, etc.) against the BrowserAi cache budget.
                for (const subdir of [MODELS_DIRECTORY, RENDERS_DIRECTORY]) {
                    const dir = await root.getDirectoryHandle(subdir, { create: false }).catch(() => null);
                    if (dir) {
                        usedBytes += await measureDir(dir);
                    }
                }
            } catch (error) {
                logger.warn(`[StorageManager] Failed to measure storage: ${String(error)}`);
            }

            let availableBytes: number | null = null;
            let persisted = false;

            try {
                const estimate = await navigator.storage.estimate();
                availableBytes = (estimate.quota ?? 0) - (estimate.usage ?? 0);
            } catch {
                // storage.estimate() not available
            }

            try {
                persisted = await navigator.storage.persisted();
            } catch {
                // storage.persisted() not available
            }

            return {
                usedBytes,
                limitBytes: DEFAULT_CACHE_LIMIT_BYTES,
                persisted,
                availableBytes,
            };
        }
);
