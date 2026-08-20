import { inject } from '#/infra/di/inject';

import { type DdspInstrument } from '../models/BrowserModel';
import { ddspModelStorage } from '../repositories/ddspModelStorage';
import { downloadModel as downloadModelRepo } from '../repositories/modelDownloadManager';
import { updateModelStatus } from '../stores/modelRegistryStore';

type AdmittedDdspInstrument = Omit<DdspInstrument, 'status' | 'downloadProgress'> & {
    artifactVersion: string;
    artifacts: NonNullable<DdspInstrument['artifacts']>;
};

export const downloadDdspInstrument = inject({ downloadModelRepo, ddspModelStorage })(
    ({ downloadModelRepo, ddspModelStorage }) =>
        async function downloadDdspInstrument(instrument: AdmittedDdspInstrument): Promise<void> {
            updateModelStatus(instrument.id, { status: 'downloading', downloadProgress: 0 });
            const storage = { id: instrument.id, version: instrument.artifactVersion, artifacts: instrument.artifacts };
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
                    updateModelStatus(instrument.id, { downloadProgress: (index + 1) / instrument.artifacts.length });
                }
                await ddspModelStorage.writeDdspReadyMarker(storage);
                updateModelStatus(instrument.id, { status: 'ready', downloadProgress: 1 });
            } catch (error) {
                await ddspModelStorage.deleteDdspInstrumentArtifacts(storage);
                updateModelStatus(instrument.id, { status: 'error', downloadProgress: 0 });
                throw error;
            }
        }
);
