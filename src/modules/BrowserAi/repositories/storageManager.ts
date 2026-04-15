/**
 * Repository: OPFS storage manager for model files.
 *
 * Handles reading, writing, and deleting model files in OPFS.
 * OPFS provides 2-4x faster reads than IndexedDB via synchronous
 * access handles in Web Workers.
 *
 * All path operations use a flat directory scheme:
 *   models/<family>/<model-id>.bin
 *   renders/<cache-key>.pcm
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { type StorageStatus, DEFAULT_CACHE_LIMIT_BYTES } from '../models/StorageStatus';

type ModelPath = {
    family: string;
    modelId: string;
};

function toOpfsPath({ family, modelId }: ModelPath): string {
    return `${family}/${modelId}`;
}

/**
 * Resolve an OPFS file handle for a model.
 * Creates intermediate directories as needed.
 */
async function resolveFileHandle(
    opfsRoot: FileSystemDirectoryHandle,
    relativePath: string,
    options: { create: boolean }
): Promise<FileSystemFileHandle> {
    const parts = relativePath.split('/');
    const fileName = parts.pop()!;
    let dir = opfsRoot;
    for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: options.create });
    }
    return dir.getFileHandle(fileName, { create: options.create });
}

type CheckModelCachedInput = { family: string; modelId: string };
type CheckModelCachedOutput = Promise<boolean>;

type ReadModelInput = { family: string; modelId: string };
type ReadModelOutput = Promise<ArrayBuffer | null>;

type WriteModelInput = { family: string; modelId: string; data: ArrayBuffer };
type WriteModelOutput = Promise<void>;

type DeleteModelInput = { family: string; modelId: string };
type DeleteModelOutput = Promise<void>;

type ReadRenderCacheInput = { cacheKey: string };
type ReadRenderCacheOutput = Promise<Float32Array | null>;

type WriteRenderCacheInput = { cacheKey: string; audio: Float32Array };
type WriteRenderCacheOutput = Promise<void>;

type GetStorageStatusOutput = Promise<StorageStatus>;

export const checkModelCached = inject({ logger })(
    ({ logger }) =>
        async function checkModelCached({ family, modelId }: CheckModelCachedInput): CheckModelCachedOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const modelsDir = await root.getDirectoryHandle('models', { create: false }).catch(() => null);
                if (!modelsDir) {
                    return false;
                }
                const path = toOpfsPath({ family, modelId });
                const parts = path.split('/');
                const fileName = parts.pop()!;
                let dir: FileSystemDirectoryHandle = modelsDir;
                for (const part of parts) {
                    const next = await dir.getDirectoryHandle(part, { create: false }).catch(() => null);
                    if (!next) {
                        return false;
                    }
                    dir = next;
                }
                await dir.getFileHandle(fileName, { create: false });
                return true;
            } catch {
                logger.info(`[StorageManager] Model not cached: ${family}/${modelId}`);
                return false;
            }
        }
);

export const readModel = inject({ logger })(
    ({ logger }) =>
        async function readModel({ family, modelId }: ReadModelInput): ReadModelOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const modelsDir = await root.getDirectoryHandle('models', { create: false });
                const fileHandle = await resolveFileHandle(modelsDir, toOpfsPath({ family, modelId }), { create: false });
                const file = await fileHandle.getFile();
                return file.arrayBuffer();
            } catch (error) {
                logger.warn(`[StorageManager] Failed to read model ${family}/${modelId}: ${String(error)}`);
                return null;
            }
        }
);

