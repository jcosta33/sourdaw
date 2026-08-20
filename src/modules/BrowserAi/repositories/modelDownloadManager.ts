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
import { extractSingleGuardedZipEntry } from '#/infra/archive/extractSingleGuardedZipEntry';
import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type ModelDownloadProgressPayload } from '../models/ModelDownloadProgress';
import { updateModelStatus } from '../stores/modelRegistryStore';

import { abortWritable } from './abortWritable';
import { createModelWritable } from './createModelWritable';
import { deleteModel } from './deleteModel';
import { getStorageStatus } from './getStorageStatus';
import { requestPersistentStorage } from './requestPersistentStorage';
import { writeModel } from './writeModel';

const BROADCAST_CHANNEL_NAME = 'sourdaw-model-downloads';
const MAX_RETRIES = 3;
/** Minimum interval between throttled progress emissions (~10 Hz). */
const PROGRESS_THROTTLE_MS = 100;

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
export const downloadModel = inject({ logger })(
    ({ logger }) =>
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

                        const response = await fetch(url, signal ? { signal } : undefined);
                        if (!response.ok) {
                            throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
                        }

                        const contentLength = response.headers.get('content-length');
                        const totalBytes = contentLength ? parseInt(contentLength, 10) : sizeBytes;

                        const reader = response.body?.getReader();
                        if (!reader) {
                            throw new Error('Response body not readable');
                        }

                        const isContainer = isModelArchiveUrl(url);
                        // We must buffer the bytes in memory only when we have to inspect the
                        // whole payload — SHA256 verification (no streaming digest in WebCrypto)
                        // or ZIP/oudep extraction. Otherwise we stream chunks straight to OPFS.
                        const mustBuffer = isContainer || Boolean(sha256);

                        let writable: FileSystemWritableFileStream | null = null;
                        let streamedAbortPromise: Promise<void> | undefined;
                        function abortStreamedWritable(): void {
                            if (writable) {
                                streamedAbortPromise ??= abortWritable(writable);
                            }
                        }
                        const chunks: Uint8Array[] = [];
                        let bytesDownloaded = 0;

                        try {
                            if (isContainer && totalBytes > MAX_GUARDED_ZIP_BYTES) {
                                await reader.cancel();
                                throw new ZipArchiveError(
                                    `Model archive byte limit exceeds ${String(MAX_GUARDED_ZIP_BYTES)}`
                                );
                            }
                            if (!mustBuffer) {
                                writable = await createModelWritable({ family, modelId });
                                signal?.addEventListener('abort', abortStreamedWritable, { once: true });
                                throwIfAborted(signal);
                            }

                            for (;;) {
                                const { done, value } = await reader.read();
                                if (done) {
                                    break;
                                }
                                if (signal?.aborted) {
                                    throw new DOMException('Aborted', 'AbortError');
                                }
                                bytesDownloaded += value.byteLength;
                                if (isContainer && bytesDownloaded > MAX_GUARDED_ZIP_BYTES) {
                                    await reader.cancel();
                                    throw new ZipArchiveError(
                                        `Model archive byte limit exceeds ${String(MAX_GUARDED_ZIP_BYTES)}`
                                    );
                                }

                                if (writable) {
                                    // Stream directly to OPFS — no per-chunk accumulation.
                                    await writable.write(value);
                                    throwIfAborted(signal);
                                } else {
                                    chunks.push(value);
                                }

                                const progress = totalBytes > 0 ? bytesDownloaded / totalBytes : 0;
                                broadcastProgress(
                                    { modelId, bytesDownloaded, totalBytes, progress, stage: 'downloading' },
                                    false
                                );
                            }
                        } catch (error) {
                            // Abandon the partial writable before bubbling up so a retry
                            // re-creates a clean file.
                            if (writable) {
                                await (streamedAbortPromise ?? abortWritable(writable));
                            }
                            signal?.removeEventListener('abort', abortStreamedWritable);
                            throw error;
                        }

                        if (writable) {
                            try {
                                throwIfAborted(signal);
                                if (bytesDownloaded !== sizeBytes) {
                                    await (streamedAbortPromise ?? abortWritable(writable));
                                    throw new Error(
                                        `Size check failed for ${modelId}: expected ${String(sizeBytes)} bytes, got ${String(bytesDownloaded)}`
                                    );
                                }
                                await writable.close();
                                throwIfAborted(signal);

                                // Check storage quota (parity with the buffered path).
                                const streamedStatus = await getStorageStatus();
                                throwIfAborted(signal);
                                if (streamedStatus.usedBytes > streamedStatus.limitBytes) {
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
                            } finally {
                                signal?.removeEventListener('abort', abortStreamedWritable);
                            }
                        }

                        throwIfAborted(signal);
                        if (bytesDownloaded !== sizeBytes) {
                            throw new Error(
                                `Size check failed for ${modelId}: expected ${String(sizeBytes)} bytes, got ${String(bytesDownloaded)}`
                            );
                        }
                        // Buffered path: concatenate chunks once.
                        const totalLength = chunks.reduce((acc, context) => acc + context.byteLength, 0);
                        const fullData = new Uint8Array(totalLength);
                        let offset = 0;
                        for (const chunk of chunks) {
                            fullData.set(chunk, offset);
                            offset += chunk.byteLength;
                        }
                        // Release the per-chunk references so the merged buffer is the only copy.
                        chunks.length = 0;

                        // Verify integrity
                        broadcast({
                            modelId,
                            bytesDownloaded,
                            totalBytes: sizeBytes,
                            progress: 0.95,
                            stage: 'verifying',
                        });
                        if (sha256) {
                            const hashBuffer = await crypto.subtle.digest('SHA-256', fullData.buffer);
                            const hashHex = Array.from(new Uint8Array(hashBuffer))
                                .map((b) => b.toString(16).padStart(2, '0'))
                                .join('');
                            if (hashHex !== sha256) {
                                throw new Error(
                                    `Integrity check failed for ${modelId}: expected ${sha256}, got ${hashHex}`
                                );
                            }
                        }

                        // Extract ONNX from ZIP/oudep container in a cancellable worker.
                        let onnxData: ArrayBuffer = fullData.buffer;
                        if (isContainer) {
                            broadcast({
                                modelId,
                                bytesDownloaded,
                                totalBytes: sizeBytes,
                                progress: 0.97,
                                stage: 'extracting',
                            });
                            const extracted = await extractSingleGuardedZipEntry({
                                bytes: fullData,
                                suffix: '.onnx',
                                signal,
                            });
                            onnxData = extracted.data.buffer;
                            logger.info(`[ModelDownload] Extracted ${extracted.path} from ZIP for ${modelId}`);
                        }

                        throwIfAborted(signal);

                        // Store in OPFS
                        broadcast({
                            modelId,
                            bytesDownloaded,
                            totalBytes: sizeBytes,
                            progress: 0.98,
                            stage: 'storing',
                        });
                        await writeModel({ family, modelId, data: onnxData, signal });

                        // Check storage quota
                        const storageStatus = await getStorageStatus();
                        throwIfAborted(signal);
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
                            // Drop any partial file written by the streamed path.
                            await deleteModel({ family, modelId }).catch(() => undefined);
                            throw error instanceof Error ? error : new DOMException('Aborted', 'AbortError');
                        }
                        lastError = error;
                        logger.warn(
                            `[ModelDownload] Attempt ${String(attempt + 1)} failed for ${modelId}: ${String(error)}`
                        );
                        if (error instanceof ZipArchiveError) {
                            break;
                        }
                        if (attempt < MAX_RETRIES - 1) {
                            try {
                                await abortableSleep(1000 * 2 ** attempt, signal);
                            } catch (sleepError) {
                                // Aborted mid-backoff: stop without an error-status update.
                                logger.info(`[ModelDownload] Cancelled: ${modelId}`);
                                await deleteModel({ family, modelId }).catch(() => undefined);
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
                throw new Error(
                    `Failed to download ${modelId} after ${String(MAX_RETRIES)} attempts: ${String(lastError)}`
                );
            } finally {
                channel?.close();
            }
        }
);
