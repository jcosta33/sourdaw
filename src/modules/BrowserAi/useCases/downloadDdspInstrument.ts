import { inject } from '#/infra/di/inject';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { ddspModelStorage } from '../repositories/ddspModelStorage';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { downloadModel as downloadModelRepo } from '../repositories/modelDownloadManager';
import { withDdspInstrumentLock } from '../repositories/withDdspInstrumentLock';
import { setStorageUsed, updateModelStatus } from '../stores/modelRegistryStore';

type DownloadDdspInstrumentOptions = { signal?: AbortSignal };

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
    }
}

export const downloadDdspInstrument = inject({
    downloadModelRepo,
    ddspModelStorage,
    getStorageStatus,
    withDdspInstrumentLock,
})(
    ({ downloadModelRepo, ddspModelStorage, getStorageStatus, withDdspInstrumentLock }) =>
        function downloadDdspInstrument(
            instrumentId: DdspInstrumentId,
            { signal }: DownloadDdspInstrumentOptions = {}
        ): Promise<void> {
            const instrument = resolveDdspInstrument(instrumentId);
            return withDdspInstrumentLock(instrument.id, 'exclusive', async (): Promise<void> => {
                const storage = {
                    id: instrument.id,
                    version: instrument.artifactVersion,
                    artifacts: instrument.artifacts,
                };
                throwIfAborted(signal);
                if (await ddspModelStorage.checkDdspInstrumentReady(storage)) {
                    updateModelStatus(instrument.id, { status: 'ready', downloadProgress: 1 });
                    return;
                }

                updateModelStatus(instrument.id, { status: 'downloading', downloadProgress: 0 });
                let staged = false;
                let published = false;
                try {
                    await ddspModelStorage.stageDdspInstrumentGeneration(storage);
                    staged = true;
                    for (const [index, artifact] of instrument.artifacts.entries()) {
                        throwIfAborted(signal);
                        await downloadModelRepo({
                            spec: {
                                family: 'ddsp',
                                modelId: `${instrument.id}/${instrument.artifactVersion}/${artifact.path}`,
                                url: artifact.url,
                                sizeBytes: artifact.sizeBytes,
                                sha256: artifact.sha256,
                                redirectPolicy: 'reject',
                            },
                            signal,
                        });
                        updateModelStatus(instrument.id, {
                            downloadProgress: (index + 1) / instrument.artifacts.length,
                        });
                    }
                    throwIfAborted(signal);
                    await ddspModelStorage.publishDdspInstrumentGeneration(storage);
                    published = true;
                } catch (error) {
                    if (staged && !published) {
                        await ddspModelStorage.cleanupUnpublishedDdspGeneration(storage);
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