export const writeModel = inject({ logger })(
    ({ logger }) =>
        async function writeModel({ family, modelId, data }: WriteModelInput): WriteModelOutput {
            const root = await navigator.storage.getDirectory();
            const modelsDir = await root.getDirectoryHandle('models', { create: true });
            const fileHandle = await resolveFileHandle(modelsDir, toOpfsPath({ family, modelId }), { create: true });
            // Use createWritable for main-thread writes (no sync access handles on main thread)
            // slice(0) ensures we have a plain ArrayBuffer (not SharedArrayBuffer)
            const safeData = data.slice(0) as ArrayBuffer;
            const writable = await fileHandle.createWritable();
            await writable.write(safeData);
            await writable.close();
            logger.info(`[StorageManager] Wrote model ${family}/${modelId} (${String(data.byteLength)} bytes)`);
        }
);

export const deleteModel = inject({ logger })(
    ({ logger }) =>
        async function deleteModel({ family, modelId }: DeleteModelInput): DeleteModelOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const modelsDir = await root.getDirectoryHandle('models', { create: false });
                const familyDir = await modelsDir.getDirectoryHandle(family, { create: false });
                await familyDir.removeEntry(modelId);
                logger.info(`[StorageManager] Deleted model ${family}/${modelId}`);
            } catch (error) {
                logger.warn(`[StorageManager] Failed to delete model ${family}/${modelId}: ${String(error)}`);
            }
        }
);

export const readRenderCache = inject({ logger })(
    ({ logger: _logger }) =>
        async function readRenderCache({ cacheKey }: ReadRenderCacheInput): ReadRenderCacheOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const cacheDir = await root.getDirectoryHandle('renders', { create: false });
                const fileHandle = await cacheDir.getFileHandle(`${cacheKey}.pcm`, { create: false });
                const file = await fileHandle.getFile();
                const buffer = await file.arrayBuffer();
                return new Float32Array(buffer);
            } catch {
                return null;
            }
        }
);

export const writeRenderCache = inject({ logger })(
    ({ logger }) =>
        async function writeRenderCache({ cacheKey, audio }: WriteRenderCacheInput): WriteRenderCacheOutput {
            try {
                const root = await navigator.storage.getDirectory();
                const cacheDir = await root.getDirectoryHandle('renders', { create: true });
                const fileHandle = await cacheDir.getFileHandle(`${cacheKey}.pcm`, { create: true });
                const writable = await fileHandle.createWritable();
                // Use ArrayBuffer explicitly for FileSystemWritableFileStream compatibility
                const buffer = audio.buffer.slice(0) as ArrayBuffer;
                await writable.write(buffer);
                await writable.close();
                logger.info(`[StorageManager] Cached render: ${cacheKey}`);
            } catch (error) {
                logger.warn(`[StorageManager] Failed to cache render ${cacheKey}: ${String(error)}`);
            }
        }
);

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
                    // FileSystemDirectoryHandle is async iterable in Chrome (OPFS)
                    for await (const [, handle] of dir as unknown as AsyncIterable<[string, FileSystemFileHandle | FileSystemDirectoryHandle]>) {
                        if (handle.kind === 'file') {
                            const file = await (handle as FileSystemFileHandle).getFile();
                            size += file.size;
                        } else if (handle.kind === 'directory') {
                            size += await measureDir(handle as FileSystemDirectoryHandle);
                        }
                    }
                    return size;
                }

                usedBytes = await measureDir(root);
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

/**
 * Request persistent storage to prevent eviction under memory pressure.
 */
export async function requestPersistentStorage(): Promise<boolean> {
    try {
        return await navigator.storage.persist();
    } catch {
        return false;
    }
}

/**
 * Compute a deterministic SHA256 cache key for a render.
 */
export async function computeRenderCacheKey(input: {
    modelId: string;
    inputData: ArrayBuffer;
    qualityParams: string;
    seed?: number;
}): Promise<string> {
    const encoded = new TextEncoder().encode(
        `${input.modelId}:${input.qualityParams}:${String(input.seed ?? 0)}`
    );
    const combined = new Uint8Array(encoded.byteLength + input.inputData.byteLength);
    combined.set(encoded);
    combined.set(new Uint8Array(input.inputData), encoded.byteLength);

    const hashBuffer = await crypto.subtle.digest('SHA-256', combined.buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
