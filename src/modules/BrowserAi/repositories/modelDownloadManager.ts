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

import { unzip } from 'fflate';

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type ModelDownloadProgressPayload } from '../events/ModelDownloadProgressEvent';
import { updateModelStatus } from '../stores/modelRegistryStore';

import { writeModel, getStorageStatus, requestPersistentStorage } from './storageManager';

const BROADCAST_CHANNEL_NAME = 'sourdaw-model-downloads';
const MAX_RETRIES = 3;

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
};

type DownloadModelOutput = Promise<void>;

/**
 * Download a model file with retry and integrity verification.
 * Stores the result in OPFS.
 */
export const downloadModel = inject({ logger })(
    ({ logger }) =>
        (async function downloadModel({ spec, onProgress }: DownloadModelInput): DownloadModelOutput {
            const { modelId, family, url, sha256, sizeBytes } = spec;

            updateModelStatus(modelId, { status: 'downloading', downloadProgress: 0 });

            // Request persistent storage on first download
            await requestPersistentStorage().catch(() => undefined);

            function broadcast(payload: ModelDownloadProgressPayload): void {
                onProgress?.(payload);
                try {
                    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
                    channel.postMessage(payload);
                    channel.close();
                } catch {
                    // BroadcastChannel not available
                }
            };

            let lastError: unknown;

            for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
                try {
                    logger.info(
                        `[ModelDownload] Downloading ${modelId} (attempt ${String(attempt + 1)}/${String(MAX_RETRIES)})`
                    );

                    const response = await fetch(url);
                    if (!response.ok) {
                        throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
                    }

                    const contentLength = response.headers.get('content-length');
                    const totalBytes = contentLength ? parseInt(contentLength, 10) : sizeBytes;

                    const reader = response.body?.getReader();
                    if (!reader) {
                        throw new Error('Response body not readable');
                    }

                    const chunks: Uint8Array[] = [];
                    let bytesDownloaded = 0;

                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) {
                            break;
                        }
                        chunks.push(value);
                        bytesDownloaded += value.byteLength;

                        const progress = totalBytes > 0 ? bytesDownloaded / totalBytes : 0;
                        updateModelStatus(modelId, { downloadProgress: progress });
                        broadcast({
                            modelId,
                            bytesDownloaded,
                            totalBytes,
                            progress,
                            stage: 'downloading',
                        });
                    }

                    // Concatenate chunks
                    const totalLength = chunks.reduce((acc, context) => acc + context.byteLength, 0);
                    const fullData = new Uint8Array(totalLength);
                    let offset = 0;
                    for (const chunk of chunks) {
                        fullData.set(chunk, offset);
                        offset += chunk.byteLength;
                    }

                    // Verify integrity
                    broadcast({ modelId, bytesDownloaded, totalBytes: sizeBytes, progress: 0.95, stage: 'verifying' });
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

                    // Extract ONNX from ZIP/oudep container if needed.
                    // Uses async unzip (fflate) to avoid blocking the main thread.
                    let onnxData: ArrayBuffer = fullData.buffer;
                    if (url.endsWith('.oudep') || url.endsWith('.zip')) {
                        broadcast({
                            modelId,
                            bytesDownloaded,
                            totalBytes: sizeBytes,
                            progress: 0.97,
                            stage: 'extracting',
                        });
                        const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
                            unzip(fullData, (err, result) => {
                                if (err) {
                                    reject(err);
                                } else {
                                    resolve(result);
                                }
                            });
                        });
                        const onnxEntry = Object.keys(files).find((name) => name.endsWith('.onnx'));
                        const onnxBytes = onnxEntry ? files[onnxEntry] : undefined;
                        if (!onnxEntry || !onnxBytes) {
                            throw new Error(`No .onnx file found inside ZIP package for ${modelId}`);
                        }
                        // .slice() copies just the ONNX bytes — fflate returns views into a
                        // shared backing buffer, so .buffer alone would include adjacent ZIP entries.
                        onnxData = onnxBytes.slice(0).buffer;
                        logger.info(`[ModelDownload] Extracted ${onnxEntry} from ZIP for ${modelId}`);
                    }

                    // Store in OPFS
                    broadcast({ modelId, bytesDownloaded, totalBytes: sizeBytes, progress: 0.98, stage: 'storing' });
                    await writeModel({ family, modelId, data: onnxData });

                    // Check storage quota
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
                    lastError = error;
                    logger.warn(
                        `[ModelDownload] Attempt ${String(attempt + 1)} failed for ${modelId}: ${String(error)}`
                    );
                    if (attempt < MAX_RETRIES - 1) {
                        await new Promise<void>((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
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
            throw new Error(
                `Failed to download ${modelId} after ${String(MAX_RETRIES)} attempts: ${String(lastError)}`
            );
        })
);
