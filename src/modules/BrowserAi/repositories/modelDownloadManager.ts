/**
 * Repository: Model download manager.
 *
 * Handles downloading models from CDN to OPFS with:
 * - Progress reporting via BroadcastChannel
 * - SHA256 integrity verification
 * - Automatic retry (3 attempts, exponential backoff)
 * - Cancellation support
 * - LRU eviction when the 2 GB cache limit is exceeded
 */

import { MAX_GUARDED_ZIP_BYTES, ZipArchiveError } from '#/infra/archive/extractGuardedZip';
import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type ModelDownloadProgressPayload } from '../models/ModelDownloadProgress';
import { updateModelStatus } from '../stores/modelRegistryStore';

import { getStorageStatus } from './getStorageStatus';
import { modelStorageWorkerBridge } from './modelStorageWorkerBridge';
import { requestPersistentStorage } from './requestPersistentStorage';

const BROADCAST_CHANNEL_NAME = 'sourdaw-model-downloads';
const MAX_RETRIES = 3;
/** Minimum interval between throttled progress emissions (~10 Hz). */
const PROGRESS_THROTTLE_MS = 100;

class ModelSizeError extends Error {
    override readonly name = 'ModelSizeError';
}

type ModelDownloadSpec = {
    modelId: string;
    family: string;
    url: string;
    sha256?: string;
    sizeBytes: number;
};

type DownloadModelInput = {
    spec: ModelDownloadSpec;
    onProgress?: (payload: ModelDownloadProgressPayload) => void;
    /** Aborts the download — interrupts fetch, the read loop, and the retry backoff. */
    signal?: AbortSignal;
};

type DownloadModelOutput = Promise<void>;

/** True when the error is an AbortError raised by signal cancellation. */
function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

