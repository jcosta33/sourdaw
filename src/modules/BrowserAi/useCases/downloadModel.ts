/**
 * Use case: Download a model to OPFS.
 *
 * Orchestrates the download manager and updates the model registry store.
 * Emits progress events via ModelDownloadProgressPayload.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';

import { type ModelDownloadProgressPayload } from '../events/ModelDownloadProgressEvent';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { downloadModel as downloadModelRepo } from '../repositories/modelDownloadManager';
import { setStorageUsed } from '../stores/modelRegistryStore';

type DownloadModelInput = {
    modelId: string;
    family: string;
    url: string;
    sha256?: string;
    sizeBytes: number;
    onProgress?: (payload: ModelDownloadProgressPayload) => void;
};

export const downloadModel = inject({ logger, downloadModelRepo, getStorageStatus })(
    ({ logger, downloadModelRepo, getStorageStatus }) =>
        async function downloadModel({
            modelId,
            family,
            url,
            sha256,
            sizeBytes,
            onProgress,
        }: DownloadModelInput): Promise<void> {
            logger.info(`[BrowserAi] Starting download: ${modelId}`);

            await downloadModelRepo({
                spec: { modelId, family, url, sha256, sizeBytes, redirectPolicy: 'follow' },
                onProgress,
            });

            // Refresh storage usage in store
            const status = await getStorageStatus();
            setStorageUsed(status.usedBytes);

            logger.info(`[BrowserAi] Download complete: ${modelId}`);
        }
);
