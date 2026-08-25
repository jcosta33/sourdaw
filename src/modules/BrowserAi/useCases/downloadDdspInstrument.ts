import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { MODEL_RELEASE_ADMISSION } from '#/infra/release/modelReleaseAdmission';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { checkDdspInstrumentReady } from '../repositories/checkDdspInstrumentReady';
import { cleanupUnpublishedDdspGeneration } from '../repositories/cleanupUnpublishedDdspGeneration';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { downloadModel as downloadModelRepo } from '../repositories/modelDownloadManager';
import { publishDdspInstrumentGeneration } from '../repositories/publishDdspInstrumentGeneration';
import { stageDdspInstrumentGeneration } from '../repositories/stageDdspInstrumentGeneration';
import { withDdspInstrumentLock } from '../repositories/withDdspInstrumentLock';
import { setStorageUsed, updateModelStatus } from '../stores/modelRegistryStore';

type DownloadDdspInstrumentOptions = { signal?: AbortSignal };

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

/** Downloads one catalog-pinned generation and publishes it only after complete verification. */
export const downloadDdspInstrument = inject({
    logger,
    checkDdspInstrumentReady,
    cleanupUnpublishedDdspGeneration,
    downloadModelRepo,
    getStorageStatus,
    publishDdspInstrumentGeneration,
    stageDdspInstrumentGeneration,
    withDdspInstrumentLock,
})(
    ({
        logger,
        checkDdspInstrumentReady,
        cleanupUnpublishedDdspGeneration,
        downloadModelRepo,
        getStorageStatus,
        publishDdspInstrumentGeneration,
        stageDdspInstrumentGeneration,
        withDdspInstrumentLock,
    }) =>
        function downloadDdspInstrument(
            instrumentId: DdspInstrumentId,
            { signal }: DownloadDdspInstrumentOptions = {}
        ): Promise<void> {
            if (!MODEL_RELEASE_ADMISSION.ddsp) {
                return Promise.reject(new Error('DDSP model artifacts are not admitted in this release'));
            }
            const instrument = resolveDdspInstrument(instrumentId);
            return withDdspInstrumentLock(instrument.id, 'exclusive', async () => {
                const storage = {
                    id: instrument.id,
                    version: instrument.artifactVersion,
                    artifacts: instrument.artifacts,
                };
                throwIfAborted(signal);
                if (await checkDdspInstrumentReady(storage)) {
                    updateModelStatus(instrument.id, { status: 'ready', downloadProgress: 1 });
                    return;
                }

                updateModelStatus(instrument.id, { status: 'downloading', downloadProgress: 0 });
                let staged = false;
                let published = false;
                try {
                    await stageDdspInstrumentGeneration(storage);
                    staged = true;
                    const totalDownloadBytes = instrument.artifacts.reduce(
                        (total, artifact) => total + artifact.sizeBytes,
                        0
                    );
                    let completedBytes = 0;
                    let reportedProgress = 0;
                    const reportDownloadProgress = (candidate: number): void => {
                        const nextProgress = Math.min(0.99, Math.max(reportedProgress, candidate));
                        if (nextProgress === reportedProgress) {
                            return;
                        }
                        reportedProgress = nextProgress;
                        updateModelStatus(instrument.id, { downloadProgress: nextProgress });
                    };

                    for (const artifact of instrument.artifacts) {
                        throwIfAborted(signal);
                        let artifactDownloadedBytes = 0;
                        await downloadModelRepo({
                            spec: {
                                family: 'ddsp',
                                modelId: `${instrument.id}/${instrument.artifactVersion}/${artifact.path}`,
                                url: artifact.url,
                                sizeBytes: artifact.sizeBytes,
                                sha256: artifact.sha256,
                                redirectPolicy: 'reject',
                            },
                            onProgress: ({ bytesDownloaded }) => {
                                const boundedBytes = Number.isFinite(bytesDownloaded)
                                    ? Math.min(artifact.sizeBytes, Math.max(0, bytesDownloaded))
                                    : 0;
                                artifactDownloadedBytes = Math.max(artifactDownloadedBytes, boundedBytes);
                                reportDownloadProgress((completedBytes + artifactDownloadedBytes) / totalDownloadBytes);
                            },
                            signal,
                        });
                        completedBytes += artifact.sizeBytes;
                        reportDownloadProgress(completedBytes / totalDownloadBytes);
                    }
                    throwIfAborted(signal);
                    await publishDdspInstrumentGeneration(storage);
                    published = true;
                } catch (error) {
                    if (staged && !published) {
                        await cleanupUnpublishedDdspGeneration(storage).catch((cleanupError: unknown) => {
                            logger.warn(
                                `[BrowserAi] Failed to clean unpublished DDSP generation ${instrument.id}: ${String(cleanupError)}`
                            );
                        });
                    }
                    updateModelStatus(instrument.id, { status: 'error', downloadProgress: 0 });
                    throw error;
                }

                updateModelStatus(instrument.id, { status: 'ready', downloadProgress: 1 });
                const status = await getStorageStatus();
                setStorageUsed(status.usedBytes);
            });
        }
);