/** Resolve after `ms`, or reject early if `signal` aborts during the wait. */
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        function onAbort(): void {
            clearTimeout(timer);
            reject(new DOMException('Aborted', 'AbortError'));
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function isModelArchiveUrl(url: string): boolean {
    try {
        const pathname = new URL(url, 'https://sourdaw.invalid').pathname.toLowerCase();
        return pathname.endsWith('.oudep') || pathname.endsWith('.zip');
    } catch {
        const pathname = url.split(/[?#]/u, 1)[0]?.toLowerCase() ?? '';
        return pathname.endsWith('.oudep') || pathname.endsWith('.zip');
    }
}

/**
 * Download a model file with retry and integrity verification.
 * Stores the result in OPFS.
 */
export const downloadModel = inject({
    logger,
    getStorageStatus,
    modelStorageWorkerBridge,
    requestPersistentStorage,
})(
    ({ logger, getStorageStatus, modelStorageWorkerBridge, requestPersistentStorage }) =>
        async function downloadModel({ spec, onProgress, signal }: DownloadModelInput): DownloadModelOutput {
            const { modelId, family, url, sha256, sizeBytes } = spec;

            updateModelStatus(modelId, { status: 'downloading', downloadProgress: 0 });

            // Request persistent storage on first download
            await requestPersistentStorage().catch(() => undefined);

            // Hold a single BroadcastChannel for the whole download instead of
            // constructing and closing one per progress event in the read loop.
            let channel: BroadcastChannel | null = null;
            try {
                channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
            } catch {
                // BroadcastChannel not available
            }

            function broadcast(payload: ModelDownloadProgressPayload): void {
                onProgress?.(payload);
                try {
                    channel?.postMessage(payload);
                } catch {
                    // channel closed / unavailable
                }
            }

            // Throttle the high-frequency in-loop progress updates to ~10 Hz so we
            // don't hammer the store and BroadcastChannel on every chunk. Stage
            // transitions and the terminal events bypass the throttle.
            let lastProgressAt = 0;
            function broadcastProgress(payload: ModelDownloadProgressPayload, force: boolean): void {
                const now = Date.now();
                if (!force && now - lastProgressAt < PROGRESS_THROTTLE_MS) {
                    return;
                }
                lastProgressAt = now;
                updateModelStatus(modelId, { downloadProgress: payload.progress });
                broadcast(payload);
            }

            let lastError: unknown;

            try {
                for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                    throwIfAborted(signal);
                    try {
                        logger.info(
                            `[ModelDownload] Downloading ${modelId} (attempt ${String(attempt + 1)}/${String(MAX_RETRIES)})`
                        );

                        // Every admitted artifact is pinned to an exact Magenta URL. A
                        // redirect would otherwise turn that admission into an unchecked
                        // write from another origin before OPFS integrity verification.
                        const response = await fetch(url, { redirect: 'error', signal });
                        if (!response.ok) {
                            throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
                        }

                        const reader = response.body?.getReader();
                        if (!reader) {
                            throw new Error('Response body not readable');
                        }

                        const contentLength = response.headers.get('content-length');
                        const declaredBytes = contentLength === null ? null : Number(contentLength);
                        if (
                            declaredBytes !== null &&
                            (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0 || declaredBytes !== sizeBytes)
                        ) {
                            await reader.cancel();
                            throw new ModelSizeError(
                                `Content-Length mismatch for ${modelId}: expected ${String(sizeBytes)} bytes, got ${String(contentLength)}`
                            );
                        }
                        const totalBytes = declaredBytes ?? sizeBytes;

                        const isContainer = isModelArchiveUrl(url);
                        if (isContainer && totalBytes > MAX_GUARDED_ZIP_BYTES) {
                            await reader.cancel();
                            throw new ZipArchiveError(
                                `Model archive byte limit exceeds ${String(MAX_GUARDED_ZIP_BYTES)}`
                            );
                        }

                        const writeId = await modelStorageWorkerBridge.beginModelWrite({
                            family,
                            modelId,
                            expectedSizeBytes: sizeBytes,
                            expectedSha256: sha256,
                            archive: isContainer,
                        });
                        let abortPromise: Promise<void> | undefined;
                        function abortWorkerWrite(): void {
                            abortPromise ??= modelStorageWorkerBridge.abortModelWrite(writeId).catch(() => undefined);
                        }
                        signal?.addEventListener('abort', abortWorkerWrite, { once: true });
                        let bytesDownloaded = 0;
                        let writeCommitted = false;

                        try {
                            throwIfAborted(signal);
                            for (;;) {
                                const { done, value } = await reader.read();
                                if (done) {
                                    break;
                                }
                                throwIfAborted(signal);
                                const chunkBytes = value.byteLength;
                                const nextBytesDownloaded = bytesDownloaded + chunkBytes;
                                if (isContainer && nextBytesDownloaded > MAX_GUARDED_ZIP_BYTES) {
                                    await reader.cancel();
                                    throw new ZipArchiveError(
                                        `Model archive byte limit exceeds ${String(MAX_GUARDED_ZIP_BYTES)}`
                                    );
                                }
                                if (nextBytesDownloaded > sizeBytes) {
                                    await reader.cancel();
                                    throw new ModelSizeError(
                                        `Model byte limit exceeded for ${modelId}: expected at most ${String(sizeBytes)} bytes`
                                    );
                                }
                                bytesDownloaded = nextBytesDownloaded;

                                const chunk =
                                    value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
                                        ? value.buffer
                                        : value.slice().buffer;
                                const bytesWritten = await modelStorageWorkerBridge.writeModelChunk({
                                    writeId,
                                    chunk,
                                });
                                if (bytesWritten !== chunkBytes) {
                                    throw new Error(
                                        `OPFS wrote ${String(bytesWritten)} of ${String(chunkBytes)} model bytes`
                                    );
                                }
                                throwIfAborted(signal);

                                const progress = totalBytes > 0 ? bytesDownloaded / totalBytes : 0;
                                broadcastProgress(
                                    { modelId, bytesDownloaded, totalBytes, progress, stage: 'downloading' },
                                    false
                                );
                            }

                            throwIfAborted(signal);
                            if (bytesDownloaded !== sizeBytes) {
                                throw new Error(
                                    `Size check failed for ${modelId}: expected ${String(sizeBytes)} bytes, got ${String(bytesDownloaded)}`
                                );
                            }

                            const committed = await modelStorageWorkerBridge
                                .commitModelWrite({
                                    writeId,
                                    onProgress(stage) {
                                        let progress = 0.98;
                                        if (stage === 'verifying') {
                                            progress = 0.95;
                                        } else if (stage === 'extracting') {
                                            progress = 0.97;
                                        }
                                        broadcast({
                                            modelId,
                                            bytesDownloaded,
                                            totalBytes: sizeBytes,
                                            progress,
                                            stage,
                                        });
                                    },
                                })
                                .then((result) => {
                                    writeCommitted = true;
                                    signal?.removeEventListener('abort', abortWorkerWrite);
                                    return result;
                                });
                            if (committed.extractedPath) {
                                logger.info(
                                    `[ModelDownload] Extracted ${committed.extractedPath} from ZIP for ${modelId}`
                                );
                            }
                        } catch (error) {
                            if (!writeCommitted) {
                                await (abortPromise ??
                                    modelStorageWorkerBridge.abortModelWrite(writeId).catch(() => undefined));
                            }
                            throw error;
                        } finally {
                            signal?.removeEventListener('abort', abortWorkerWrite);
                        }

                        const storageStatus = await getStorageStatus();
                        if (storageStatus.usedBytes > storageStatus.limitBytes) {
                            logger.warn('[ModelDownload] Storage limit exceeded — LRU eviction needed');
                            // Eviction is handled by the removeModel use case
                        }

                        updateModelStatus(modelId, { status: 'ready', downloadProgress: 1 });
                        broadcast({
                            modelId,
                            bytesDownloaded: sizeBytes,
                            totalBytes: sizeBytes,
                            progress: 1,
                            stage: 'complete',
                        });
                        logger.info(`[ModelDownload] Completed: ${modelId}`);
                        return;
                    } catch (error) {
                        // Cancellation is not a failure to retry — stop immediately and
                        // leave the store/registry untouched beyond what the caller expects.
                        if (isAbortError(error) || signal?.aborted) {
                            logger.info(`[ModelDownload] Cancelled: ${modelId}`);
                            throw error instanceof Error ? error : new DOMException('Aborted', 'AbortError');
                        }
                        lastError = error;
                        logger.warn(
                            `[ModelDownload] Attempt ${String(attempt + 1)} failed for ${modelId}: ${String(error)}`
                        );
                        if (error instanceof ZipArchiveError || error instanceof ModelSizeError) {
                            break;
                        }
                        if (attempt < MAX_RETRIES - 1) {
                            try {
                                await abortableSleep(1000 * 2 ** attempt, signal);
                            } catch (sleepError) {
                                // Aborted mid-backoff: stop without an error-status update.
                                logger.info(`[ModelDownload] Cancelled: ${modelId}`);
                                throw sleepError instanceof Error
                                    ? sleepError
                                    : new DOMException('Aborted', 'AbortError');
                            }
                        }
                    }
                }

                updateModelStatus(modelId, { status: 'error', downloadProgress: 0 });
                broadcast({
                    modelId,
                    bytesDownloaded: 0,
                    totalBytes: sizeBytes,
                    progress: 0,
                    stage: 'error',
                    error: String(lastError),
                });
                if (lastError instanceof ZipArchiveError) {
                    throw lastError;
                }
                if (lastError instanceof ModelSizeError) {
                    throw lastError;
                }
                throw new Error(
                    `Failed to download ${modelId} after ${String(MAX_RETRIES)} attempts: ${String(lastError)}`
                );
            } finally {
                channel?.close();
            }
        }
);
