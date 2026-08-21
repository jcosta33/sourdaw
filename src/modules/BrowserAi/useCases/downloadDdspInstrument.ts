import { inject } from '#/infra/di/inject';

import { type DdspInstrumentId, resolveDdspInstrument } from '../models/DdspInstrumentCatalog';
import { ddspModelStorage } from '../repositories/ddspModelStorage';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { downloadModel as downloadModelRepo } from '../repositories/modelDownloadManager';
import { withDdspInstrumentLock } from '../repositories/withDdspInstrumentLock';
import { setStorageUsed, updateModelStatus } from '../stores/modelRegistryStore';

const activeDownloads = new Map<string, Promise<void>>();

export const downloadDdspInstrument = inject({
    downloadModelRepo,
    ddspModelStorage,
    getStorageStatus,
    withDdspInstrumentLock,
})(
    ({ downloadModelRepo, ddspModelStorage, getStorageStatus, withDdspInstrumentLock }) =>
        function downloadDdspInstrument(instrumentId: DdspInstrumentId): Promise<void> {
            const instrument = resolveDdspInstrument(instrumentId);
            const operationKey = `${instrument.id}:${instrument.artifactVersion}`;
            const active = activeDownloads.get(operationKey);
            if (active) {
                return active;
            }

            const operation = withDdspInstrumentLock(instrument.id, async (): Promise<void> => {
                updateModelStatus(instrument.id, { status: 'downloading', downloadProgress: 0 });
                const storage = {
                    id: instrument.id,
                    version: instrument.artifactVersion,
                    artifacts: instrument.artifacts,
                };
                try {
                    for (const [index, artifact] of instrument.artifacts.entries()) {
                        await downloadModelRepo({
                            spec: {
                                family: 'ddsp',
                                modelId: `${instrument.id}/${instrument.artifactVersion}/${artifact.path}`,
                                url: artifact.url,
                                sizeBytes: artifact.sizeBytes,
                                sha256: artifact.sha256,
                            },
                        });
                        updateModelStatus(instrument.id, {
                            downloadProgress: (index + 1) / instrument.artifacts.length,
                        });
                    }
                    await ddspModelStorage.writeDdspReadyMarker(storage);
                } catch (error) {
                    await ddspModelStorage.cleanupDdspInstrumentArtifacts(storage);
                    updateModelStatus(instrument.id, { status: 'error', downloadProgress: 0 });
                    throw error;
                }
                updateModelStatus(instrument.id, { status: 'ready', downloadProgress: 1 });
                const status = await getStorageStatus();
                setStorageUsed(status.usedBytes);
            });
            activeDownloads.set(operationKey, operation);
            void operation.finally(() => activeDownloads.delete(operationKey)).catch(() => undefined);
            return operation;
        }
);
