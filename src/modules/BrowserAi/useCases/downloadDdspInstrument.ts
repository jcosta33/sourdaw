import { inject } from '#/infra/di/inject';

import { type DdspInstrument } from '../models/BrowserModel';
import { ddspModelStorage } from '../repositories/ddspModelStorage';
import { getStorageStatus } from '../repositories/getStorageStatus';
import { downloadModel as downloadModelRepo } from '../repositories/modelDownloadManager';
import { setStorageUsed, updateModelStatus } from '../stores/modelRegistryStore';

type AdmittedDdspInstrument = Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
    artifactVersion: string;
    artifacts: NonNullable<DdspInstrument['artifacts']>;
};

const activeDownloads = new Map<string, Promise<void>>();

export const downloadDdspInstrument = inject({ downloadModelRepo, ddspModelStorage, getStorageStatus })(
    ({ downloadModelRepo, ddspModelStorage, getStorageStatus }) =>
        function downloadDdspInstrument(instrument: AdmittedDdspInstrument): Promise<void> {
            const active = activeDownloads.get(instrument.id);
            if (active) {
                return active;
            }

            const operation = (async (): Promise<void> => {
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
                                modelId: `${instrument.id}/${artifact.path}`,
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
            })();
            activeDownloads.set(instrument.id, operation);
            void operation.finally(() => activeDownloads.delete(instrument.id)).catch(() => undefined);
            return operation;
        }
);
